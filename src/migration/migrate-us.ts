import { writeFileSync } from "node:fs";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "../app.module";
import { loadEnvironmentFile } from "../config/load-env";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../infrastructure/audit/audit.service";
import { WalletLedgerService } from "../modules/finance/wallets/wallet-ledger.service";
import { InventoryLedgerService } from "../modules/stock/inventory/inventory-ledger.service";
import { UsImporter } from "./us-importer";
import { planUsImport } from "./us-plan";
import { reconcile, renderReport } from "./us-report";
import { readUsSnapshot } from "./us-source";

const USAGE = "Usage: npm run migrate:us -- --warehouse <code> --report <file.md> [--schema <name>] [--apply]\nSet SOURCE_DATABASE_URL to a read-only connection to the old database.";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<number> {
  loadEnvironmentFile();
  process.env.JOBS_ENABLED = "false";
  const source = process.env.SOURCE_DATABASE_URL;
  const warehouseCode = option("--warehouse");
  const reportPath = option("--report");
  if (!source || !warehouseCode || !reportPath) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const apply = process.argv.includes("--apply");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const importer = new UsImporter(prisma, app.get(WalletLedgerService), app.get(InventoryLedgerService), app.get(AuditService));
    const warehouse = await importer.warehouse(warehouseCode);
    const plan = planUsImport(await readUsSnapshot(source, option("--schema")));
    const problems = [...plan.problems, ...(await importer.targetProblems(plan))];
    const blocked = problems.some((problem) => problem.severity === "BLOCKER");
    if (apply && !blocked) {
      const result = await importer.importAll(plan, warehouse);
      process.stdout.write(`Moved ${result.imported} of ${result.imported + result.skipped} businesses; the rest had already been moved.\n`);
    }
    const checks = await reconcile(prisma, plan, warehouse.id);
    writeFileSync(reportPath, renderReport(plan, problems, checks, apply && !blocked ? "APPLIED" : "DRY RUN"));
    process.stdout.write(`Report written to ${reportPath}.\n`);
    if (apply && blocked) {
      process.stderr.write("Nothing was moved: fix the problems marked BLOCKER in the report first.\n");
      return 1;
    }
    return checks.some((check) => check.found !== null && check.found !== check.expected) ? 1 : 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
