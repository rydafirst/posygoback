import { createHash, randomBytes } from "node:crypto";

import type { SignatureCertificateView, SignatureInput, SignatureMethod } from "../../../shared";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function signatureReference(): string {
  const bytes = randomBytes(10);
  return `PSG-${Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("")}`;
}

export function documentFingerprint(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function signatureColumns(signature: SignatureInput, body: string) {
  return {
    signatureName: signature.name.trim().replace(/\s+/g, " "),
    signatureMethod: signature.method,
    signatureImage: signature.image,
    documentSha256: documentFingerprint(body),
    reference: signatureReference(),
  };
}

export interface SignedRow {
  reference: string | null;
  signatureName: string | null;
  signatureMethod: string | null;
  signatureImage: string | null;
  documentSha256: string | null;
  acceptedAt: Date;
  ip: string | null;
}

export function toCertificate(row: SignedRow, document: { title: string; version: string }, signerEmail: string): SignatureCertificateView | null {
  if (!row.reference || !row.signatureName || !row.signatureImage || !row.documentSha256) {
    return null;
  }
  return {
    reference: row.reference,
    documentTitle: document.title,
    documentVersion: document.version,
    documentSha256: row.documentSha256,
    signerName: row.signatureName,
    signerEmail,
    method: row.signatureMethod as SignatureMethod,
    image: row.signatureImage,
    signedAt: row.acceptedAt.toISOString(),
    ip: row.ip,
  };
}
