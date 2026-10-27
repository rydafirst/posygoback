import { EmailDeliveryError, ResendTransport } from "./email.adapters";
import { plainText, renderHtml } from "./email-layout";
import { loggedSubject } from "./recorded-email.sender";

const SETTINGS = { apiKey: "re_test_key", from: "Posygo <hello@posygo.com>", replyTo: "help@posygo.com", siteUrl: "https://posygo.com" };
const MESSAGE = {
  to: "ada@example.test",
  subject: "Reset your password",
  text: "Use this link within 30 minutes.\n\nPosygo",
  kind: "auth.password_reset",
  action: { label: "Choose a new password", url: "https://posygo.com/reset-password#token=abc" },
};

describe("email", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("renders a branded email with a button, escaping anything that could be read as HTML", () => {
    const html = renderHtml({ ...MESSAGE, text: "Hi <script>alert(1)</script>\n\nSee https://posygo.com/orders" }, SETTINGS.siteUrl);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('href="https://posygo.com/orders"');
    expect(html).toContain("Choose a new password");
    expect(plainText(MESSAGE)).toContain("Choose a new password: https://posygo.com/reset-password#token=abc");
  });

  it("shows the button's link only as the button, keeping it in the plain-text version", () => {
    const url = MESSAGE.action.url;
    const text = `Set a password to continue (the link lasts 3 days):\n${url}\n\nIf you didn't apply, ignore this email.`;
    const html = renderHtml({ ...MESSAGE, text }, SETTINGS.siteUrl);
    expect(html.split(url)).toHaveLength(2);
    expect(html).toContain("Set a password to continue (the link lasts 3 days).<");
    expect(renderHtml({ ...MESSAGE, text: `Reset it here: ${url}. It expires soon.` }, SETTINGS.siteUrl)).toContain("Reset it here. It expires soon.");
    expect(plainText({ ...MESSAGE, text })).toContain(url);
  });

  it("sends through Resend with the sender, reply address, both versions and a tag for the kind of email", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: "re_123" }) });
    global.fetch = fetchMock;
    expect(await new ResendTransport(SETTINGS).deliver(MESSAGE)).toEqual({ providerId: "re_123" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_key" });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ from: "Posygo <hello@posygo.com>", to: ["ada@example.test"], reply_to: "help@posygo.com", tags: [{ name: "kind", value: "auth_password_reset" }] });
    expect(body.html).toEqual(expect.stringContaining("Choose a new password"));
  });

  it("tries again after a temporary failure, but not after the email was refused", async () => {
    const waits: number[] = [];
    const wait = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: "re_456" }) });
    expect(await new ResendTransport(SETTINGS, wait).deliver(MESSAGE)).toEqual({ providerId: "re_456" });
    expect(waits).toEqual([500, 1500]);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 422, json: () => Promise.resolve({ message: "Invalid `to` field" }) });
    await expect(new ResendTransport(SETTINGS, wait).deliver(MESSAGE)).rejects.toEqual(new EmailDeliveryError("The email service replied 422 Invalid `to` field", false));
  });

  it("never keeps codes in the email log", () => {
    expect(loggedSubject("48213907 is your verification code")).toBe("•••••• is your verification code");
  });
});
