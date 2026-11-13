import type Stripe from "stripe";

import { StripeConnectGateway } from "./stripe-partner-services";

function gatewayWith(detailsSubmitted: boolean) {
  const gateway = new StripeConnectGateway("sk_test_unit", "whsec_unit");
  const stripe = (gateway as unknown as { stripe: Stripe }).stripe;
  jest.spyOn(stripe.accounts, "retrieve").mockResolvedValue({ id: "acct_1", details_submitted: detailsSubmitted } as Stripe.Response<Stripe.Account>);
  const login = jest.spyOn(stripe.accounts, "createLoginLink").mockResolvedValue({ url: "https://connect.stripe.com/express/login" } as Stripe.Response<Stripe.LoginLink>);
  const onboarding = jest.spyOn(stripe.accountLinks, "create").mockResolvedValue({ url: "https://connect.stripe.com/setup/onboarding" } as Stripe.Response<Stripe.AccountLink>);
  return { gateway, login, onboarding };
}

describe("StripeConnectGateway.setupLink", () => {
  it("sends someone who hasn't finished setup to onboarding", async () => {
    const { gateway, login, onboarding } = gatewayWith(false);
    await expect(gateway.setupLink("acct_1", "https://posygo.com/back")).resolves.toBe("https://connect.stripe.com/setup/onboarding");
    expect(onboarding).toHaveBeenCalledWith({ account: "acct_1", type: "account_onboarding", return_url: "https://posygo.com/back", refresh_url: "https://posygo.com/back" });
    expect(login).not.toHaveBeenCalled();
  });

  it("sends someone with a finished account to Stripe to change their bank", async () => {
    const { gateway, login, onboarding } = gatewayWith(true);
    await expect(gateway.setupLink("acct_1", "https://posygo.com/back")).resolves.toBe("https://connect.stripe.com/express/login");
    expect(login).toHaveBeenCalledWith("acct_1");
    expect(onboarding).not.toHaveBeenCalled();
  });
});

describe("StripeConnectGateway.closeAccount", () => {
  const gatewayWithDelete = (result: () => Promise<unknown>) => {
    const gateway = new StripeConnectGateway("sk_test_unit", "whsec_unit");
    const stripe = (gateway as unknown as { stripe: Stripe }).stripe;
    const remove = jest.spyOn(stripe.accounts, "del").mockImplementation(result as never);
    return { gateway, stripe, remove };
  };

  it("deletes the connected account", async () => {
    const { gateway, remove } = gatewayWithDelete(() => Promise.resolve({ id: "acct_1", deleted: true }));
    await gateway.closeAccount("acct_1");
    expect(remove).toHaveBeenCalledWith("acct_1");
  });

  it("treats an account Stripe no longer has as already closed", async () => {
    const { gateway, stripe } = gatewayWithDelete(() => Promise.resolve());
    const missing = new (stripe.errors.StripeInvalidRequestError as unknown as new (raw: object) => Error)({ message: "No such account", code: "resource_missing" });
    jest.spyOn(stripe.accounts, "del").mockRejectedValue(missing);
    await expect(gateway.closeAccount("acct_gone")).resolves.toBeUndefined();
  });

  it("reports any other failure so the account is tried again later", async () => {
    const { gateway } = gatewayWithDelete(() => Promise.reject(new Error("Balance is not zero")));
    await expect(gateway.closeAccount("acct_1")).rejects.toThrow("Balance is not zero");
  });
});
