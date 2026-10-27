import { sharesSite } from "./same-site";

describe("sharesSite", () => {
  it("treats an api subdomain of the website as the same site", () => {
    expect(sharesSite("https://api.posygo.com", "https://posygo.com")).toBe(true);
    expect(sharesSite("http://localhost:4000", "http://localhost:3000")).toBe(true);
  });

  it("spots a hosting address that the browser treats as another site", () => {
    expect(sharesSite("https://posygoback-production.up.railway.app", "https://posygo.com")).toBe(false);
  });
});
