import { InMemoryEmailSender } from "../src/infrastructure/email/email.adapters";
import { InMemoryObjectStorage } from "../src/modules/files/storage/in-memory-object-storage";
import { flushRateLimits, resetDatabase, signUpAndVerify, startApp, type TestApp } from "./harness";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);
const HTML_DISGUISED_AS_PNG = Buffer.from("<html><script>alert(document.cookie)</script></html>");

describe("platform protections", () => {
  let first: TestApp;
  let second: TestApp;

  beforeAll(async () => {
    await resetDatabase();
    const shared = { email: new InMemoryEmailSender(), storage: new InMemoryObjectStorage() };
    first = await startApp(shared);
    second = await startApp(shared);
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await Promise.all([first.app.close(), second.app.close()]);
  });

  it("enforces one rate limit across every API instance", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const instance = attempt % 2 === 0 ? first : second;
      const response = await instance
        .http()
        .post("/v1/auth/login")
        .send({ email: `nobody${attempt}@example.com`, password: "irrelevant" });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it("accepts a genuine image and rejects a disguised script, deleting it", async () => {
    const vendor = await signUpAndVerify(first, "files@example.com");
    const auth = { Authorization: `Bearer ${vendor.accessToken}` };

    const good = await first.http().post("/v1/files/uploads").set(auth).send({ purpose: "PRODUCT_IMAGE", contentType: "image/png", sizeBytes: PNG.length }).expect(201);
    const goodKey = objectKey(good.body.upload.url);
    first.storage.put(goodKey, PNG);
    await first.http().post(`/v1/files/${good.body.fileId}/confirm`).set(auth).expect(200, { fileId: good.body.fileId, status: "VERIFIED" });

    first.storage.put(goodKey, HTML_DISGUISED_AS_PNG);
    const download = await first.http().get(`/v1/files/${good.body.fileId}/download-url`).set(auth).expect(200);
    const servedKey = objectKey(String(download.body.url)).replace("?download", "");
    expect(servedKey).not.toBe(goodKey);
    expect(first.storage.has(servedKey)).toBe(true);

    const bad = await first.http().post("/v1/files/uploads").set(auth).send({ purpose: "PRODUCT_IMAGE", contentType: "image/png", sizeBytes: HTML_DISGUISED_AS_PNG.length }).expect(201);
    const badKey = objectKey(bad.body.upload.url);
    first.storage.put(badKey, HTML_DISGUISED_AS_PNG);
    const rejected = await first.http().post(`/v1/files/${bad.body.fileId}/confirm`).set(auth).expect(400);
    expect(rejected.body.code).toBe("upload_rejected");
    expect(first.storage.has(badKey)).toBe(false);
    expect(first.storage.has(badKey.replace("incoming/", "verified/"))).toBe(false);
    await first.http().get(`/v1/files/${bad.body.fileId}/download-url`).set(auth).expect(404);
  });

  it("never lets one vendor reach another vendor's file", async () => {
    const owner = await signUpAndVerify(first, "owner@example.com");
    const intruder = await signUpAndVerify(first, "intruder@example.com");
    const upload = await first
      .http()
      .post("/v1/files/uploads")
      .set({ Authorization: `Bearer ${owner.accessToken}` })
      .send({ purpose: "KYC_DOCUMENT", contentType: "image/png", sizeBytes: PNG.length })
      .expect(201);
    first.storage.put(objectKey(upload.body.upload.url), PNG);
    await first
      .http()
      .post(`/v1/files/${upload.body.fileId}/confirm`)
      .set({ Authorization: `Bearer ${owner.accessToken}` })
      .expect(200);

    await first
      .http()
      .get(`/v1/files/${upload.body.fileId}/download-url`)
      .set({ Authorization: `Bearer ${intruder.accessToken}` })
      .expect(404);
    await first
      .http()
      .get(`/v1/files/${upload.body.fileId}/download-url`)
      .set({ Authorization: `Bearer ${owner.accessToken}` })
      .expect(200);
  });

  it("rejects malformed and oversized input before it reaches a service", async () => {
    const vendor = await signUpAndVerify(first, "input@example.com");
    const response = await first
      .http()
      .post("/v1/files/uploads")
      .set({ Authorization: `Bearer ${vendor.accessToken}` })
      .send({ purpose: "KYC_DOCUMENT", contentType: "text/html", sizeBytes: 10 })
      .expect(400);
    expect(response.body.code).toBe("validation_failed");
    await first
      .http()
      .post("/v1/auth/login")
      .set("Content-Type", "application/json")
      .send(`{"email":"${"a".repeat(200_000)}"}`)
      .expect(413);
  });

  it("answers health checks without authentication", async () => {
    await first
      .http()
      .get("/v1/health/ready")
      .expect(200, { status: "ok", checks: { database: true, cache: true } });
  });
});

function objectKey(uploadUrl: string): string {
  return uploadUrl.replace("memory://", "");
}
