import { Pool } from "pg";

import { loadConfig } from "../src/config/config.schema";
import type { PartnerDetailView } from "../src/shared";
import { acceptStaffInvitation, flushRateLimits, type TestApp, uploadVerifiedFile } from "./harness";

export const as = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    return (await pool.query(text, values)).rows as T[];
  } finally {
    await pool.end();
  }
}

export function inDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const GB_RECIPIENT = { name: "Ada Obi", line1: "1 High Street", city: "Manchester", postalCode: "M1 1AA", countryCode: "GB" };

export function application(email: string, fullName: string, countryCode = "GB") {
  return {
    fullName,
    email,
    phone: countryCode === "US" ? "+1 212 555 0100" : "+44 7700 900123",
    countryCode,
    city: countryCode === "US" ? "Newark" : "Manchester",
    addressLines: ["12 Rose Street"],
    postalCode: countryCode === "US" ? "07102" : "M1 1AA",
    spaceDescription: "A dry, lockable spare room with shelving for about forty boxes.",
    heardFrom: "COMMUNITY_GROUP",
    referee: { name: "Pastor Bayo", contact: "bayo@example.com", relationship: "Church leader who has known me six years" },
    consent: true,
  };
}

export class PartnerFlow {
  constructor(private readonly test: TestApp) {}

  overview = async (token: string) => (await this.test.http().get("/v1/partner").set(as(token)).expect(200)).body as PartnerDetailView;

  async apply(email: string, fullName: string, countryCode = "GB"): Promise<{ token: string; partnerId: string }> {
    await flushRateLimits();
    await this.test
      .http()
      .post("/v1/public/partner-applications")
      .send(application(email, fullName, countryCode))
      .expect(202);
    const token = await acceptStaffInvitation(this.test, email);
    const me = await this.test.http().get("/v1/auth/me").set(as(token)).expect(200);
    return { token, partnerId: me.body.partnerId as string };
  }

  async files(token: string, count: number, purpose: string): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(await uploadVerifiedFile(this.test, token, purpose));
    }
    return ids;
  }

  async completeSteps(token: string, fullName: string, taxId = "1234567890"): Promise<void> {
    await flushRateLimits();
    await this.test.http().post("/v1/partner/identity/session").set(as(token)).expect(200);
    await this.test.http().post("/v1/partner/identity/refresh").set(as(token)).expect(200);
    const [proof] = await this.files(token, 1, "PROOF_OF_ADDRESS");
    await this.test
      .http()
      .put("/v1/partner/verification/proof-of-address")
      .set(as(token))
      .send({ documentType: "UTILITY_BILL", issuedOn: inDays(-20), fileId: proof })
      .expect(200);
    const photos = await this.files(token, 2, "PARTNER_EVIDENCE");
    await this.test.http().put("/v1/partner/verification/storage-space").set(as(token)).send({ description: "Spare room with metal shelving and a lockable door.", fileIds: photos }).expect(200);
    await this.test.http().put("/v1/partner/verification/work-status").set(as(token)).send({ declaration: true, taxId }).expect(200);
    const { agreements } = await this.overview(token);
    await this.test.http().post("/v1/partner/agreement/sign").set(as(token)).send({ documentId: agreements[0]!.documentId, signatureName: fullName, consent: true }).expect(200);
    await this.test.http().post("/v1/partner/payouts/setup").set(as(token)).expect(200);
    await this.test.http().post("/v1/partner/payouts/refresh").set(as(token)).expect(200);
    await this.test.http().post("/v1/partner/submit").set(as(token)).expect(200);
  }

  async acceptReviewedSteps(reviewer: string, partnerId: string): Promise<void> {
    for (const kind of ["REFERRAL", "STORAGE_SPACE"]) {
      await this.test.http().post(`/v1/admin/partners/${partnerId}/checks/${kind}/review`).set(as(reviewer)).send({ accept: true, note: "Checked and meets the standard." }).expect(201);
    }
    await this.test
      .http()
      .post(`/v1/admin/partners/${partnerId}/checks/PROOF_OF_ADDRESS/review`)
      .set(as(reviewer))
      .send({ accept: true, note: "Bill matches the storage address.", addressMatches: true })
      .expect(201);
  }

  async onboard(email: string, fullName: string, reviewer: string, approver: string, countryCode = "GB", taxId?: string): Promise<{ token: string; partnerId: string; hubId: string }> {
    const { token, partnerId } = await this.apply(email, fullName, countryCode);
    await this.completeSteps(token, fullName, taxId);
    await this.acceptReviewedSteps(reviewer, partnerId);
    const approved = await this.test.http().post(`/v1/admin/partners/${partnerId}/decisions/APPROVE`).set(as(approver)).send({ reason: "Every step meets the partner standard." }).expect(201);
    return { token, partnerId, hubId: (approved.body as PartnerDetailView).warehouses[0]!.id };
  }
}
