import type { PrismaService } from "../database/prisma.service";
import { SOURCE } from "./us-importer";
import type { ImportPlan, PlannedVendor, Problem } from "./us-plan";

export interface Check {
  vendor: string;
  what: string;
  expected: number;
  found: number | null;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

async function checksFor(prisma: PrismaService, vendor: PlannedVendor, warehouseId: string): Promise<Check[]> {
  const expected: Array<[string, number]> = [
    ["Accounts", vendor.users.length],
    ["Products", vendor.products.length],
    ["Sellable units", sum(vendor.products.map((product) => product.sellable))],
    ["Damaged units", sum(vendor.products.map((product) => product.damaged))],
    ["Wallet (cents)", vendor.walletCents],
  ];
  const link = await prisma.migrationLink.findUnique({ where: { sourceTable_sourceId: { sourceTable: SOURCE.vendors, sourceId: vendor.sourceId } } });
  if (!link) {
    return expected.map(([what, value]) => ({ vendor: vendor.businessName, what, expected: value, found: null }));
  }
  const lots = await prisma.stockLot.groupBy({ by: ["condition"], where: { vendorId: link.targetId, warehouseId }, _sum: { quantityAvailable: true, quantityReserved: true } });
  const units = (condition: string) => {
    const group = lots.find((entry) => entry.condition === condition);
    return (group?._sum.quantityAvailable ?? 0) + (group?._sum.quantityReserved ?? 0);
  };
  const wallet = await prisma.wallet.findUnique({ where: { vendorId_currency: { vendorId: link.targetId, currency: "USD" } } });
  const found = [
    await prisma.user.count({ where: { vendorId: link.targetId } }),
    await prisma.product.count({ where: { vendorId: link.targetId } }),
    units("SELLABLE"),
    units("DAMAGED"),
    Number(wallet?.balanceMinor ?? 0),
  ];
  return expected.map(([what, value], index) => ({ vendor: vendor.businessName, what, expected: value, found: found[index]! }));
}

export async function reconcile(prisma: PrismaService, plan: ImportPlan, warehouseId: string): Promise<Check[]> {
  const checks: Check[] = [];
  for (const vendor of plan.vendors) {
    checks.push(...(await checksFor(prisma, vendor, warehouseId)));
  }
  return checks;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderReport(plan: ImportPlan, problems: Problem[], checks: Check[], mode: "DRY RUN" | "APPLIED"): string {
  const blockers = problems.filter((problem) => problem.severity === "BLOCKER");
  const moved = checks.filter((check) => check.found !== null);
  const mismatched = moved.filter((check) => check.found !== check.expected);
  const lines = [
    `# US data move — ${mode}`,
    "",
    `Source read at ${plan.takenAt.toISOString()}.`,
    "",
    `- Businesses: ${plan.vendors.length}`,
    `- Accounts: ${sum(plan.vendors.map((vendor) => vendor.users.length))}`,
    `- Products: ${sum(plan.vendors.map((vendor) => vendor.products.length))}`,
    `- Sellable units: ${sum(plan.vendors.flatMap((vendor) => vendor.products.map((product) => product.sellable)))}`,
    `- Wallet money: ${(sum(plan.vendors.map((vendor) => vendor.walletCents)) / 100).toFixed(2)} USD`,
    `- Must fix before moving: ${blockers.length}`,
    `- Checks that don't match after moving: ${mode === "APPLIED" ? mismatched.length : "not moved yet"}`,
    "",
  ];
  if (problems.length > 0) {
    lines.push("## Problems", "", "| Kind | About | Detail |", "| --- | --- | --- |", ...problems.map((problem) => `| ${problem.severity} | ${cell(problem.subject)} | ${cell(problem.detail)} |`), "");
  }
  lines.push(
    "## Per business",
    "",
    "| Business | Check | Old system | New system | |",
    "| --- | --- | --- | --- | --- |",
    ...checks.map(
      (check) => `| ${cell(check.vendor)} | ${check.what} | ${check.expected} | ${check.found ?? "—"} | ${check.found === null ? "" : check.found === check.expected ? "OK" : "MISMATCH"} |`,
    ),
    "",
  );
  return lines.join("\n");
}
