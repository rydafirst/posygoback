import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { AppConfig } from "../../../config/config.schema";
import type { ObjectHead, ObjectStorage, PresignedUpload } from "./object-storage.port";

const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 300;

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    this.bucket = config.STORAGE_BUCKET;
    this.client = new S3Client({
      endpoint: config.STORAGE_ENDPOINT,
      region: config.STORAGE_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.STORAGE_ACCESS_KEY_ID, secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY },
    });
  }

  async presignUpload(key: string, contentType: string, sizeBytes: number): Promise<PresignedUpload> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes });
    const url = await getSignedUrl(this.client, command, { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(["content-type", "content-length"]) });
    return { url, headers: { "Content-Type": contentType }, expiresInSeconds: UPLOAD_TTL_SECONDS };
  }

  presignDownload(key: string, contentType: string, filename: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: `attachment; filename="${filename}"` });
    return getSignedUrl(this.client, command, { expiresIn: DOWNLOAD_TTL_SECONDS });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async readPrefix(key: string, bytes: number): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    const body = await result.Body?.transformToByteArray();
    return Buffer.from(body ?? []);
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({ Bucket: this.bucket, Key: targetKey, CopySource: `${this.bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`, MetadataDirective: "COPY" }),
    );
  }

  async writeOnce(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: "*" }));
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
