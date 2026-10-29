import { argon2id, hash } from "argon2";
import Redis from "ioredis";

import { type AppConfig, loadConfig } from "../config/config.schema";
import { loadEnvironmentFile } from "../config/load-env";
import { type Prisma, PrismaClient, type Role } from "../generated/prisma/client";
import { FieldEncryptionService } from "../infrastructure/crypto/field-encryption.service";
import { SecretHasherService } from "../infrastructure/crypto/secret-hasher.service";
import { mfaSecretContext } from "../modules/auth/flows/login.service";
import { WalletLedgerService } from "../modules/finance/wallets/wallet-ledger.service";
import { createAdapter } from "./prisma.service";
import { VENDOR_LEGAL_KINDS } from "../shared";

const DEFAULT_PASSWORD = "e2e local password 2026";
const DEFAULT_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "postgres"];
const COUNTRY = "GB";
const PARTNER_REFERENCE = "PT-E2E-0001";
const WALLET_FLOOR_MINOR = 50_000;

type Owner = "STAFF" | "VENDOR" | "PARTNER";

const CAST: ReadonlyArray<{ handle: string; role: Role; owner: Owner; countryCode?: string }> = [
  { handle: "super-admin", role: "SUPER_ADMIN", owner: "STAFF" },
  { handle: "admin", role: "ADMIN", owner: "STAFF" },
  { handle: "finance", role: "FINANCE_ADMIN", owner: "STAFF" },
  { handle: "compliance", role: "COMPLIANCE", owner: "STAFF" },
  { handle: "country-ops", role: "COUNTRY_OPS", owner: "STAFF", countryCode: COUNTRY },
  { handle: "operator", role: "WAREHOUSE_OPERATOR", owner: "STAFF", countryCode: COUNTRY },
  { handle: "vendor-owner", role: "VENDOR_OWNER", owner: "VENDOR" },
  { handle: "vendor-member", role: "VENDOR_MEMBER", owner: "VENDOR" },
  { handle: "partner-lead", role: "FULFILMENT_PARTNER", owner: "PARTNER", countryCode: COUNTRY },
  { handle: "partner-staff", role: "PARTNER_STAFF", owner: "PARTNER", countryCode: COUNTRY },
];

export const e2eEmail = (handle: string) => `${handle}@e2e.gfn.local`;

function assertLocal(config: AppConfig): void {
  if (config.NODE_ENV === "production") {
    throw new Error("The end-to-end cast never runs in production");
  }
  const host = new URL(config.DATABASE_URL).hostname;
  if (!LOCAL_HOSTS.includes(host) && process.env.E2E_SEED_ALLOW_HOST !== host) {
    throw new Error(`Refusing to seed ${host}. Set E2E_SEED_ALLOW_HOST=${host} if this really is a throwaway database.`);
  }
}

async function vendorId(prisma: PrismaClient): Promise<string> {
  const owner = await prisma.user.findUnique({ where: { email: e2eEmail("vendor-owner") }, select: { vendorId: true } });
  if (owner?.vendorId) {
    return owner.vendorId;
  }
  return (await prisma.vendor.create({ data: { businessName: "E2E Hair Co", countryCode: COUNTRY, status: "ACTIVE" } })).id;
}

async function platformHub(prisma: PrismaClient): Promise<void> {
  await prisma.warehouse.upsert({
    where: { code: "E2E-MAN-1" },
    update: { active: true },
    create: { countryCode: COUNTRY, code: "E2E-MAN-1", name: "Manchester test hub", addressLines: ["2 Test Street"], city: "Manchester", postalCode: "M1 1AA" },
  });
}

async function partner(prisma: PrismaClient): Promise<{ id: string; hubId: string }> {
  const profile = { fullName: "E2E Partner", phone: "+44 7700 900000", addressLines: ["1 Test Street"], city: "Leeds", postalCode: "LS1 1AA", spaceDescription: "A test room." };
  const row = await prisma.fulfilmentPartner.upsert({
    where: { reference: PARTNER_REFERENCE },
    update: { status: "ACTIVE", statusReason: "End-to-end cast" },
    create: {
      reference: PARTNER_REFERENCE,
      countryCode: COUNTRY,
      legalName: "E2E Partner",
      contactEmail: e2eEmail("partner-lead"),
      status: "ACTIVE",
      profile,
      requiredDepositMinor: 0n,
      requiredInsuranceMinor: 0n,
      activatedAt: new Date(),
    },
  });
  const hub =
    (await prisma.warehouse.findFirst({ where: { partnerId: row.id }, select: { id: true } })) ??
    (await prisma.warehouse.create({
      data: { countryCode: COUNTRY, code: "HUB-E2E001", name: "Leeds test hub", addressLines: profile.addressLines, city: profile.city, postalCode: profile.postalCode, partnerId: row.id },
      select: { id: true },
    }));
  return { id: row.id, hubId: hub.id };
}

async function user(
  prisma: PrismaClient,
  encryption: FieldEncryptionService,
  member: (typeof CAST)[number],
  links: { vendorId: string; partnerId: string },
  passwordHash: string,
  secret: string,
): Promise<void> {
  const email = e2eEmail(member.handle);
  const data: Prisma.UserUncheckedCreateInput = {
    email,
    passwordHash,
    role: member.role,
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    countryCode: member.countryCode ?? null,
    vendorId: member.owner === "VENDOR" ? links.vendorId : null,
    partnerId: member.owner === "PARTNER" ? links.partnerId : null,
    failedLoginCount: 0,
    lockedUntil: null,
  };
  const saved = await prisma.user.upsert({ where: { email }, update: data, create: data });
  const enrolled = member.owner !== "VENDOR";
  await prisma.user.update({
    where: { id: saved.id },
    data: { mfaSecretEncrypted: enrolled ? encryption.encrypt(secret, mfaSecretContext(saved.id)) : null, mfaPendingSecretEncrypted: null, mfaEnrolledAt: enrolled ? new Date() : null },
  });
}

async function vendorTrading(prisma: PrismaClient, vendor: string): Promise<void> {
  await prisma.vendor.update({ where: { id: vendor }, data: { status: "ACTIVE" } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: e2eEmail("vendor-owner") }, select: { id: true } });
  const documents = await prisma.legalDocument.findMany({ where: { countryCode: COUNTRY, kind: { in: [...VENDOR_LEGAL_KINDS] } }, distinct: ["kind"], orderBy: [{ kind: "asc" }, { publishedAt: "desc" }], select: { id: true } });
  await prisma.agreementAcceptance.createMany({ data: documents.map((document) => ({ vendorId: vendor, legalDocumentId: document.id, acceptedBy: owner.id })), skipDuplicates: true });
  const ledger = new WalletLedgerService();
  await prisma.$transaction(async (tx) => {
    const wallet = await ledger.walletFor(tx, vendor, "GBP");
    const top = WALLET_FLOOR_MINOR * 2 - Number(wallet.balanceMinor);
    if (Number(wallet.balanceMinor) < WALLET_FLOOR_MINOR) {
      await ledger.post(tx, wallet.id, { type: "DEPOSIT", amountMinor: top, description: "End-to-end test funds", idempotencyKey: `e2e-funds:${Date.now()}` });
    }
  });
}

async function stock(prisma: PrismaClient, vendor: string, hubId: string): Promise<void> {
  const product = await prisma.product.upsert({
    where: { vendorId_code: { vendorId: vendor, code: "E2E-WIG" } },
    update: {},
    create: { vendorId: vendor, code: "E2E-WIG", name: "Test lace wig", countryOfOrigin: "CN", declaredValueMinor: 2_500, currency: "GBP", weightGrams: 300, storageTier: "SMALL" },
  });
  const held = await prisma.stockLot.aggregate({ where: { productId: product.id, warehouseId: hubId }, _sum: { quantityAvailable: true } });
  if ((held._sum.quantityAvailable ?? 0) >= 5) {
    return;
  }
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: e2eEmail("vendor-owner") }, select: { id: true } });
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const inbound = await prisma.inboundShipment.create({
    data: {
      reference: `IN-GB-E${suffix}`,
      vendorId: vendor,
      warehouseId: hubId,
      countryCode: COUNTRY,
      status: "RECEIVED",
      shippingMode: "LOOSE",
      expectedArrivalDate: new Date(),
      declaredBoxCounts: { SMALL: 1 },
      createdBy: owner.id,
      receivedAt: new Date(),
    },
  });
  await prisma.stockLot.create({
    data: {
      code: `GB-E2E-${suffix}`,
      vendorId: vendor,
      productId: product.id,
      warehouseId: hubId,
      inboundId: inbound.id,
      condition: "SELLABLE",
      storageTier: "SMALL",
      quantityAvailable: 5,
      receivedAt: new Date(),
    },
  });
}

async function resetStore(prisma: PrismaClient, vendor: string): Promise<void> {
  await prisma.storefront.deleteMany({ where: { vendorId: vendor } });
  await prisma.vendorPayoutAccount.deleteMany({ where: { vendorId: vendor } });
  await prisma.product.updateMany({ where: { vendorId: vendor }, data: { listed: false } });
}

async function buyerLink(prisma: PrismaClient, config: AppConfig, email: string): Promise<string> {
  const buyer = await prisma.buyerAccount.findUniqueOrThrow({ where: { email } });
  const hasher = new SecretHasherService(config);
  const token = hasher.randomToken();
  await prisma.buyerLoginToken.create({ data: { buyerId: buyer.id, tokenHash: hasher.keyedHash(token), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

async function shoppingConfirmLink(prisma: PrismaClient, config: AppConfig, reference: string): Promise<string> {
  const hasher = new SecretHasherService(config);
  const token = hasher.randomToken();
  await prisma.shoppingRequest.update({ where: { reference, confirmedAt: null }, data: { confirmTokenHash: hasher.keyedHash(token), confirmExpiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  return token;
}

async function handOffOrder(prisma: PrismaClient, reference: string): Promise<void> {
  const steps = ["PENDING_PACKING", "PACKING_COMPLETED", "AWAITING_SHIPPING_SELECTION", "SHIPPING_PAID", "LABEL_PURCHASED", "HANDED_OFF"] as const;
  for (let step = 1; step < steps.length; step += 1) {
    await prisma.order.updateMany({ where: { reference, status: steps[step - 1] }, data: { status: steps[step], ...(steps[step] === "HANDED_OFF" ? { handedOffAt: new Date() } : {}) } });
  }
}

async function clearRateLimits(config: AppConfig): Promise<void> {
  const redis = new Redis(config.REDIS_URL);
  try {
    const keys = (await redis.keys("*")).filter((key) => !key.startsWith("session"));
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  loadEnvironmentFile();
  const config = loadConfig();
  assertLocal(config);
  if (process.argv.includes("--limits-only")) {
    await clearRateLimits(config);
    return;
  }
  const prisma = new PrismaClient({ adapter: createAdapter(config) });
  const option = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const linkFor = option("--buyer-link");
  const deliver = option("--deliver-store-order");
  const handOff = option("--hand-off-order");
  const confirmFor = option("--shopping-confirm");
  const awaitingActivation = process.argv.includes("--awaiting-activation");
  if (linkFor || deliver || handOff || confirmFor || awaitingActivation) {
    try {
      if (awaitingActivation) {
        const vendor = await vendorId(prisma);
        await prisma.vendorActivationPayment.deleteMany({ where: { vendorId: vendor } });
        await prisma.vendor.update({ where: { id: vendor }, data: { status: "PENDING_VERIFICATION", activationDueAt: new Date() } });
      }
      if (linkFor) {
        process.stdout.write(`${await buyerLink(prisma, config, linkFor.toLowerCase())}\n`);
      }
      if (confirmFor) {
        process.stdout.write(`${await shoppingConfirmLink(prisma, config, confirmFor)}\n`);
      }
      if (handOff) {
        await handOffOrder(prisma, handOff);
      }
      if (deliver) {
        const shippedAt = new Date();
        const window = new Date(shippedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        await prisma.storefrontOrder.update({ where: { reference: deliver }, data: { status: "DELIVERED", shippedAt, returnsUntil: window, payoutReleaseAt: window } });
      }
    } finally {
      await prisma.$disconnect();
    }
    return;
  }
  try {
    const encryption = new FieldEncryptionService(config);
    const passwordHash = await hash(process.env.E2E_PASSWORD ?? DEFAULT_PASSWORD, { type: argon2id });
    const secret = process.env.E2E_TOTP_SECRET ?? DEFAULT_TOTP_SECRET;
    const vendor = await vendorId(prisma);
    const { id: partnerId, hubId } = await partner(prisma);
    await platformHub(prisma);
    await prisma.stockTransfer.updateMany({ where: { fromWarehouseId: hubId, status: "REQUESTED" }, data: { status: "CANCELLED" } });
    for (const member of CAST) {
      await user(prisma, encryption, member, { vendorId: vendor, partnerId }, passwordHash, secret);
    }
    await vendorTrading(prisma, vendor);
    await stock(prisma, vendor, hubId);
    await resetStore(prisma, vendor);
    await clearRateLimits(config);
    process.stdout.write(`${JSON.stringify({ vendorId: vendor, partnerId, hubId, accounts: CAST.map((member) => ({ role: member.role, email: e2eEmail(member.handle) })) })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`End-to-end seed failed: ${String(error)}\n`);
  process.exit(1);
});
