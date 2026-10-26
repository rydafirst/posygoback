export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface ObjectHead {
  sizeBytes: number;
}

export interface ObjectStorage {
  presignUpload(key: string, contentType: string, sizeBytes: number): Promise<PresignedUpload>;
  presignDownload(key: string, contentType: string, filename: string): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  readPrefix(key: string, bytes: number): Promise<Buffer>;
  copy(sourceKey: string, targetKey: string): Promise<void>;
  remove(key: string): Promise<void>;
  writeOnce(key: string, body: Buffer, contentType: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");
