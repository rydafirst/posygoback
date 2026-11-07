import type { AccountView, MySupportRequestView } from "../src/shared";
import { createStaff, flushRateLimits, makeVendorTrade, refreshCookie, resetDatabase, signUpAndVerify, startApp, type TestApp, WEB_ORIGIN } from "./harness";
import { as, query } from "./partner-helpers";

const PASSWORD = "a long enough password";

function tokenFrom(text: string): string {
  return decodeURIComponent(/#token=([^\s]+)/.exec(text)![1]!);
}

describe("people managing their own account", () => {
  let test: TestApp;
  let owner: { accessToken: string; cookie: string };
  let vendorId: string;
  let admin: string;

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
    owner = await signUpAndVerify(test, "owner@account.test");
    vendorId = (await test.http().get("/v1/auth/me").set(as(owner.accessToken))).body.vendorId;
    await makeVendorTrade(vendorId);
    admin = await createStaff(test, "admin@gfn.test", "ADMIN");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await test.app.close();
  });

  const signIn = async (email: string, password: string) => {
    const response = await test.http().post("/v1/auth/login").send({ email, password }).expect(200);
    return { accessToken: response.body.accessToken as string, cookie: refreshCookie(response.headers["set-cookie"]) };
  };

  describe("changing the password", () => {
    it("needs the current password", async () => {
      const response = await test.http().post("/v1/account/password").set(as(owner.accessToken)).send({ currentPassword: "not my password", password: "a brand new password" }).expect(400);
      expect(response.body.fieldErrors).toEqual({ currentPassword: ["That isn't your current password"] });
    });

    it("refuses the password already in use", async () => {
      await test.http().post("/v1/account/password").set(as(owner.accessToken)).send({ currentPassword: PASSWORD, password: PASSWORD }).expect(400);
    });

    it("changes it, keeps this device signed in, signs out the others and tells the owner", async () => {
      const other = await signIn("owner@account.test", PASSWORD);
      await test.http().post("/v1/account/password").set(as(owner.accessToken)).send({ currentPassword: PASSWORD, password: "a brand new password" }).expect(204);
      await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", other.cookie).expect(401);
      owner.cookie = refreshCookie((await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", owner.cookie).expect(200)).headers["set-cookie"]);
      expect(test.email.lastTo("owner@account.test")?.subject).toBe("Your password was changed");
      await test.http().post("/v1/auth/login").send({ email: "owner@account.test", password: PASSWORD }).expect(401);
      owner = await signIn("owner@account.test", "a brand new password");
    });
  });

  describe("changing the email", () => {
    it("refuses an email another account already uses", async () => {
      const response = await test.http().post("/v1/account/email").set(as(owner.accessToken)).send({ currentPassword: "a brand new password", email: "admin@gfn.test" }).expect(400);
      expect(response.body.fieldErrors).toEqual({ email: ["Another account uses this email"] });
    });

    it("waits for the new address to be confirmed, and can be cancelled", async () => {
      const pending = await test.http().post("/v1/account/email").set(as(owner.accessToken)).send({ currentPassword: "a brand new password", email: "first@account.test" }).expect(202);
      expect(pending.body).toEqual<AccountView>({ email: "owner@account.test", pendingEmail: "first@account.test" });
      const token = tokenFrom(test.email.lastTo("first@account.test")!.text);
      expect(test.email.lastTo("owner@account.test")?.subject).toBe("Someone asked to change your sign-in email");
      const cancelled = await test.http().delete("/v1/account/email").set(as(owner.accessToken)).expect(200);
      expect(cancelled.body).toEqual<AccountView>({ email: "owner@account.test", pendingEmail: null });
      await test.http().post("/v1/account/email/confirm").send({ token }).expect(400);
    });

    it("switches the sign-in email once confirmed, signs everyone out and tells both addresses", async () => {
      await test.http().post("/v1/account/email").set(as(owner.accessToken)).send({ currentPassword: "a brand new password", email: "new@account.test" }).expect(202);
      const token = tokenFrom(test.email.lastTo("new@account.test")!.text);
      await test.http().post("/v1/account/email/confirm").send({ token }).expect(204);
      await test.http().post("/v1/account/email/confirm").send({ token }).expect(400);
      await test.http().post("/v1/auth/refresh").set("Origin", WEB_ORIGIN).set("Cookie", owner.cookie).expect(401);
      expect(test.email.lastTo("owner@account.test")?.subject).toBe("Your sign-in email was changed");
      await test.http().post("/v1/auth/login").send({ email: "owner@account.test", password: "a brand new password" }).expect(401);
      owner = await signIn("new@account.test", "a brand new password");
      expect((await test.http().get("/v1/account").set(as(owner.accessToken)).expect(200)).body).toEqual<AccountView>({ email: "new@account.test", pendingEmail: null });
    });
  });

  describe("requests to close the account or get a copy of the data", () => {
    it("lets only the owner ask to close the account", async () => {
      await test.http().post("/v1/vendor/team/invitations").set(as(owner.accessToken)).send({ email: "member@account.test" }).expect(202);
      const token = tokenFrom(test.email.lastTo("member@account.test")!.text);
      const member = (await test.http().post("/v1/invitations/accept").send({ token, password: "a member's own password" }).expect(200)).body.accessToken as string;
      await test.http().post("/v1/support-cases/requests").set(as(member)).send({ kind: "ACCOUNT_CLOSURE" }).expect(403);
      await test.http().post("/v1/support-cases/requests").set(as(member)).send({ kind: "DATA_COPY" }).expect(201);
      await test.http().post("/v1/support-cases/requests").set(as(admin)).send({ kind: "ACCOUNT_CLOSURE" }).expect(403);
    });

    it("opens one case per request, tells the team and lists it for the person who asked", async () => {
      const first = await test.http().post("/v1/support-cases/requests").set(as(owner.accessToken)).send({ kind: "ACCOUNT_CLOSURE", message: "We're stopping trading" }).expect(201);
      expect(first.body).toEqual({ reference: expect.stringMatching(/^CASE-/), alreadyKnown: false });
      expect(test.email.lastTo("help@gfn.test")?.subject).toBe(`${first.body.reference}: someone asked to close their account`);
      const again = await test.http().post("/v1/support-cases/requests").set(as(owner.accessToken)).send({ kind: "ACCOUNT_CLOSURE" }).expect(201);
      expect(again.body).toEqual({ reference: first.body.reference, alreadyKnown: true });

      const listed = (await test.http().get("/v1/admin/support-cases?status=OPEN&kind=ACCOUNT_CLOSURE,DATA_COPY").set(as(admin)).expect(200)).body as Array<{ kind: string }>;
      expect(listed.map((entry) => entry.kind).sort()).toEqual(["ACCOUNT_CLOSURE", "DATA_COPY"]);
      await test.http().get("/v1/admin/support-cases?kind=ERROR,NOPE").set(as(admin)).expect(400);

      const mine = (await test.http().get("/v1/support-cases").set(as(owner.accessToken)).expect(200)).body as MySupportRequestView[];
      expect(mine).toEqual([expect.objectContaining({ reference: first.body.reference, kind: "ACCOUNT_CLOSURE", status: "OPEN", message: "We're stopping trading", resolutionNote: null })]);
    });

    it("shows the team's answer to the person who asked, and only to them", async () => {
      const [row] = await query<{ id: string }>("SELECT id FROM support_cases WHERE kind = 'ACCOUNT_CLOSURE'");
      await test.http().post(`/v1/admin/support-cases/${row!.id}/resolve`).set(as(admin)).send({ note: "Closed. Your stock was collected on Monday." }).expect(200);
      const mine = (await test.http().get("/v1/support-cases").set(as(owner.accessToken)).expect(200)).body as MySupportRequestView[];
      expect(mine[0]).toMatchObject({ status: "RESOLVED", resolutionNote: "Closed. Your stock was collected on Monday." });
      expect(test.email.lastTo("new@account.test")).toMatchObject({ subject: "We've dealt with your request to close your account" });
      expect(test.email.lastTo("new@account.test")?.action).toBeUndefined();
      const feed = (await test.http().get("/v1/notifications").set(as(owner.accessToken)).expect(200)).body as { items: Array<{ title: string }> };
      expect(feed.items[0]?.title).toBe("We've dealt with your request to close your account");
    });
  });
});
