import type { Permission } from "../../shared";
import { z } from "zod";

export const FILE_PURPOSES = ["KYC_DOCUMENT", "EVIDENCE_PHOTO", "PRODUCT_IMAGE", "LABEL_DOCUMENT", "GENERAL_ATTACHMENT", "PARTNER_EVIDENCE", "PROOF_OF_ADDRESS", "STOCK_COUNT"] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export type AllowedMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf" | "video/mp4" | "video/quicktime";

const MB = 1024 * 1024;

export const FILE_RULES: Record<FilePurpose, { mimes: readonly AllowedMime[]; maxBytes: number }> = {
  KYC_DOCUMENT: { mimes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 10 * MB },
  EVIDENCE_PHOTO: { mimes: ["image/jpeg", "image/png", "image/webp", "image/heic"], maxBytes: 15 * MB },
  PRODUCT_IMAGE: { mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * MB },
  LABEL_DOCUMENT: { mimes: ["application/pdf", "image/png"], maxBytes: 5 * MB },
  GENERAL_ATTACHMENT: { mimes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 10 * MB },
  PARTNER_EVIDENCE: { mimes: ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "video/mp4", "video/quicktime"], maxBytes: 100 * MB },
  PROOF_OF_ADDRESS: { mimes: ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"], maxBytes: 10 * MB },
  STOCK_COUNT: { mimes: ["video/mp4", "video/quicktime", "image/jpeg", "image/png", "image/heic"], maxBytes: 200 * MB },
};

export const FILE_ACCESS: Record<FilePurpose, { upload: Permission; view: Permission }> = {
  KYC_DOCUMENT: { upload: "vendor.verification.manage", view: "vendor.verification.manage" },
  EVIDENCE_PHOTO: { upload: "inbound.receive", view: "inbound.receive" },
  PRODUCT_IMAGE: { upload: "vendor.stock.manage", view: "vendor.stock.read" },
  LABEL_DOCUMENT: { upload: "vendor.stock.manage", view: "vendor.stock.read" },
  GENERAL_ATTACHMENT: { upload: "vendor.portal.access", view: "vendor.portal.access" },
  PARTNER_EVIDENCE: { upload: "partner.profile.manage", view: "partner.profile.manage" },
  PROOF_OF_ADDRESS: { upload: "partner.profile.manage", view: "partner.profile.manage" },
  STOCK_COUNT: { upload: "inventory.read", view: "inventory.read" },
};

export const EXTENSIONS: Record<AllowedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export const createUploadSchema = z
  .object({
    purpose: z.enum(FILE_PURPOSES),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "video/mp4", "video/quicktime"]),
    sizeBytes: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    const rule = FILE_RULES[value.purpose];
    if (!rule.mimes.includes(value.contentType)) {
      context.addIssue({ code: "custom", path: ["contentType"], message: "This file type is not accepted here" });
    }
    if (value.sizeBytes > rule.maxBytes) {
      context.addIssue({ code: "custom", path: ["sizeBytes"], message: `Files must be under ${rule.maxBytes / MB} MB` });
    }
  });

export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export const SIGNATURE_BYTES = 16;

export function detectMime(prefix: Buffer): AllowedMime | null {
  const ascii = (start: number, end: number) => prefix.subarray(start, end).toString("latin1");
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return "image/jpeg";
  }
  if (prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii(0, 5) === "%PDF-") {
    return "application/pdf";
  }
  if (ascii(4, 8) === "ftyp" && ["heic", "heix", "mif1", "msf1", "hevc"].includes(ascii(8, 12))) {
    return "image/heic";
  }
  if (ascii(4, 8) === "ftyp" && ascii(8, 12) === "qt  ") {
    return "video/quicktime";
  }
  if (ascii(4, 8) === "ftyp" && ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(ascii(8, 12))) {
    return "video/mp4";
  }
  return null;
}
