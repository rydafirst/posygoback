import { PrismaService } from "../src/database/prisma.service";
import type { Warehouse } from "../src/generated/prisma/client";
import { AuditService } from "../src/infrastructure/audit/audit.service";
import { UsImporter } from "../src/migration/us-importer";
import { type ImportPlan, planUsImport } from "../src/migration/us-plan";
import { reconcile, renderReport } from "../src/migration/us-report";
import { readUsSnapshot } from "../src/migration/us-source";
import { WalletLedgerService } from "../src/modules/finance/wallets/wallet-ledger.service";
import { InventoryLedgerService } from "../src/modules/stock/inventory/inventory-ledger.service";
import { createStaff, flushRateLimits, resetDatabase, startApp, type TestApp } from "./harness";
import { as, query } from "./partner-helpers";
import { buildSource, IDS, OLD_PASSWORD, SOURCE_SCHEMA, sourceUrl } from "./us-source-fixture";

describe("moving US businesses from the old system", () => {
  let test: TestApp;
  let importer: UsImporter;
  let warehouse: Warehouse;
  let plan: ImportPlan;

  const snapshot = async () => planUsImport(await readUsSnapshot(sourceUrl(), SOURCE_SCHEMA));
  const blockers = (target: ImportPlan) => target.problems.filter((problem) => problem.severity === "BLOCKER").map((problem) => problem.detail);

  beforeAll(async () => {
    await resetDatabase();
    test = await startApp();
    await buildSource();
    const superAdmin = await createStaff(test, "super@gfn.test", "SUPER_ADMIN");
    await test
      .http()
      .post("/v1/warehouse/warehouses")
      .set(as(superAdmin))
      .send({ countryCode: "US", code: "NYC-1", name: "New York", addressLines: ["10 Water St"], city: "Brooklyn", region: "NY", postalCode: "11201" })
      .expect(201);
    importer = new UsImporter(test.app.get(PrismaService), test.app.get(WalletLedgerService), test.app.get(InventoryLedgerService), test.app.get(AuditService));
    warehouse = await importer.warehouse("NYC-1");
  });

  beforeEach(flushRateLimits);

  afterAll(async () => {
    await query(`DROP SCHEMA IF EXISTS ${SOURCE_SCHEMA} CASCADE`);
    await test.app.close();
  });

  it("plans the move from a read-only snapshot, leaving out closed, foreign and staff accounts", async () => {
    plan = await snapshot();
    expect(plan.vendors).toHaveLength(1);
    const [vendor] = plan.vendors;
    expect(vendor).toMatchObject({ businessName: "Brooklyn Braids", status: "ACTIVE", walletCents: 12_345 });
    expect(vendor!.users.map((user) => [user.email, user.role])).toEqual([
      ["owner@braids.example", "VENDOR_OWNER"],
      ["helper@braids.example", "VENDOR_MEMBER"],
    ]);
    const wig = vendor!.products.find((product) => product.sourceId === IDS.wig)!;
    expect(wig).toMatchObject({ sellable: 10, damaged: 2 });
    expect(wig.input).toMatchObject({ code: "WIG-22", weightGrams: 355, lengthMm: 254, hsCode: "670420", barcodes: [{ value: "4006381333931", symbology: "EAN13" }] });
    expect(vendor!.products.find((product) => product.sourceId === IDS.bonnet)!.input).toMatchObject({ code: "BONNET", variantLabel: "Pink" });
    expect(plan.problems.map((problem) => problem.severity)).not.toContain("BLOCKER");
    expect(plan.problems.some((problem) => problem.subject === "old-admin@braids.example" && problem.severity === "SKIPPED")).toBe(true);
    expect(plan.problems.some((problem) => problem.detail.startsWith("Barcode bad code! left off"))).toBe(true);
    expect(await importer.targetProblems(plan)).toEqual([]);
    const dryRun = await reconcile(test.app.get(PrismaService), plan, warehouse.id);
    expect(dryRun.every((check) => check.found === null)).toBe(true);
    expect(renderReport(plan, plan.problems, dryRun, "DRY RUN")).toContain("- Sellable units: 10");
  });

  it("moves the business, its people, products, stock and wallet, and every check matches", async () => {
    expect(await importer.importAll(plan, warehouse)).toEqual({ imported: 1, skipped: 0 });
    const checks = await reconcile(test.app.get(PrismaService), plan, warehouse.id);
    expect(checks.filter((check) => check.found !== check.expected)).toEqual([]);
    const [entry] = await query<{ type: string; amount_minor: string }>("SELECT type::text, amount_minor FROM ledger_entries l JOIN wallets w ON w.id = l.wallet_id WHERE w.currency = 'USD'");
    expect(entry).toEqual({ type: "CARRIED_OVER", amount_minor: "12345" });
    const lots = await query<{ condition: string; quantity_available: number }>("SELECT condition::text, quantity_available FROM stock_lots ORDER BY quantity_available DESC");
    expect(lots).toEqual([
      { condition: "SELLABLE", quantity_available: 10 },
      { condition: "DAMAGED", quantity_available: 2 },
    ]);
    expect((await query("SELECT 1 FROM custody_events WHERE type = 'RECEIVED'")).length).toBe(2);
    const login = await test.http().post("/v1/auth/login").send({ email: "owner@braids.example", password: OLD_PASSWORD }).expect(200);
    const me = (await test.http().get("/v1/auth/me").set(as(login.body.accessToken)).expect(200)).body;
    expect(me).toMatchObject({ role: "VENDOR_OWNER", countryCode: "US" });
    expect(renderReport(plan, plan.problems, checks, "APPLIED")).toContain("- Checks that don't match after moving: 0");
  });

  it("can be run again without moving anything twice", async () => {
    expect(await importer.importAll(await snapshot(), warehouse)).toEqual({ imported: 0, skipped: 1 });
    expect(Number((await query<{ count: string }>("SELECT count(*) FROM vendors WHERE country_code = 'US'"))[0]!.count)).toBe(1);
    expect(await importer.targetProblems(await snapshot())).toEqual([]);
  });

  it("refuses to move while orders, stock shipments or reserved stock are still in progress", async () => {
    await query(`INSERT INTO ${SOURCE_SCHEMA}.orders (vendor_id, status) VALUES ($1, 'PICKING')`, [IDS.vendor]);
    await query(`INSERT INTO ${SOURCE_SCHEMA}.psns (vendor_id, status) VALUES ($1, 'AWAITING_RECEIPT')`, [IDS.vendor]);
    await query(`UPDATE ${SOURCE_SCHEMA}.skus SET quantity_reserved = 1 WHERE id = 'UER-1'`);
    await query(`UPDATE ${SOURCE_SCHEMA}.wallets SET balance_cents = -100 WHERE vendor_id = $1`, [IDS.vendor]);
    await query(
      `INSERT INTO ${SOURCE_SCHEMA}.users (id, email, password_hash, role, vendor_id, status, email_verified) VALUES (gen_random_uuid(), 'super@gfn.test', '$argon2id$x', 'VENDOR_SUB_USER', $1, 'ACTIVE', true)`,
      [IDS.vendor],
    );
    const blocked = await snapshot();
    expect(blockers(blocked)).toEqual(
      expect.arrayContaining([
        "Has stock held for an order. Finish or cancel those orders first",
        "Wallet is overdrawn by 1.00 USD. Settle it first",
        "1 orders still being packed or waiting to ship",
        "1 stock shipments not yet fully received",
      ]),
    );
    expect((await importer.targetProblems(blocked)).map((problem) => problem.detail)).toEqual(["Already has an account on the new system"]);
  });
});
