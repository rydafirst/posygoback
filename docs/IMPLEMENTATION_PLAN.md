# Global Fulfilment Network — Implementation Plan

**Status:** v1.0 · 25 Oct 2026
**Inputs:** `GLOBAL_FULFILLMENT_NETWORK_PRD.md`, `UK_REPLICATION_PRD.md`, `UK_EXPANSION_PLAN.md`, the USA Errands API + web repositories (read-only reference), `SECURITY_AUDIT_2026-05-14.md`, `SECURITY_REVIEW_FULFILLMENT_V2_2026-07-14.md`, and the Posy design system (every component, on a white page background).

---

## 0. Decisions this plan is built on

| #   | Decision                                                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **New codebase.** The USA Errands repos are reference only and are never modified. Every capability is rebuilt here, country-agnostic from the first line.                                                                                                                                                                   | Retrofitting `region` onto 74 migrations was attempted and reverted (commit `a7d9473`). Starting clean removes US hard-coding, oversized files and known security debt in one move. |
| D2  | **Two separate projects**, deployed independently: `global-fulfilment-api` (NestJS) and `global-fulfilment-web` (Next.js), each installed with npm. Both keep an identical copy of the shared contracts in `src/shared` (types, money, country rules, Zod schemas), and `npm run shared:check` fails when the copies differ. | Matches how the business deploys (backend and frontend separately) while keeping one set of rules. The old system mirrored files by hand with no check.                             |
| D3  | **Country is data.** `Country` rows carry currency, tax model, address rules, KYC ruleset, carriers and fee schedule keys. No `US`/`UK` literals in services.                                                                                                                                                                | PRD §2.1, §6.                                                                                                                                                                       |
| D4  | **Money is a value object** (`amountMinor` + `currency`). Mixing currencies throws. Integer minor units only.                                                                                                                                                                                                                | `UK_EXPANSION_PLAN §1.3`.                                                                                                                                                           |
| D5  | **Warehouses have operators from day one.** Every warehouse belongs to a country and an operator (the platform, or a Fulfilment Partner). The US warehouse is operated by a "platform operator" record.                                                                                                                      | Makes the partner programme an extension, not a rewrite (PRD §11 backfill).                                                                                                         |
| D6  | **Custody events are written from the first inventory feature**, not added later.                                                                                                                                                                                                                                            | Retro-fitting chain of custody onto live stock is far harder than recording it from the start.                                                                                      |
| D7  | **Pinned, proven majors:** Node 22, NestJS 11, Prisma 7, PostgreSQL 16, Redis 7, Next.js 15, React 19, Tailwind 3.4, Zod 4, TypeScript 5.9. Newer majors (Nest 12, Next 16) are an upgrade task once the platform is live.                                                                                                   | Exact versions are pinned in `package.json`; no ranges.                                                                                                                             |
| D10 | **Prisma, as in USA Errands.** Prisma 7 with the PostgreSQL driver adapter (no query-engine binary at runtime). Triggers, check constraints and partial unique indexes that Prisma's schema can't express live in hand-written SQL inside the Prisma migrations, the same approach USA Errands used.                         | Same tool the team already knows; the custody chain and audit log keep their database-level guarantees.                                                                             |
| D8  | **Same-site deployment** — `app.<domain>` (web) and `api.<domain>` (API).                                                                                                                                                                                                                                                    | Refresh cookies stay first-party with `SameSite=Strict`. The old setup (Vercel ↔ Railway on different sites) relies on third-party cookies, which Safari blocks.                    |
| D9  | **Data migration, not dual running.** USA Errands data moves into this platform at cutover (Phase 9) as the US country, operated by the platform.                                                                                                                                                                            | One system of record.                                                                                                                                                               |

---

## 1. Architecture

### 1.1 Backend layering (every module follows it)

```
controller   → HTTP only: parse with Zod, call one service method, map result
service      → one business capability; depends on interfaces, never on concrete providers
repository   → Prisma access for one aggregate; always takes a scope (vendor / country)
policy       → pure functions: state machines, fee maths, permission checks
adapter      → third parties behind an interface (KYC, payments, carriers, storage, email)
```

Rules: a service file stays under ~300 lines, a controller under ~150. A capability that grows past that is split (the old `order-pack.service.ts` at 2,234 lines is the failure mode we avoid).

### 1.2 SOLID, concretely

- **S** — `OrderPackService` becomes `PackingService`, `RateQuoteService`, `LabelPurchaseService`, each one reason to change.
- **O** — adding a country is a `Country` row + config; adding a carrier/KYC/payment provider is a new adapter registered in a registry. No edits to callers.
- **L** — any `PaymentProcessor`, `CarrierAdapter`, `KycProvider`, `ObjectStorage`, `TaxEngine`, `AddressValidator` is substitutable; contract tests run against every implementation.
- **I** — small interfaces (`RateProvider` is separate from `LabelProvider`; a partner's console depends on `WarehouseTaskQueries`, not the whole order service).
- **D** — services receive interfaces through Nest DI tokens; concrete adapters are chosen per country by registries.

### 1.3 Country scoping

- Request context resolves `countryCode` from: the vendor's market, the partner's assigned warehouse, the storefront host, or an admin's explicit filter.
- Repositories require a scope argument; there is no unscoped query method for tenant data.
- Partner users are scoped to their own partner's warehouses by `warehouseScope`, applied wherever warehouse data is read or changed. Row-level security as a second wall is deferred (see SECURITY.md).

### 1.4 Frontend layering

```
app/(route)/page.tsx     → composes feature components; no business logic, < 150 lines
features/<area>/*        → feature components + hooks (React Query) for one area
components/ui/*          → design-system primitives (Button, DataTable, StatTile…)
components/layout/*      → AppShell, Sidebar, Topbar, MarketingHeader/Footer
lib/*                    → api client, auth context, formatters (money/date/address by country)
```

Navigation for vendor, partner and admin consoles is **configuration** (`nav.ts` arrays filtered by role/permission), rendered by one `Sidebar`.

---

## 2. Security baseline (applies to every phase)

Target: **OWASP ASVS 4.0.3 Level 2**, plus an external penetration test before each country goes live. No one can promise zero vulnerabilities; these controls plus testing and review are how we get as close as practical.

| Area          | Control                                                                                                                                                                                                        | Closes old finding     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Passwords     | Argon2id (64 MB, t=3, p=1); breached-password check (k-anonymity) at signup/reset; min 12 chars                                                                                                                | —                      |
| Codes         | 8-digit email/verification codes, hashed, max 5 attempts per code then invalidated                                                                                                                             | M-4                    |
| MFA           | TOTP mandatory for every non-vendor role (admin, finance, partner, partner staff, super admin); optional for vendors, required to approve payouts                                                              | Admin MFA was optional |
| Sessions      | Access JWT 10 min carries `sid`; every request checks the session is live (Redis cache, DB fallback). Refresh token rotates; reuse revokes the whole family                                                    | H-1                    |
| Cookies       | Refresh cookie `HttpOnly; Secure; SameSite=Strict; Path=/v1/auth`; Origin header checked on cookie endpoints                                                                                                   | —                      |
| Rate limiting | Redis-backed, shared by all API instances. Keys: per IP (trusted proxy header only), per account, per target (e.g. login email, verification code). Tighter tiers on auth, uploads, webhooks, public endpoints | In-memory limiter      |
| Authorisation | Deny by default: global auth guard, explicit `@Public()`; role + page-permission guard; tenant scoping returns 404 not 403                                                                                     | —                      |
| Privilege     | `admin.config.*`, KYC/partner decisions, finance approvals are SUPER_ADMIN / named-role only and never grantable via config                                                                                    | —                      |
| Money         | Integer minor units; `Money` type; DB CHECK constraints; idempotency keys on every money-moving request; append-only ledger (DB trigger)                                                                       | —                      |
| Insider risk  | Finance credits above a threshold need a **second approver** (maker-checker); daily cap per actor; alerts                                                                                                      | H-2                    |
| Webhooks      | Signature required in **every** environment; event row + handling in one transaction so failures are retried                                                                                                   | M-1, M-2               |
| Payment links | Superseded checkout sessions are expired with the provider before a new one is issued                                                                                                                          | M-3                    |
| Files         | Private bucket only; uploads via short-lived presigned PUT with size/type limits; server re-checks magic bytes after upload; reads via 5-minute signed GET; EXIF stripped on images                            | L-2, public KYC URLs   |
| PII           | ID numbers, recipient phone/email, bank details encrypted (AES-256-GCM, versioned keys) with blind-index HMAC for lookups                                                                                      | Plain-text `id_number` |
| Tokens        | Magic-link / access tokens revoked automatically on terminal states                                                                                                                                            | L-1                    |
| Audit         | Append-only audit log with hash chaining (`prevHash`) so tampering is detectable; custody events chained the same way                                                                                          | —                      |
| Headers       | Helmet on API; CSP with per-request nonce on web; HSTS preload; `frame-ancestors 'none'`                                                                                                                       | CSP-1                  |
| Supply chain  | Exact version pins, lockfile, `npm audit` gate, CodeQL, Dependabot, secret scanning                                                                                                                            | —                      |
| Logging       | Pino with redaction list; no PII in logs; Sentry with breadcrumb scrubbing                                                                                                                                     | OBS-1                  |
| DB            | Query timeouts; least-privilege DB role for the app; migrations run by a separate role                                                                                                                         | Q-1                    |

---

## 3. Design system implementation (Posy)

- Source: `posy-design-system/tokens.css` (`[data-theme="white"]`), `components/bundle.css`, `LandingPageWhite`, `VendorDashboardWhite`.
- Tokens become CSS variables in `global-fulfilment-web/src/styles/tokens.css` and Tailwind theme keys (`bg-ground`, `bg-paper`, `text-ink`, `bg-sky`…). Posy's light palette is used for every card, note, tile and band; only the page background is white. No ad-hoc hex values in components.
- Type: Instrument Sans (self-hosted via `@fontsource-variable/instrument-sans`, so no third-party font request and a tighter CSP).
- Signatures used: confetti dots on stat tiles and hero, notebook cards for announcements/help, stickers on card corners, cocoa table headers, round arrow "open" buttons, 4px yellow focus halo. Data panels stay straight; at most one tilted element per group.

### Component inventory

| Primitive                                                                                    | Notes                                                                                               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Button`                                                                                     | `primary` (cocoa), `yellow`, `lime`, `ghost`; sizes `md`/`lg`; loading state                        |
| `ArrowButton` / `OpenLink`                                                                   | Round cocoa arrow, "Open →" row action                                                              |
| `Chip`, `StatusPill`                                                                         | Status → tone mapping is data (`statusTones.ts`), shared by every table                             |
| `StatTile`                                                                                   | Tone + label + value + note + confetti dots                                                         |
| `Paper`, `Card`                                                                              | Warm paper card with line border                                                                    |
| `NotebookNote`, `Sticker`, `Stamp`                                                           | Brand signatures                                                                                    |
| `PageHeader`                                                                                 | Stamp + H1 + lead + primary action                                                                  |
| `Field`, `Input`, `Select`, `Textarea`, `PasswordInput`, `OtpInput`, `Checkbox`              | Label/hint/error wiring, `aria-*` built in                                                          |
| `DataTable<T>`                                                                               | Typed columns, cocoa header, empty state, row action                                                |
| `FilterTabs`                                                                                 | Counts per tab                                                                                      |
| `Pagination`, `RowsSelect`                                                                   |                                                                                                     |
| `EmptyState`, `Dialog`, `Toast`, `Stepper`, `FileDrop` (Phase 1), `EvidenceUpload` (Phase 2) |                                                                                                     |
| Layout                                                                                       | `AppShell`, `Sidebar` (config-driven), `Topbar`, `MarketingHeader`, `MarketingFooter`, `AuthLayout` |

---

## 4. Phases

Each phase ends with: all tests green (unit, integration against real Postgres/Redis, e2e), typecheck + lint clean, security checklist for the phase signed off, and the acceptance criteria demonstrated.

### Phase 0 — Foundations ✅ (delivered 25 Oct 2026)

**Backend**

- Separate API and web projects, CI for each, Docker Compose (Postgres 16 + Redis 7), env validation that refuses to boot on missing secrets.
- `Country` registry with typed config (currency, tax model, address rules, KYC ruleset, carriers, fee schedule key, locale), status lifecycle `PROSPECTIVE → ONBOARDING → LIVE ⇄ SUSPENDED → CLOSED`.
- `ShippingLane` (origin country → destination country, customs required) — the basis for "ship to".
- Auth: signup (with operating country), 8-digit email verification, login with lockout, TOTP enrolment + recovery codes, **mandatory MFA for privileged roles**, refresh rotation with reuse detection, per-request session check, logout, password reset.
- Redis rate limiting with per-IP, per-account and per-target buckets.
- Crypto service (AES-256-GCM field encryption, key versions, HMAC blind index).
- Private object storage abstraction (S3/R2 driver) with presigned upload, magic-byte verification and signed reads.
- Append-only, hash-chained audit log.
- Health/readiness endpoints, structured logging with redaction, correlation ids.

**Shared package** — `Money`, currency table, country/KYC rule types, role and permission registry, auth Zod contracts.

**Frontend**

- Posy White tokens, component library above, AppShell, marketing landing page, sign up / log in / verify / MFA challenge / MFA enrolment, vendor overview, country-aware money formatting, CSP + security headers.

**Acceptance**

- A vendor signs up choosing a live country, verifies email, logs in, lands on the overview showing their market and currency.
- An admin account cannot reach any admin endpoint until MFA is enrolled.
- A revoked session's access token stops working on the next request.
- Rate limits hold across two API instances.
- Adding a new country is a single API call by a super admin; no code change.

### Phase 1 — Vendor onboarding, KYC & team ✅ (delivered 25 Oct 2026)

Delivered: country-driven verification wizard (6 steps), answers and ID numbers encrypted at rest, private document uploads, `IdentityVerificationProvider` port with the manual-review adapter, compliance review queue scoped by country, audited document views and ID reveal, approve / request changes / reject with vendor emails, versioned immutable legal documents with re-acceptance on new versions, vendor activation (approved + current agreement), team invitations and removal, preferred ship-to destinations limited to open lanes. Phase 2 must gate every trading action (inbound shipments, products, orders) on an active vendor that has accepted the current vendor agreement. Still to add in this area: third-party KYC adapters (Sumsub/Veriff/Onfido) once chosen, account unlock by email link.

- Multi-step verification wizard driven by the **country's KYC ruleset** (business types, ID types, company number label/format, e.g. Companies House for GB, EIN for US).
- `KycProvider` interface with a manual-review adapter first, then Sumsub/Veriff/Onfido adapters per country; provider results stored, raw documents only in the private bucket.
- Encrypted ID numbers; documents viewable by reviewers via 5-minute signed links; every view audit-logged.
- Versioned agreements per country (`LegalDocument`, `AgreementAcceptance`) gating portal access.
- Team: invitations, sub-users, roles; admin vendor review queue; social verification.
- Vendor "markets": the vendor's primary operating country plus **preferred ship-to countries** (see §5).

### Phase 2 — Catalogue, warehouses, inbound & inventory ✅ (delivered 25 Oct 2026)

Delivered: staff invitations (super admin invites operators and other staff, who must set up two-factor before anything else), warehouses and shelf locations per country, products with checked barcodes and an image, stored in metric and shown in the market's own units; inbound shipments (draft → submitted → arrived → received, with hold, refuse and return), receiving with box counts, mandatory shipment photos and damage photos, discrepancies recorded line by line, stock lots for sellable and damaged units, storage boxes for later billing, put-away and moves with an append-only movement log and a hash-chained custody record, printable product and lot labels, and a message thread per shipment. Only active vendors with the current agreement can add products or send stock. Holds that need extra payment, and storage billing, arrive with the wallet in Phase 3.

Original scope:

- `Warehouse` (country, address, operator), `InventoryLocation` per warehouse.
- Products, variants, barcodes, HS code, country of origin, dimensions (metric stored, imperial displayed where the country uses it).
- PSNs with shipping modes, holds, messaging; receiving with **mandatory photo evidence and counts**, discrepancies → exceptions.
- SKUs, storage boxes, inventory movements, and `CustodyEvent` (RECEIVED, PUT_AWAY, MOVED) from day one, hash-chained.
- Label printing (SKU/barcode).
- Warehouse operator console (platform operator for now; becomes the partner console in Phase 5).

### Phase 3 — Money ✅ (delivered 25 Oct 2026)

Delivered: a prepaid wallet per vendor per currency with an append-only ledger, where the database itself applies each entry to the balance and refuses direct balance changes; card top-ups through a payment account per country (Stripe, or a test-mode sandbox for development) with card fees added on top, so the vendor's wallet gets exactly what they asked for; signed Stripe webhooks with replay protection, amount, currency, account and checkout checks before crediting, and refunds and disputes taken back in proportion (pausing the wallet when the balance can't cover it). Price lists per country (onboarding per box size, monthly storage, fulfilment, returns, shipping markup, a free first-shipment stocking fee) are versioned and need a second person to approve any change. The onboarding fee is taken when an inbound shipment is submitted and returned if it's cancelled; warehouse holds can carry a charge the vendor pays to release them. Storage is billed per box every 30 days from the date it was received (daily run at 02:00 UTC); a wallet that can't pay is marked overdue and the vendor emailed. The finance console has wallets, a ledger per wallet, manual credits and charges with a second approver above each market's limit and a daily cap per person, pausing and resuming wallets, price lists, and a nightly reconciliation (03:00 UTC) that checks every balance against its ledger. Vendors get a wallet page with activity, card payments, a low-balance email alert and their prices, a charge estimate on draft shipments and a pay-hold button. Paystack and Flutterwave plug into the same `PaymentProcessor` port when those markets open.

Original scope:

- Wallet per vendor per currency, append-only ledger, `Money` everywhere.
- Fee schedules per country (onboarding by tier, monthly storage, fulfilment base/per-unit/cap, returns handling, shipping markup) editable by super admin with audit + maker-checker for changes.
- `PaymentProcessor` registry: Stripe account per country (Model B), Paystack/Flutterwave where relevant; webhook per account, currency match asserted before crediting.
- Storage billing job per country; overdue handling.
- Finance console: credits/debits with dual approval above threshold, daily caps, reconciliation per currency, alerts.

### Phase 4 — Orders, shipping & integrations ✅ (delivered 25 Oct 2026)

Delivered: orders from the portal, a CSV spreadsheet (rows grouped by order reference, 300 orders a file, 2,000 a day, one import at a time per vendor) or the integration API (`gfn_live_…` keys, hashed, shown once, revocable, limited per key, idempotent on the shop's reference). Every order has a destination country chosen from the origin warehouse's enabled lanes, checked against that country's address rules; cross-border orders need HS codes and a phone number, carry a customs declaration and ship DAP. A request with several deliveries becomes one order per delivery. Stock is reserved from the oldest lots at creation and the fulfilment fee taken from the wallet in the same transaction. Warehouse operators scan every unit (the server refuses a pack until all are scanned), record the parcel from a packaging preset or custom size, fetch carrier rates (cost plus the market's markup), and buying the label charges the wallet: if the wallet is short the order waits and the vendor can pay from the order page. A definite carrier refusal refunds the charge; an unconfirmed result keeps the payment and the retry picks up an existing label instead of buying twice. Hand-off ships the stock; carrier tracking webhooks (re-fetched from the carrier, never trusted from the payload) move orders to in transit, delivered or exception. Vendors cancel instantly before packing and ask afterwards; country operations decide, and cancelling releases stock, returns every charge and voids a bought label. Recipient details are encrypted at rest and hidden from staff who don't handle orders. Public tracking shows only the city, country and carrier events. Custody records PICKED, PACKED, HANDED_OFF and RELEASED. The database enforces the status moves and keeps the order timeline append-only. Shippo is the first carrier adapter; a practice carrier is used in development.

Not in this phase: carrier address validation before rating (the carrier rejects bad addresses at rating time), insurance, signature and dangerous-goods add-ons, reassessment from carrier-billed weight, outbound webhooks to vendors, and the USA Errands multi-vendor cart consolidation.

Original scope:

- Fulfilment v2 state machine (`PENDING_PACKING → PACKING_COMPLETED → AWAITING_SHIPPING_SELECTION → (AWAITING_WALLET_FUNDING) → SHIPPING_PAID → LABEL_PURCHASED → SHIPPED/HANDED_OFF → DELIVERED`, plus `ON_HOLD/EXCEPTION/CANCELLED/RETURNED`), enforced in code and by DB trigger.
- **Destination country on every order** chosen from the origin warehouse's enabled lanes; per-destination address rules; customs declaration lines (HS code, origin, value) when the lane requires customs.
- Multi-destination requests split into one order per destination country.
- `CarrierAdapter` registry (Shippo per country account first), rate quoting, label purchase, tracking webhooks, packaging presets per carrier set, pack flow with barcode scan.
- Cancellation and cancellation requests, CSV import (with per-vendor daily cap), integration API keys (`gfn_live_…`, hashed), public tracking.
- Custody events PICKED, PACKED, HANDED_OFF.

### Phase 5 — Fulfilment Partner programme ✅ (delivered 25 Oct 2026)

Delivered: a partner manager invites a business by country with the deposit and insurance cover it must hold; the partner lead accepts the invitation (two-factor required), fills in the business profile and sends six checks (principal identity, business registration, facility, security, financial standing, references) with evidence files only they uploaded. Sending the application moves it to review; compliance accepts each check or returns it with notes (the partner can resubmit), records an on-site dry run that a second reviewer must accept, and approves once every check is accepted. Going live needs the five partner agreements in their current version, deposits and bonds held at least to the required amount and confirmed by a second person in finance, a verified insurance policy in date with enough cover, a payout account verified by someone other than the person who entered it, and a warehouse — only a partner manager can activate. Partner users work through the normal warehouse console, scoped to their own warehouse, and only while the partnership is active; suspension pauses that instantly. Partners earn per box received, per order handed off (plus each extra unit) and a share of vendors' storage charges, from rates in each market's price list; part of every earning is held back and released by a daily job unless the partner is suspended or offboarding. Partners can't record more boxes than a vendor declared, and don't see vendors' prices. Finance records and releases deposits (release only once the partner isn't operating, by someone other than who recorded it), reveals and verifies bank details (every view audited), and requests payouts that a second person approves; approval refuses an amount above what's available or bank details changed since the request. Insurance reminders go out 30 and 7 days before expiry; an expired policy with no replacement suspends the partner. Offboarding stops new work; terminating needs empty warehouses with no open orders, then closes every partner account. The partner ledger is append-only and can't go negative; the database enforces the lifecycle, same-country warehouses and users, and maker-checker on reviews, deposits, bank details and payouts.

Not in this phase: PostgreSQL row-level security (see SECURITY.md — isolation is enforced in the services and proven by the isolation suite), payouts through a payment provider (approval records the payout; finance pays by bank transfer), partner-initiated payout requests, trust scores and custody audits (Phase 6), and moving stock between warehouses during offboarding (done by operations for now).

Original scope:

- `FulfilmentPartner` lifecycle `APPLIED → UNDER_REVIEW → APPROVED → ACTIVE ⇄ SUSPENDED → OFFBOARDING → TERMINATED`; partner staff sub-accounts.
- Application funnel, KYC/KYB of principals, facility due diligence (evidence uploads), references, sandbox dry-run task set.
- Versioned legal acceptances (partner agreement, bailment/custody terms, non-diversion, DPA, insurance obligation).
- Deposit/bond and insurance policy records with expiry alerts; rolling holdback; partner settlement ledger and statements (separate from vendor wallets).
- Roles `FULFILMENT_PARTNER`, `PARTNER_STAFF`; partner console = warehouse operator console scoped to their warehouse; PostgreSQL RLS on partner-visible tables; isolation test suite.

### Homepage and partner verification brief ✅ (delivered 25 Oct 2026)

- Vendor-first homepage built from live hubs, with a trust strip, four-step how it works, FAQ and a separate partner page with per-country earnings, founding offer and public application.
- Partner verification: referee, Stripe Identity, proof of address with retention, storage photos and optional video call, Stripe Connect payouts, tax self-declaration, typed e-signature, approval that opens a starter-tier hub.
- Trust controls: tiered stock limits, revenue share with holdback, dispatch-photo-gated pay, blind video stock counts, test orders, scorecard and automatic tier raises. Deposit and partner insurance kept as optional per partner.

### Phase 6 — Custody & trust ✅ (delivered 26 Oct 2026)

Delivered: claims (vendor reports, short counts, short transfers, staff) with assess → decide by different people and a wallet credit for the vendor (never a payout), recovered from the partner's balance then deposit; hub-to-hub transfers with seal, photos and blind receiving; custody alerts (no carrier scan, short count, losses, low trust); trust score with automatic pause and full count, and a promotion gate; routine and suspension counts; seal numbers on high-value parcels; vendor "who holds your stock" signals; daily audit-chain anchoring. Not done: a second person to approve high-value hand-offs (seal and photo are required instead).

Original scope:

- Cycle counts (scheduled + surprise), audit tasks with evidence, reconciliation (system vs physical) per warehouse.
- `DiscrepancyClaim` workflow: shortage/damage → liability → deposit draw → vendor compensation.
- Shrinkage thresholds, movement alerts (goods leaving without instruction), dual control for high-value SKUs, seal numbers.
- Trust score from SLA + audit history; suspension (freeze inbound, freeze goods, trigger audit) and supervised offboarding/handover.
- Vendor-facing custody trail and "verified partner / insured" signals.

### Phase 7 — Commerce ✅ (delivered 26 Oct 2026)

Delivered: each vendor can open a store at `/store/<address>` once they have a name and address, at least one product listed with a price, and a connected bank account; opening takes a one-time set-up fee from the wallet. Buyers browse the store or the marketplace, keep a basket, and check out with an address on any enabled lane; the server prices goods, discount, delivery (standard or express from carrier rates with markup) and tax (VAT shown inside UK prices; regional sales tax added for the US). Payment goes through the market's card processor (Stripe or the practice processor). A paid order becomes a normal warehouse order straight away; the vendor's wallet pays the usual fulfilment fee but not the label, because the buyer paid for delivery. If the wallet is short the order waits and the vendor is emailed; if stock has gone the buyer is refunded automatically. The buyer's payment is held, and the vendor's share minus refunds goes to their bank after the return window (or the market's minimum hold). Buyers sign in with an emailed link to see orders and ask for returns; the vendor (or finance) accepts with a refund or turns it down with a message, and the payout waits while a return is open. Vendors create percentage or amount-off codes with a minimum spend, use limit and end date. Finance can refund any order and retry failed payouts.

Not done: custom domains; marketplace-wide codes run by us; sending returned items back to a warehouse and restocking them (Phase 8, returns v2: for now the store's message tells the buyer what to do with the item); buyer sign-in to more than one device at once is allowed but there is no "sign out everywhere" yet.

Original scope:

- Storefronts, custom domains, marketplace, buyer accounts (passwordless), cart and checkout per country currency, discounts, payout accounts and holds, storefront returns.
- `TaxEngine` per country (US sales tax, UK VAT inclusive display, etc.).

### Phase 8 — Personal shopping, returns, growth (done, 27 Oct 2026)

Delivered:

- **Customer returns.** A vendor opens a return on an order that has left the warehouse, up to 90 days after hand-off, for no more than was sent across all its returns. The handling fee from the price list is taken from the wallet at once and given back if the vendor cancels or nothing arrives within 45 days. The vendor gets the warehouse's address and a reference for the parcel. The hub that shipped it counts what arrives without seeing what was expected, photographs it and adds notes. The vendor then chooses, per item, to put it back on sale, dispose of it or donate it; if they say nothing within 14 days it goes back on sale. Restocked items become a new sellable lot with a movement and a custody event, and the order is marked returned once everything sent has come back.
- **Notifications.** Every message we email a vendor also lands in their in-app feed (the bell), with a link to the right page; read messages are deleted after 90 days.
- **Exports.** Vendors download orders and their wallet statement for up to a year at a time, and their current stock, as CSV files that are safe to open in a spreadsheet.

- **Referrals and campaigns.** Every vendor gets a code and an invite link. A business that signs up with it (same market only, never itself) is recorded, and once it is trading and its first stock has been received both get a wallet credit from the market's price list, which also caps how many referrer credits one vendor can earn a month. Finance can run campaign codes for events with their own welcome credit, dates and sign-up limit; vendor and campaign codes share one namespace so they can't clash. Finance can cancel a referral before it pays out.
- **Price list editing** now covers store set-up fee, commission and payout hold, and the referral credits, so proposing a new price list no longer resets them.

- **Console dashboard.** Staff open the console to a list of what's waiting on them, built from their own permissions (vendor checks, partner applications, price lists, adjustments, partner payouts, claims, custody alerts, stock at the door, stuck orders, returns, store returns and failed store payouts), and, for finance and country leads, the last 30 days: new vendors, orders, parcels sent, stock received, fees charged, store sales and money held in wallets. Country-based staff only ever see their own market; others can pick one or see them all.

- **Personal shopping (quote-first).** Anyone can send links to items from shops in a live market, with a delivery address we can reach, and confirm it from the email we send them. Country staff check each link, mark what we can't get, give a price and weight per item, and pick the warehouse and box; the buyer gets one price covering the items, our fee (a percentage with a minimum, set in the price list) and delivery, held for 7 days. The buyer signs in with an emailed link, picks standard or express delivery and pays by card. Staff then buy each item and record the shop's order number; anything sold out is refunded at once, with its share of our fee, and if nothing could be bought the whole payment goes back. The warehouse counts what arrives (anything short is refunded), photographs it, buys the label and sends it in one parcel; the buyer is emailed at every step and can track it from their account. Staff can cancel and refund in full until the items arrive. The console shows requests to price, paid requests to buy, and parcels to book in or send.

Not done: buying from shops in another country than the warehouse; letting buyers add items to a request after pricing; consolidating several requests into one parcel.

Original scope:

- Personal shopping (quote-first flow), vendor returns v2, referrals and campaigns, notifications (in-app + email per country brand), exports with currency columns, admin super-dashboard per country.

### Phase 9 — UK pilot and US migration (tooling done, cutover needs the business)

- Onboard the UK partner under the full model (GBP, UK carriers, VAT, UK legal).
- Migrate USA Errands data into the US country (platform-operated warehouse) with reconciliation reports (ledger balances, stock counts, open orders) signed off before cutover; DNS cutover; old system read-only.

Delivered (27 Oct 2026):

- **US data move.** `npm run migrate:us` reads the old database in one read-only snapshot and writes a report before anything moves: every business, account, product, unit of stock and wallet balance it would carry over, and everything that has to be settled first (orders still being packed, stock shipments not fully received, open personal shopping requests, store sales still owed, reserved stock, overdrawn wallets, products whose details don't fit, emails already used here). With `--apply` and nothing outstanding it moves each business in its own transaction: owner and team accounts keep their passwords, products keep their codes and barcodes (sizes converted to grams and millimetres), stock becomes received lots in the chosen US warehouse with movements, custody events and storage boxes, and wallet balances become a "carried over" credit. A link table makes re-runs skip what has moved, and the report then compares old and new figures line by line.
- Not carried over on purpose: staff accounts (invite them again), two-step sign-in secrets (vendors set it up again if they want it), identity documents and ID numbers, order and wallet history (kept read-only in the old system), stores and storefront listings (vendors relist), and API keys (vendors create new ones).

Still needs the business: a read-only connection to the old database, a date to stop taking new orders there, sign-off on the dry-run report, DNS cutover, and switching the old system to read-only.

### Phase 10 — Open the network

- Public "become a fulfilment partner" funnel, more countries, partner performance automation.

---

## 5. "Ship to" design (client requirement)

- **Vendor level:** each vendor has one operating country (where their stock lives) and a list of preferred ship-to countries. Preferred countries pre-fill order forms; they do not restrict.
- **Order level:** every order has one `destinationCountry`, selected from lanes enabled for the origin warehouse. A vendor can always pick any other enabled destination.
- **Multiple destinations:** a request with recipients in several countries becomes one order per destination (each with its own rates, customs and tracking).
- **Lanes:** `ShippingLane(origin, destination, enabled, customsRequired, restrictedCategories)` managed by super admin; domestic lanes need no customs.
- **Open decision:** duties/taxes model for cross-border lanes (DDP vs DAP). Until decided, cross-border lanes ship DAP (recipient pays) and the vendor is told so at order time.

---

## 6. Testing, CI and environments

- **Unit:** policies, money, fees, state machines, crypto (Jest in API, Vitest in web).
- **Integration/e2e:** Nest app against real Postgres + Redis (Docker in CI): auth flows, IDOR/isolation suites, idempotency, webhook signatures.
- **Contract tests** for every adapter implementation.
- **Web:** component tests for primitives; Playwright smoke for key journeys.
- **CI gates:** typecheck, lint, tests, `npm audit --omit=dev` (fail on high/critical), CodeQL, migration drift check.
- **Environments:** local (Docker Compose), preview (per PR, test keys only), staging (prod-like, network-restricted), production. Secrets live only in the platform's secret store.

---

## 7. Open decisions (need the business)

1. Duties model for cross-border lanes (DDP vs DAP) and whether customs automation is in v1.
2. Partner commercial model (per action vs revenue share vs retainer); deposit sizing formula; liability caps.
3. Partner visibility to vendors (disclosed or platform-only).
4. Partner recruitment: invite-only first, or open funnel from day one.
5. KYC provider per country (cost vs coverage).
6. Brand and domain for the global platform (the USA Errands name will not travel).
7. Data residency requirements per country.
