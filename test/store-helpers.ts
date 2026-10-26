import type { CheckoutStartedView } from "../src/shared";
import { StorefrontFulfilmentService } from "../src/modules/commerce/orders/storefront-fulfilment.service";
import { CarrierAccountsService } from "../src/modules/orders/carriers/carrier-accounts.service";
import { SandboxCarrier } from "../src/modules/orders/carriers/sandbox.carrier";
import { createStaff, fundWallet, makeVendorTrade, seedStock, signUpAndVerify, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";

export const SHIP_TO = { name: "Chioma Eze", line1: "8 Deansgate", city: "Manchester", postalCode: "M3 4LQ", countryCode: "GB" };

export interface OpenStore {
  slug: string;
  owner: string;
  vendorId: string;
  productId: string;
  superAdmin: string;
}

export async function openStore(test: TestApp, handle: string): Promise<OpenStore> {
  const http = () => test.http();
  test.app.get(CarrierAccountsService).register("GB", new SandboxCarrier());
  const owner = (await signUpAndVerify(test, `${handle}@store.example`)).accessToken;
  const vendorId = (await http().get("/v1/auth/me").set(as(owner))).body.vendorId as string;
  await makeVendorTrade(vendorId);
  await fundWallet(vendorId, 50_000);
  const superAdmin = await createStaff(test, `super-${handle}@gfn.test`, "SUPER_ADMIN");
  const warehouse = await http()
    .post("/v1/warehouse/warehouses")
    .set(as(superAdmin))
    .send({ countryCode: "GB", code: `W-${handle.slice(0, 6).toUpperCase()}`, name: `Warehouse ${handle}`, addressLines: ["Unit 4, Trafford Park"], city: "Manchester", postalCode: "M17 1AA" })
    .expect(201);
  const productId = (
    await http()
      .post("/v1/vendor/products")
      .set(as(owner))
      .send({
        countryOfOrigin: "CN",
        declaredValueMinor: 4500,
        weightGrams: 350,
        storageTier: "SMALL",
        code: `${handle}-1`,
        name: "Body wave wig",
        barcodes: [{ value: `${handle.toUpperCase()}-1`, symbology: "CODE128" }],
      })
      .expect(201)
  ).body.id as string;
  await seedStock({ vendorId, productId, warehouseId: warehouse.body.id, quantity: 20 });
  const slug = `${handle}-store`;
  await http()
    .put("/v1/vendor/storefront")
    .set(as(owner))
    .send({ slug, displayName: `${handle} store`, tone: "pink", returnsAllowed: true, returnWindowDays: 30 })
    .expect(200);
  await http().put(`/v1/vendor/storefront/listings/${productId}`).set(as(owner)).send({ listed: true, retailPriceMinor: 6_000 }).expect(200);
  await http().post("/v1/vendor/storefront/payouts/setup").set(as(owner)).expect(200);
  await http().post("/v1/vendor/storefront/payouts/refresh").set(as(owner)).expect(200);
  await http().post("/v1/vendor/storefront/go-live").set(as(owner)).expect(200);
  return { slug, owner, vendorId, productId, superAdmin };
}

export async function paidOrder(test: TestApp, store: OpenStore, buyerEmail: string, extra: Record<string, unknown> = {}): Promise<{ id: string; reference: string }> {
  const started = (
    await test
      .http()
      .post(`/v1/public/stores/${store.slug}/checkout`)
      .send({ items: [{ productId: store.productId, quantity: 1 }], shipTo: SHIP_TO, buyerEmail, buyerName: "Chioma Eze", deliverySpeed: "STANDARD", ...extra })
      .expect(200)
  ).body as CheckoutStartedView;
  await test.http().post(`/v1/public/storefront-orders/${started.reference}/sandbox-payment`).expect(200);
  const [row] = await query<{ id: string }>("SELECT id FROM storefront_orders WHERE reference = $1", [started.reference]);
  return { id: row!.id, reference: started.reference };
}

export async function handOff(test: TestApp, storefrontOrderId: string): Promise<void> {
  const steps = ["PENDING_PACKING", "PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "SHIPPING_PAID", "LABEL_PURCHASED", "HANDED_OFF"];
  for (let step = 1; step < steps.length; step += 1) {
    await query("UPDATE orders SET status = $3::order_status WHERE id = (SELECT fulfilment_order_id FROM storefront_orders WHERE id = $1) AND status = $2::order_status", [
      storefrontOrderId,
      steps[step - 1],
      steps[step],
    ]);
  }
  await test.app.get(StorefrontFulfilmentService).syncShipping();
}
