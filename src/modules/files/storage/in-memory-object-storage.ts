import type { ObjectHead, ObjectStorage, PresignedUpload } from "./object-storage.port";

export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  put(key: string, body: Buffer): void {
    this.objects.set(key, body);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  presignUpload(key: string, contentType: string): Promise<PresignedUpload> {
    return Promise.resolve({ url: `memory://${key}`, headers: { "Content-Type": contentType }, expiresInSeconds: 300 });
  }

  presignDownload(key: string): Promise<string> {
    return Promise.resolve(`memory://${key}?download`);
  }

  head(key: string): Promise<ObjectHead | null> {
    const object = this.objects.get(key);
    return Promise.resolve(object ? { sizeBytes: object.length } : null);
  }

  readPrefix(key: string, bytes: number): Promise<Buffer> {
    return Promise.resolve((this.objects.get(key) ?? Buffer.alloc(0)).subarray(0, bytes));
  }

  copy(sourceKey: string, targetKey: string): Promise<void> {
    const object = this.objects.get(sourceKey);
    if (object) {
      this.objects.set(targetKey, Buffer.from(object));
    }
    return Promise.resolve();
  }

  writeOnce(key: string, body: Buffer): Promise<void> {
    if (this.objects.has(key)) {
      return Promise.reject(new Error(`${key} already exists`));
    }
    this.objects.set(key, body);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
