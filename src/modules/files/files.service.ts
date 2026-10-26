import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../common/auth/auth-principal";
import { Errors } from "../../common/http/app-exception";
import { PrismaService } from "../../database/prisma.service";
import type { FilePurpose, FileStatus, StoredFile } from "../../generated/prisma/client";
import { AuditService } from "../../infrastructure/audit/audit.service";
import { hasPermission } from "../../shared";
import { type AllowedMime, type CreateUploadInput, detectMime, EXTENSIONS, FILE_ACCESS, SIGNATURE_BYTES } from "./file-policy";
import { OBJECT_STORAGE, type ObjectStorage } from "./storage/object-storage.port";

const DOWNLOAD_SECONDS = 300;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  async createUpload(input: CreateUploadInput, principal: AuthPrincipal) {
    if (!hasPermission(principal.role, FILE_ACCESS[input.purpose].upload)) {
      throw Errors.notFound();
    }
    const objectKey = `incoming/${input.purpose.toLowerCase()}/${principal.countryCode ?? "global"}/${randomUUID()}`;
    const file = await this.prisma.storedFile.create({
      data: {
        objectKey,
        purpose: input.purpose,
        ownerUserId: principal.userId,
        vendorId: principal.vendorId,
        countryCode: principal.countryCode,
        declaredMime: input.contentType,
        maxBytes: input.sizeBytes,
      },
      select: { id: true },
    });
    const upload = await this.storage.presignUpload(objectKey, input.contentType, input.sizeBytes);
    return { fileId: file.id, upload };
  }

  async confirm(fileId: string, principal: AuthPrincipal, meta: RequestMeta) {
    const file = await this.findOwned(fileId, principal, "upload");
    if (file.status !== "PENDING_UPLOAD") {
      return { fileId: file.id, status: file.status };
    }
    const verifiedKey = file.objectKey.replace(/^incoming\//, "verified/");
    const arrived = await this.storage.head(file.objectKey);
    if (arrived) {
      await this.storage.copy(file.objectKey, verifiedKey);
      await this.storage.remove(file.objectKey);
    }
    const rejection = arrived ? await this.inspect(file, verifiedKey) : "The upload did not arrive. Try again.";
    const status = rejection ? "REJECTED" : "VERIFIED";
    const head = rejection ? null : await this.storage.head(verifiedKey);
    if (rejection && arrived) {
      await this.storage.remove(verifiedKey);
    }
    await this.prisma.storedFile.updateMany({
      where: { id: file.id, status: "PENDING_UPLOAD" },
      data: { status, objectKey: verifiedKey, detectedMime: rejection ? null : file.declaredMime, sizeBytes: head?.sizeBytes ?? null, verifiedAt: rejection ? null : new Date() },
    });
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action: rejection ? "file.rejected" : "file.verified",
      resourceType: "stored_file",
      resourceId: file.id,
      vendorId: file.vendorId,
      countryCode: file.countryCode,
      after: { purpose: file.purpose, reason: rejection },
      meta,
    });
    if (rejection) {
      throw Errors.uploadRejected(rejection);
    }
    return { fileId: file.id, status };
  }

  async downloadUrl(fileId: string, principal: AuthPrincipal, meta: RequestMeta) {
    return this.presign(await this.findOwned(fileId, principal, "view"), principal, meta, "file.viewed");
  }

  async purge(fileIds: readonly string[]): Promise<number> {
    const files = await this.prisma.storedFile.findMany({ where: { id: { in: [...fileIds] }, status: { not: "PURGED" } } });
    for (const file of files) {
      await this.storage.remove(file.objectKey);
      await this.storage.remove(file.objectKey.replace(/^incoming\//, "verified/"));
      await this.prisma.storedFile.update({ where: { id: file.id }, data: { status: "PURGED" } });
      await this.audit.record({
        actor: { userId: null, role: null },
        action: "file.purged",
        resourceType: "stored_file",
        resourceId: file.id,
        countryCode: file.countryCode,
        after: { purpose: file.purpose },
      });
    }
    return files.length;
  }

  vendorFiles(vendorId: string, fileIds: readonly string[], purpose: FilePurpose): Promise<Map<string, FileStatus>> {
    return this.statuses({ vendorId, purpose }, fileIds);
  }

  uploadedBy(ownerUserId: string, fileIds: readonly string[], purpose: FilePurpose): Promise<Map<string, FileStatus>> {
    return this.statuses({ ownerUserId, purpose }, fileIds);
  }

  async linkedDownloadUrl(fileId: string, purpose: FilePurpose, principal: AuthPrincipal, meta: RequestMeta) {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, purpose } });
    return this.presign(file, principal, meta, "file.viewed");
  }

  async reviewerDownloadUrl(fileId: string, vendorId: string, principal: AuthPrincipal, meta: RequestMeta) {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, vendorId, purpose: "KYC_DOCUMENT" } });
    return this.presign(file, principal, meta, "file.viewed_by_reviewer");
  }

  private async statuses(scope: { vendorId?: string; ownerUserId?: string; purpose: FilePurpose }, fileIds: readonly string[]): Promise<Map<string, FileStatus>> {
    if (fileIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.storedFile.findMany({ where: { ...scope, id: { in: [...fileIds] } }, select: { id: true, status: true } });
    return new Map(rows.map((row) => [row.id, row.status]));
  }

  async publicImageUrl(fileId: string): Promise<string> {
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, purpose: "PRODUCT_IMAGE", status: "VERIFIED" } });
    if (!file?.detectedMime) {
      throw Errors.notFound();
    }
    const mime = file.detectedMime as AllowedMime;
    return this.storage.presignDownload(file.objectKey, mime, `${file.id}.${EXTENSIONS[mime]}`);
  }

  private async presign(file: StoredFile | null, principal: AuthPrincipal, meta: RequestMeta, action: string) {
    if (!file || file.status !== "VERIFIED" || !file.detectedMime) {
      throw Errors.notFound();
    }
    const mime = file.detectedMime as AllowedMime;
    const url = await this.storage.presignDownload(file.objectKey, mime, `${file.id}.${EXTENSIONS[mime]}`);
    await this.audit.record({
      actor: { userId: principal.userId, role: principal.role },
      action,
      resourceType: "stored_file",
      resourceId: file.id,
      vendorId: file.vendorId,
      countryCode: file.countryCode,
      meta,
    });
    return { url, expiresInSeconds: DOWNLOAD_SECONDS };
  }

  private async inspect(file: StoredFile, key: string): Promise<string | null> {
    const head = await this.storage.head(key);
    if (!head) {
      return "The upload did not arrive. Try again.";
    }
    if (head.sizeBytes > file.maxBytes || head.sizeBytes === 0) {
      return "The uploaded file size does not match what was declared.";
    }
    const detected = detectMime(await this.storage.readPrefix(key, SIGNATURE_BYTES));
    if (detected !== file.declaredMime) {
      return "The file contents do not match its type.";
    }
    return null;
  }

  private async findOwned(fileId: string, principal: AuthPrincipal, access: "upload" | "view"): Promise<StoredFile> {
    const scope = principal.vendorId ? { vendorId: principal.vendorId } : { ownerUserId: principal.userId };
    const file = await this.prisma.storedFile.findFirst({ where: { id: fileId, ...scope } });
    if (!file || !hasPermission(principal.role, FILE_ACCESS[file.purpose][access])) {
      throw Errors.notFound();
    }
    return file;
  }
}
