import { Injectable } from "@nestjs/common";

import { type DatabaseClient, PrismaService } from "../../../database/prisma.service";
import { SecretHasherService } from "../../../infrastructure/crypto/secret-hasher.service";

const CODE_COUNT = 10;

@Injectable()
export class RecoveryCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: SecretHasherService,
  ) {}

  async regenerate(userId: string, client: DatabaseClient): Promise<string[]> {
    const codes = Array.from({ length: CODE_COUNT }, () => this.hasher.recoveryCode());
    await client.recoveryCode.deleteMany({ where: { userId } });
    await client.recoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: this.digest(userId, code) })) });
    return codes;
  }

  async consume(userId: string, code: string): Promise<boolean> {
    const used = await this.prisma.recoveryCode.updateMany({ where: { userId, codeHash: this.digest(userId, code), usedAt: null }, data: { usedAt: new Date() } });
    return used.count > 0;
  }

  private digest(userId: string, code: string): string {
    return this.hasher.keyedHash(`recovery:${userId}:${code.toUpperCase()}`);
  }
}
