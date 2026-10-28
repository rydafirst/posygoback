import { createHmac, randomUUID } from "node:crypto";

import type { PartnerDetailView, VerificationView } from "../src/shared";
import { canonicalJson, DiditIdentityProvider } from "../src/modules/identity/providers/didit-identity-provider";
import { IDENTITY_CHECK_PROVIDER } from "../src/modules/identity/providers/identity-check.port";
import { createStaff, flushRateLimits, resetDatabase, signUpAndVerify, startApp, type TestApp, uploadVerifiedFile, WEB_ORIGIN } from "./harness";
import { as, PartnerFlow, query } from "./partner-helpers";

const SECRET = "didit-test-webhook-secret";
const API_URL = "https://didit.test";

const ANSWERS = {
  businessType: "LIMITED_COMPANY",
  legalBusinessName: "Identity Hair Co Ltd",
  registrationCountryCode: "GB",
  companyNumber: "12345678",
  registeredAddress: { line1: "1 Market Street", city: "Manchester", postalCode: "M1 1AA" },
  contactFullName: "Adaeze Okafor",
  contactRole: "Director",
  contactPhone: "+447700900123",
  productsDescription: "Human hair wigs and extensions",
  monthlyUnits: "UP_TO_1000",
  monthlyOrders: "UP_TO_500",
  hazards: ["NONE"],
};

interface DiditSession {
  vendorData: string;
  callback: string;
  decision: Record<string, unknown>;
}

class FakeDidit {
  readonly sessions = new Map<string, DiditSession>();
  decisionReads = 0;

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if ((init?.headers as Record<string, string>)["x-api-key"] !== "didit-key") {
      return Promise.resolve(new Response("{}", { status: 403 }));
    }
    if (init?.method === "POST" && url.pathname === "/v3/session/") {
      const body = JSON.parse(init.body as string) as { vendor_data: string; callback: string; workflow_id: string };
      const existing = [...this.sessions.entries()].find(([, session]) => session.vendorData === body.vendor_data && session.decision.status === "Not Started");
      const sessionId = existing?.[0] ?? randomUUID();
      if (!existing) {
        this.sessions.set(sessionId, { vendorData: body.vendor_data, callback: body.callback, decision: { status: "Not Started" } });
      }
      return Promise.resolve(Response.json({ session_id: sessionId, session_token: "token", url: `https://verify.didit.test/session/${sessionId}`, status: "Not Started" }, { status: 201 }));
    }
    const match = /^\/v3\/session\/([^/]+)\/decision\/$/.exec(url.pathname);
    const session = match ? this.sessions.get(match[1]!) : undefined;
    if (init?.method === "GET" && session) {
      this.decisionReads += 1;
      return Promise.resolve(Response.json({ session_id: match![1], ...session.decision }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };

  sessionFor(vendorData: string): string {
    const found = [...this.sessions.entries()].filter(([, session]) => session.vendorData === vendorData).pop();
    if (!found) {
      throw new Error(`No session for ${vendorData}`);
    }
    return found[0];
  }

  decide(sessionId: string, decision: Record<string, unknown>): void {
    this.sessions.get(sessionId)!.decision = decision;
  }
}

function approved(name: string): Record<string, unknown> {
  const [first, ...rest] = name.split(" ");
  return {
    status: "Approved",
    id_verifications: [
      {
        status: "Approved",
        document_type: "Passport",
        issuing_state: "GBR",
        expiration_date: "2031-06-30",
        first_name: first,
        last_name: rest.join(" "),
        full_name: name,
        portrait_image: "https://media.didit.test/portrait.jpg?signature=short-lived",
      },
    ],
    liveness_checks: [{ status: "Approved" }],
    face_matches: [{ status: "Approved" }],
  };
}

function signedHeaders(body: string, options: { secret?: string; timestamp?: number; rawOnly?: boolean } = {}): Record<string, string> {
  const secret = options.secret ?? SECRET;
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const hmac = (content: string) => createHmac("sha256", secret).update(content).digest("hex");
  return { "content-type": "application/json", "x-timestamp": timestamp, ...(options.rawOnly ? { "x-signature": hmac(body) } : { "x-signature-v2": hmac(canonicalJson(JSON.parse(body))) }) };
}

describe("identity checks with Didit", () => {
  let test: TestApp;
  let didit: FakeDidit;
  let flow: PartnerFlow;

  const deliver = (sessionId: string, status: string, options: { eventId?: string; secret?: string; timestamp?: number; rawOnly?: boolean } = {}) => {
    const body = JSON.stringify({
      event_id: options.eventId ?? randomUUID(),
      webhook_type: "status.updated",
      session_id: sessionId,
      status,
      timestamp: Math.floor(Date.now() / 1000),
      metadata: { note: "café" },
    });
    return test.http().post("/v1/webhooks/didit").set(signedHeaders(body, options)).send(body);
  };

  async function vendor(email: string, name = ANSWERS.contactFullName): Promise<{ token: string; vendorId: string }> {
    const { accessToken: token } = await signUpAndVerify(test, email);
    const me = await test.http().get("/v1/auth/me").set(as(token)).expect(200);
    const documents = { businessDocument: await uploadVerifiedFile(test, token) };
    await test
      .http()
      .put("/v1/vendor/verification")
      .set(as(token))
      .send({ ...ANSWERS, contactFullName: name, documents })
      .expect(200);
    return { token, vendorId: me.body.vendorId as string };
  }

  const view = async (token: string) => (await test.http().get("/v1/vendor/verification").set(as(token)).expect(200)).body as VerificationView;

  beforeAll(async () => {
    await resetDatabase();
    didit = new FakeDidit();
    const provider = new DiditIdentityProvider({ apiKey: "didit-key", workflowId: randomUUID(), webhookSecret: SECRET, apiUrl: API_URL }, didit.fetch);
    test = await startApp(undefined, [[IDENTITY_CHECK_PROVIDER, provider]]);
    flow = new PartnerFlow(test);
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  describe("sellers", () => {
    let seller: { token: string; vendorId: string };
    let sessionId: string;

    it("starts a hosted check that returns to the verification page", async () => {
      seller = await vendor("seller@identity.test");
      const started = await test.http().post("/v1/vendor/verification/identity/session").set(as(seller.token)).expect(200);
      sessionId = didit.sessionFor(`vendor:${seller.vendorId}`);
      expect(started.body).toEqual({ url: `https://verify.didit.test/session/${sessionId}` });
      expect(didit.sessions.get(sessionId)!.callback).toBe(`${WEB_ORIGIN}/verification?identity=returned`);
      const again = await test.http().post("/v1/vendor/verification/identity/session").set(as(seller.token)).expect(200);
      expect(again.body.url).toBe(started.body.url);
      expect((await view(seller.token)).identityCheck).toMatchObject({ status: "PENDING", provider: "DIDIT" });
      const blocked = await test.http().post("/v1/vendor/verification/submit").set(as(seller.token)).expect(400);
      expect(blocked.body.fieldErrors.identity).toEqual(["Verify your identity first"]);
    });

    it("rejects webhooks with a wrong signature, a stale timestamp or no signature", async () => {
      didit.decide(sessionId, approved(ANSWERS.contactFullName));
      await deliver(sessionId, "Approved", { secret: "someone-else" }).expect(400);
      await deliver(sessionId, "Approved", { timestamp: Math.floor(Date.now() / 1000) - 600 }).expect(400);
      await test
        .http()
        .post("/v1/webhooks/didit")
        .set({ "content-type": "application/json", "x-timestamp": String(Math.floor(Date.now() / 1000)) })
        .send({ session_id: sessionId })
        .expect(400);
      expect((await view(seller.token)).identityCheck!.status).toBe("PENDING");
    });

    it("shows a check that's in review and doesn't start another", async () => {
      didit.decide(sessionId, { status: "In Review", id_verifications: [{ status: "In Review", document_type: "Passport", issuing_state: "GBR" }] });
      await deliver(sessionId, "In Review", { eventId: "evt-review" }).expect(200);
      expect((await view(seller.token)).identityCheck).toMatchObject({ status: "IN_REVIEW", documentType: "Passport", issuingCountry: "GBR" });
      await test.http().post("/v1/vendor/verification/identity/session").set(as(seller.token)).expect(409);
    });

    it("ignores a repeated event and fetches the decision rather than trusting the payload", async () => {
      didit.decide(sessionId, approved(ANSWERS.contactFullName));
      const reads = didit.decisionReads;
      await deliver(sessionId, "Approved", { eventId: "evt-review" }).expect(200);
      expect(didit.decisionReads).toBe(reads);
      expect((await view(seller.token)).identityCheck!.status).toBe("IN_REVIEW");
      await deliver(sessionId, "Declined", { eventId: "evt-approved" }).expect(200);
      await deliver(sessionId, "Declined", { eventId: "evt-approved" }).expect(200);
      expect(didit.decisionReads).toBe(reads + 1);
      const events = await query<{ count: string }>("SELECT count(*) FROM identity_webhook_events WHERE event_id IN ('evt-review', 'evt-approved')");
      expect(events[0]!.count).toBe("2");
    });

    it("keeps only the outcome of an approved check and shows it to reviewers", async () => {
      expect((await view(seller.token)).identityCheck).toMatchObject({
        status: "APPROVED",
        documentType: "Passport",
        issuingCountry: "GBR",
        documentExpiry: "2031-06-30",
        nameMatches: true,
        reason: null,
      });
      const [row] = await query<Record<string, unknown>>("SELECT * FROM identity_checks WHERE session_id = $1", [sessionId]);
      expect(JSON.stringify(row)).not.toContain("media.didit.test");
      expect(row).toMatchObject({ subject_type: "VENDOR", subject_id: seller.vendorId, provider: "DIDIT", status: "APPROVED" });
      await test.http().post("/v1/vendor/verification/submit").set(as(seller.token)).expect(200);
      const compliance = await createStaff(test, "compliance@identity.test", "COMPLIANCE");
      const detail = await test.http().get(`/v1/admin/verifications/${seller.vendorId}`).set(as(compliance)).expect(200);
      expect(detail.body.identityCheck).toMatchObject({ status: "APPROVED", provider: "DIDIT", nameMatches: true, documentType: "Passport" });
    });

    it("accepts the raw-body signature when the canonical one is missing", async () => {
      const other = await vendor("raw@identity.test", "Kemi Bello");
      await test.http().post("/v1/vendor/verification/identity/session").set(as(other.token)).expect(200);
      const otherSession = didit.sessionFor(`vendor:${other.vendorId}`);
      didit.decide(otherSession, approved("Kemi Bello"));
      await deliver(otherSession, "Approved", { rawOnly: true }).expect(200);
      expect((await view(other.token)).identityCheck!.status).toBe("APPROVED");
    });

    it("declines a failed check with a plain reason and lets the seller try again", async () => {
      const declined = await vendor("declined@identity.test", "Tunde Bakare");
      await test.http().post("/v1/vendor/verification/identity/session").set(as(declined.token)).expect(200);
      const first = didit.sessionFor(`vendor:${declined.vendorId}`);
      didit.decide(first, { status: "Declined", id_verifications: [{ status: "Approved" }], liveness_checks: [{ status: "Approved" }], face_matches: [{ status: "Declined" }] });
      await deliver(first, "Declined").expect(200);
      expect((await view(declined.token)).identityCheck).toMatchObject({ status: "DECLINED", reason: "your face didn't match the photo on your ID" });
      const blocked = await test.http().post("/v1/vendor/verification/submit").set(as(declined.token)).expect(400);
      expect(blocked.body.fieldErrors.identity).toEqual(["Your identity check didn't pass. Try it again."]);
      await test.http().post("/v1/vendor/verification/identity/session").set(as(declined.token)).expect(200);
      const second = didit.sessionFor(`vendor:${declined.vendorId}`);
      expect(second).not.toBe(first);
      didit.decide(second, approved("Tunde Bakare"));
      const refreshed = await test.http().post("/v1/vendor/verification/identity/refresh").set(as(declined.token)).expect(200);
      expect((refreshed.body as VerificationView).identityCheck!.status).toBe("APPROVED");
    });

    it("declines an approved check when the name on the ID isn't the contact's", async () => {
      const mismatch = await vendor("mismatch@identity.test", "Chidi Eze");
      await test.http().post("/v1/vendor/verification/identity/session").set(as(mismatch.token)).expect(200);
      const session = didit.sessionFor(`vendor:${mismatch.vendorId}`);
      didit.decide(session, approved("Someone Different"));
      await deliver(session, "Approved").expect(200);
      expect((await view(mismatch.token)).identityCheck).toMatchObject({ status: "DECLINED", nameMatches: false });
    });

    it("asks for a new check when the contact person changes", async () => {
      const changed = await vendor("changed@identity.test", "Ngozi Uche");
      await test.http().post("/v1/vendor/verification/identity/session").set(as(changed.token)).expect(200);
      const session = didit.sessionFor(`vendor:${changed.vendorId}`);
      didit.decide(session, approved("Ngozi Uche"));
      await deliver(session, "Approved").expect(200);
      expect((await view(changed.token)).identityCheck!.status).toBe("APPROVED");
      await test.http().put("/v1/vendor/verification").set(as(changed.token)).send({ contactFullName: "Ifeoma Uche" }).expect(200);
      expect((await view(changed.token)).identityCheck).toBeNull();
    });
  });

  describe("partners", () => {
    const identityOf = (overview: PartnerDetailView) => overview.checks.find((check) => check.kind === "IDENTITY")!;

    async function partnerSession(email: string, name: string): Promise<{ token: string; sessionId: string }> {
      const { token, partnerId } = await flow.apply(email, name);
      const started = await test.http().post("/v1/partner/identity/session").set(as(token)).expect(200);
      const sessionId = didit.sessionFor(`partner:${partnerId}`);
      expect(started.body.url).toBe(`https://verify.didit.test/session/${sessionId}`);
      expect(didit.sessions.get(sessionId)!.callback).toBe(`${WEB_ORIGIN}/admin/partnership?identity=returned`);
      return { token, sessionId };
    }

    it("holds the step while Didit reviews, then accepts it once approved", async () => {
      const { token, sessionId } = await partnerSession("approved@partner.test", "Ada Obi");
      await deliver(sessionId, "Approved", { secret: "wrong" }).expect(400);
      didit.decide(sessionId, { status: "In Review" });
      await deliver(sessionId, "In Review").expect(200);
      expect(identityOf(await flow.overview(token))).toMatchObject({ status: "SUBMITTED", details: { provider: "DIDIT", inReview: true } });
      didit.decide(sessionId, approved("Ada Obi"));
      const event = randomUUID();
      await deliver(sessionId, "Approved", { eventId: event }).expect(200);
      await deliver(sessionId, "Approved", { eventId: event }).expect(200);
      expect(identityOf(await flow.overview(token)).status).toBe("ACCEPTED");
      const [row] = await query<{ details: Record<string, unknown> }>("SELECT details FROM partner_checks WHERE details->>'sessionId' = $1", [sessionId]);
      expect(Object.keys(row!.details).sort()).toEqual(["provider", "sessionId", "verifiedAt"]);
      const audit = await query<{ count: string }>("SELECT count(*) FROM audit_log_entries WHERE action = 'partner.identity_verified'");
      expect(audit[0]!.count).toBe("1");
    });

    it("rejects the step with the reason when Didit declines", async () => {
      const { token, sessionId } = await partnerSession("declined@partner.test", "Bisi Ade");
      didit.decide(sessionId, { status: "Declined", id_verifications: [{ status: "Declined" }], liveness_checks: [{ status: "Declined" }] });
      await deliver(sessionId, "Declined").expect(200);
      const check = identityOf(await flow.overview(token));
      expect(check).toMatchObject({ status: "REJECTED", reviewNote: "The identity check didn't pass: we couldn't verify your ID document; the live selfie check didn't pass" });
      await test.http().post("/v1/partner/identity/session").set(as(token)).expect(200);
      expect(identityOf(await flow.overview(token)).status).toBe("SUBMITTED");
    });

    it("picks up the result on refresh when the partner returns before the webhook", async () => {
      const { token, sessionId } = await partnerSession("refresh@partner.test", "Chika Nwosu");
      didit.decide(sessionId, approved("Chika Nwosu"));
      const refreshed = await test.http().post("/v1/partner/identity/refresh").set(as(token)).expect(200);
      expect(identityOf(refreshed.body as PartnerDetailView).status).toBe("ACCEPTED");
    });

    it("ignores Stripe Identity events while Didit is in use", async () => {
      await test.http().post("/v1/webhooks/stripe-identity").set({ "content-type": "application/json", "stripe-signature": "t=1,v1=bad" }).send({ id: "evt" }).expect(200);
    });
  });
});
