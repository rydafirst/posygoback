import { createUploadSchema, detectMime } from "./file-policy";

describe("detectMime", () => {
  it("recognises allowed formats from their first bytes", () => {
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectMime(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(detectMime(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectMime(Buffer.from("\x00\x00\x00\x18ftypheic", "latin1"))).toBe("image/heic");
  });

  it("rejects HTML or scripts renamed as images", () => {
    expect(detectMime(Buffer.from("<html><script>"))).toBeNull();
    expect(detectMime(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("createUploadSchema", () => {
  it("rejects a type not allowed for the purpose", () => {
    const result = createUploadSchema.safeParse({ purpose: "LABEL_DOCUMENT", contentType: "image/jpeg", sizeBytes: 100 });
    expect(result.success).toBe(false);
  });

  it("rejects oversize files", () => {
    const result = createUploadSchema.safeParse({ purpose: "KYC_DOCUMENT", contentType: "application/pdf", sizeBytes: 50 * 1024 * 1024 });
    expect(result.success).toBe(false);
  });
});
