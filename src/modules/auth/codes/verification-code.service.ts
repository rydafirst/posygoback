import { Injectable } from "@nestjs/common";

import { Errors } from "../../../common/http/app-exception";
import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import type { CodePurpose } from "../../../generated/prisma/client";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";
import { VERIFICATION_CODE_LENGTH } from "../../../shared";

const LIFETIMES_MINUTES: Record<CodePurpose, number> = { EMAIL_VERIFICATION: 15, PASSWORD_RESET: 30, MFA_ENROLMENT: 15 };
const MAX_ATTEMPTS = 5;

@Injectable()
export class VerificationCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasherService,
  ) {}

  async issueNumeric(userId: string, purpose: CodePurpose, client: DatabaseClient = this.prisma): Promise<string> {
    const code = this.hasher.numericCode(VERIFICATION_CODE_LENGTH);
    await this.store(userId, purpose, this.digest(userId, purpose, code), client);
    return code;
  }

  async issueToken(userId: string, purpose: CodePurpose): Promise<string> {
    const token = this.hasher.randomToken();
    await this.store(userId, purpose, this.tokenDigest(purpose, token), this.prisma);
    return token;
  }

  async consumeNumeric(userId: string, purpose: CodePurpose, code: string): Promise<void> {
    if ((await this.checkNumeric(userId, purpose, code, true)) === "INVALID") {
      throw Errors.invalidCode();
    }
  }

  async matchesNumeric(userId: string, purpose: CodePurpose, code: string): Promise<boolean> {
    return (await this.checkNumeric(userId, purpose, code, false)) === "MATCHED";
  }

  private async checkNumeric(userId: string, purpose: CodePurpose, code: string, consume: boolean): Promise<"INVALID" | "MATCHED"> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM verification_codes
        WHERE user_id = ${userId}::uuid AND purpose = ${purpose}::code_purpose AND consumed_at IS NULL
        LIMIT 1 FOR UPDATE`;
      const active = locked ? await tx.verificationCode.findUnique({ where: { id: locked.id } }) : null;
      if (!active || active.expiresAt <= new Date() || active.attempts >= MAX_ATTEMPTS) {
        return "INVALID";
      }
      if (!this.hasher.matches(active.codeHash, this.digest(userId, purpose, code))) {
        await tx.verificationCode.update({ where: { id: active.id }, data: { attempts: { increment: 1 } } });
        return "INVALID";
      }
      if (consume) {
        await tx.verificationCode.update({ where: { id: active.id }, data: { consumedAt: new Date() } });
      }
      return "MATCHED" as const;
    });
    return outcome;
  }

  async consumeToken(purpose: CodePurpose, token: string, client: DatabaseClient): Promise<string | null> {
    const [consumed] = await client.verificationCode.updateManyAndReturn({
      where: { codeHash: this.tokenDigest(purpose, token), purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
      select: { userId: true },
    });
    return consumed?.userId ?? null;
  }

  private async store(userId: string, purpose: CodePurpose, codeHash: string, client: DatabaseClient): Promise<void> {
    await client.verificationCode.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
    await client.verificationCode.create({ data: { userId, purpose, codeHash, expiresAt: new Date(Date.now() + LIFETIMES_MINUTES[purpose] * 60_000) } });
  }

  private tokenDigest(purpose: CodePurpose, token: string): string {
    return this.hasher.keyedHash(`${purpose}:token:${token}`);
  }

  private digest(userId: string, purpose: CodePurpose, secret: string): string {
    return this.hasher.keyedHash(`${purpose}:${userId}:${secret}`);
  }
}
