import { argon2id, hash } from "argon2";

import { loadConfig } from "../config/config.schema";
import { loadEnvironmentFile } from "../config/load-env";
import { PrismaClient } from "../generated/prisma/client";
import { SEED_COUNTRIES, SEED_FEE_SCHEDULES } from "../shared";
import { createAdapter } from "./prisma.service";

const PLACEHOLDER_BODY =
  "DEVELOPMENT PLACEHOLDER. This text must be replaced with the version drafted by counsel for this market before any vendor signs it. " +
  "It exists only so the acceptance flow can be exercised locally.";

const LEGAL_KINDS = [
  ["VENDOR_AGREEMENT", "Vendor agreement"],
  ["TERMS", "Terms of service"],
  ["PRIVACY", "Privacy policy"],
] as const;

const DEV_WAREHOUSES = [
  { countryCode: "GB", code: "GB-DEV-1", name: "Manchester (development)", addressLines: ["Development warehouse"], city: "Manchester", postalCode: "M1 1AA" },
  { countryCode: "US", code: "US-DEV-1", name: "New Jersey (development)", addressLines: ["Development warehouse"], city: "Newark", postalCode: "07102" },
];

const DEV_PACKAGING = [
  { code: "MAILER-S", label: "Small mailer", kind: "MAILER" as const, lengthMm: 250, widthMm: 180, heightMm: 20 },
  { code: "MAILER-L", label: "Large mailer", kind: "MAILER" as const, lengthMm: 400, widthMm: 300, heightMm: 30 },
  { code: "BOX-S", label: "Small box", kind: "BOX" as const, lengthMm: 300, widthMm: 200, heightMm: 100 },
  { code: "BOX-M", label: "Medium box", kind: "BOX" as const, lengthMm: 400, widthMm: 300, heightMm: 200 },
  { code: "BOX-L", label: "Large box", kind: "BOX" as const, lengthMm: 500, widthMm: 400, heightMm: 300 },
];

async function seed(prisma: PrismaClient): Promise<void> {
  for (const country of SEED_COUNTRIES) {
    await prisma.country.upsert({ where: { code: country.code }, update: {}, create: { ...country, status: "LIVE", statusChangedAt: new Date(), statusReason: "Development seed" } });
  }
  await prisma.legalDocument.createMany({
    data: SEED_COUNTRIES.flatMap((country) => LEGAL_KINDS.map(([kind, title]) => ({ countryCode: country.code, kind, version: "dev-1", title: `${title} (${country.name})`, body: PLACEHOLDER_BODY }))),
    skipDuplicates: true,
  });
  for (const [countryCode, schedule] of Object.entries(SEED_FEE_SCHEDULES)) {
    if (!(await prisma.feeSchedule.findFirst({ where: { countryCode } }))) {
      await prisma.feeSchedule.create({ data: { countryCode, version: 1, status: "ACTIVE", schedule, note: "Development starting prices — replace before launch" } });
    }
  }
  for (const warehouse of DEV_WAREHOUSES) {
    if (!(await prisma.warehouse.findUnique({ where: { code: warehouse.code } }))) {
      await prisma.warehouse.create({ data: { ...warehouse, locations: { create: ["A-01", "A-02", "B-01"].map((code) => ({ code, label: `Shelf ${code}` })) } } });
    }
  }
  await prisma.packagingPreset.createMany({ data: SEED_COUNTRIES.flatMap((country) => DEV_PACKAGING.map((preset) => ({ countryCode: country.code, ...preset }))), skipDuplicates: true });
  const adminEmail = process.env.SEED_SUPER_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (adminEmail && adminPassword && adminPassword.length >= 12) {
    await prisma.user.upsert({
      where: { email: adminEmail.toLowerCase() },
      update: {},
      create: {
        email: adminEmail.toLowerCase(),
        passwordHash: await hash(adminPassword, { type: argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 }),
        role: "SUPER_ADMIN",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
  }
}

async function main(): Promise<void> {
  loadEnvironmentFile();
  const config = loadConfig();
  if (config.NODE_ENV === "production") {
    throw new Error("The development seed never runs in production");
  }
  const prisma = new PrismaClient({ adapter: createAdapter(config) });
  try {
    await seed(prisma);
    process.stdout.write("Seed complete\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${String(error)}\n`);
  process.exit(1);
});
