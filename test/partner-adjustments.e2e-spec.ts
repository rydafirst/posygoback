import type { AdjustmentView, PartnerStatementView } from "../src/shared";
import { createStaff, flushRateLimits, insertLegalDocument, resetDatabase, startApp, type TestApp } from "./harness";
import { as, PartnerFlow } from "./partner-helpers";

describe("crediting and debiting a partner's earnings", () => {
  let test: TestApp;
  let financeA: string;
  let financeB: string;
  let partner: { token: string; partnerId: string };

  const statement = async () => (await test.http().get("/v1/partner/statement").set(as(partner.token)).expect(200)).body as PartnerStatementView;
  const adjust = (token: string, direction: "CREDIT" | "DEBIT", amountMinor: number, reason: string) =>
    test.http().post(`/v1/admin/finance/partners/${partner.partnerId}/adjustments`).set(as(token)).send({ direction, amountMinor, reason });

  beforeAll(async () => {
    await resetDatabase();
    await insertLegalDocument("GB", "PARTNER_AGREEMENT", "1.0");
    test = await startApp();
    const staffMember = async (email: string, role: string) => {
      await flushRateLimits();
      return createStaff(test, email, role);
    };
    const superAdmin = await staffMember("super@gfn.test", "SUPER_ADMIN");
    const compliance = await staffMember("compliance@gfn.test", "COMPLIANCE");
    financeA = await staffMember("finance-a@gfn.test", "FINANCE_ADMIN");
    financeB = await staffMember("finance-b@gfn.test", "FINANCE_ADMIN");
    await flushRateLimits();
    partner = await new PartnerFlow(test).onboard("lead@partner.test", "Ada Obi", compliance, superAdmin);
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  it("adds a small credit straight away and tells the partner", async () => {
    const credited = (await adjust(financeA, "CREDIT", 1_000, "Refund for a damaged bag we supplied").expect(201)).body as AdjustmentView;
    expect(credited).toMatchObject({ accountKind: "PARTNER", accountId: partner.partnerId, walletId: null, status: "APPLIED", currency: "GBP" });
    expect((await statement()).availableMinor).toBe(1_000);
  });

  it("holds a large debit for a second person, and never takes earnings below zero", async () => {
    const pending = (await adjust(financeA, "DEBIT", 60_000, "Recovering two lost parcels from this hub").expect(201)).body as AdjustmentView;
    expect(pending.status).toBe("PENDING_APPROVAL");
    await test.http().post(`/v1/admin/finance/adjustments/${pending.id}/decision`).set(as(financeA)).send({ approve: true, note: "Self approval" }).expect(403);
    const refused = await test.http().post(`/v1/admin/finance/adjustments/${pending.id}/decision`).set(as(financeB)).send({ approve: true, note: "Matches the claim" }).expect(409);
    expect(refused.body.message).toBe("This partner has £10.00 available, and their earnings can't go below zero.");
    await test.http().post(`/v1/admin/finance/adjustments/${pending.id}/decision`).set(as(financeB)).send({ approve: false, note: "Too much for this hub" }).expect(200);
    await adjust(financeA, "DEBIT", 600, "Replacement tape charged to the hub").expect(201);
    expect((await statement()).availableMinor).toBe(400);
  });

  it("lists partner adjustments beside vendor ones and keeps them away from partners", async () => {
    const listed = (await test.http().get(`/v1/admin/finance/adjustments?partnerId=${partner.partnerId}`).set(as(financeB)).expect(200)).body as AdjustmentView[];
    expect(listed.map((row) => [row.direction, row.amountMinor, row.status])).toEqual([
      ["DEBIT", 600, "APPLIED"],
      ["DEBIT", 60_000, "REJECTED"],
      ["CREDIT", 1_000, "APPLIED"],
    ]);
    await adjust(partner.token, "CREDIT", 100, "Partners can't adjust themselves").expect(404);
  });
});
