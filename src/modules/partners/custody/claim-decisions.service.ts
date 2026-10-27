import { Injectable } from "@nestjs/common";

import type { AuthPrincipal, RequestMeta } from "../../../common/auth/auth-principal";
import { Errors } from "../../../common/http/app-exception";
import { lockRow, PrismaService } from "../../../database/prisma.service";
import type { CustodyClaim, Prisma } from "../../../generated/prisma/client";
import { AuditService } from "../../../infrastructure/audit/audit.service";
import { type AssessClaimInput, type ClaimView, type DecideClaimInput, Money } from "../../../shared";
import { WalletAlertsService } from "../../finance/wallets/wallet-alerts.service";
import { actorOf } from "../admin/admin-partners.service";
import { PartnerNotifierService } from "../partner-notifier.service";
import { ClaimSettlementService } from "./claim-settlement.service";
import { ClaimsService } from "./claims.service";
import { CustodyEmails } from "./custody-emails";

const format = (amount: number, currency: string) => Money.of(amount, currency).format("en-GB");

@Injectable()
export class ClaimDecisionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claims: ClaimsService,
    private readonly settlement: ClaimSettlementService,
    private readonly notifier: PartnerNotifierService,
    private readonly vendorAlerts: WalletAlertsService,
    private readonly audit: AuditService,
  ) {}

  async assess(principal: AuthPrincipal, claimId: string, input: AssessClaimInput, meta: RequestMeta): Promise<ClaimView> {
    await this.claims.staffDetail(principal, claimId);
    const claim = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, claimId);
      if (current.status !== "OPEN") {
        throw Errors.invalidTransition("This claim has already been assessed.");
      }
      if (current.createdBy === principal.userId) {
        throw Errors.forbidden("Someone other than the person who opened the claim assesses it.");
      }
      if (input.liability === "PARTNER" && !current.partnerId) {
        throw Errors.validation({ liability: ["This stock wasn't at a partner hub"] });
      }
      if (input.writeOff && !current.lotId) {
        throw Errors.validation({ writeOff: ["Only stock still in a hub can be written off"] });
      }
      const compensation = input.liability === "VENDOR" ? 0 : input.amountMinor;
      if (compensation > Number(current.amountMinor)) {
        throw Errors.validation({ amountMinor: [`Compensation can't be more than the declared value of ${format(Number(current.amountMinor), current.currency)}`] });
      }
      await tx.custodyClaim.update({
        where: { id: claimId },
        data: {
          status: "ASSESSED",
          liability: input.liability,
          writeOff: input.writeOff,
          compensationMinor: BigInt(compensation),
          assessedBy: principal.userId,
          assessedAt: new Date(),
          assessmentNote: input.note,
        },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: "custody.claim_assessed",
          resourceType: "custody_claim",
          resourceId: claimId,
          countryCode: current.countryCode,
          after: { ...input, amountMinor: compensation },
          meta,
        },
        tx,
      );
      return current;
    });
    if (input.liability === "PARTNER" && claim.partnerId) {
      await this.notifier.notify(claim.partnerId, (to, webUrl) => CustodyEmails.partnerClaimAssessed(to, claim.reference, webUrl));
    }
    return this.claims.staffDetail(principal, claimId);
  }

  async decide(principal: AuthPrincipal, claimId: string, input: DecideClaimInput, meta: RequestMeta): Promise<ClaimView> {
    await this.claims.staffDetail(principal, claimId);
    const decided = await this.prisma.$transaction(async (tx) => {
      const current = await this.locked(tx, claimId);
      if (current.status !== "ASSESSED" && !(current.status === "OPEN" && !input.approve)) {
        throw Errors.invalidTransition(input.approve ? "Assess the claim before approving it." : "This claim has already been decided.");
      }
      if (current.assessedBy === principal.userId || current.createdBy === principal.userId) {
        throw Errors.forbidden("Someone who didn't open or assess the claim makes the decision.");
      }
      const split = input.approve ? await this.settlement.settle(tx, current, principal.userId) : null;
      await tx.custodyClaim.update({
        where: { id: claimId },
        data: {
          status: input.approve ? "SETTLED" : "REJECTED",
          decidedBy: principal.userId,
          decidedAt: new Date(),
          decisionNote: input.note,
          ...(split
            ? { recoveredLedgerMinor: BigInt(split.recoveredLedgerMinor), recoveredDepositMinor: BigInt(split.recoveredDepositMinor), platformCoverMinor: BigInt(split.platformCoverMinor) }
            : { compensationMinor: 0n }),
        },
      });
      await this.audit.record(
        {
          actor: actorOf(principal),
          action: input.approve ? "custody.claim_settled" : "custody.claim_rejected",
          resourceType: "custody_claim",
          resourceId: claimId,
          countryCode: current.countryCode,
          before: { status: current.status },
          after: { note: input.note, ...(split ?? {}) },
          meta,
        },
        tx,
      );
      return { claim: current, split };
    });
    await this.announce(decided.claim, decided.split);
    return this.claims.staffDetail(principal, claimId);
  }

  async respond(principal: AuthPrincipal, claimId: string, response: string, meta: RequestMeta): Promise<ClaimView> {
    const partnerId = this.claims.partnerIdOf(principal);
    const answered = await this.prisma.custodyClaim.updateMany({
      where: { id: claimId, partnerId, status: "ASSESSED", liability: "PARTNER", partnerResponse: null },
      data: { partnerResponse: response, partnerRespondedAt: new Date() },
    });
    if (answered.count === 0) {
      await this.claims.partnerDetail(principal, claimId);
      throw Errors.invalidTransition("You can respond once, while we're deciding a claim against your hub.");
    }
    await this.audit.record({ actor: actorOf(principal), action: "custody.claim_partner_responded", resourceType: "custody_claim", resourceId: claimId, meta });
    return this.claims.partnerDetail(principal, claimId);
  }

  private async locked(tx: Prisma.TransactionClient, claimId: string): Promise<CustodyClaim> {
    await lockRow(tx, "custodyClaims", claimId);
    return tx.custodyClaim.findUniqueOrThrow({ where: { id: claimId } });
  }

  private async announce(claim: CustodyClaim, split: Awaited<ReturnType<ClaimSettlementService["settle"]>> | null): Promise<void> {
    const compensation = Number(claim.compensationMinor);
    const partnerId = claim.status === "ASSESSED" && claim.liability === "PARTNER" ? claim.partnerId : null;
    if (!split) {
      await this.vendorAlerts.notifyOwner(claim.vendorId, (to, webUrl) => CustodyEmails.claimRejected(to, claim.reference, webUrl), "/claims");
      if (partnerId) {
        await this.notifier.notify(partnerId, (to, webUrl) => CustodyEmails.partnerClaimDecided(to, claim.reference, null, webUrl));
      }
      return;
    }
    const credit = claim.liability !== "VENDOR" && compensation > 0 ? format(compensation, claim.currency) : null;
    await this.vendorAlerts.notifyOwner(claim.vendorId, (to, webUrl) => CustodyEmails.claimSettled(to, claim.reference, credit, webUrl), "/claims");
    if (partnerId) {
      const recovered = split.recoveredLedgerMinor + split.recoveredDepositMinor;
      await this.notifier.notify(partnerId, (to, webUrl) => CustodyEmails.partnerClaimDecided(to, claim.reference, recovered > 0 ? format(recovered, claim.currency) : null, webUrl));
    }
  }
}
