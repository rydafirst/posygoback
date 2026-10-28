# Global Fulfilment Network — API

The backend of the Global Fulfilment Network: a country-agnostic fulfilment platform where vendors warehouse stock with vetted fulfilment partners in each market, and the platform holds the money, the software and the oversight. The web app lives in its own project, `global-fulfilment-web`.

- Plan, phase by phase: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- Security model and controls: [`docs/SECURITY.md`](docs/SECURITY.md)

## Stack

NestJS 11 · Prisma 7 (PostgreSQL driver adapter) · PostgreSQL 16 · Redis 7 · Zod 4 · S3-compatible private storage (MinIO locally)

```
src/modules      Features: auth, countries, onboarding, staff, stock, files, health
src/shared       Contracts shared with the web app (keep identical; see "Shared contracts")
src/database     Prisma service, row locking and the development seed
prisma           schema.prisma and SQL migrations (triggers and constraints included)
test             End-to-end tests against real PostgreSQL and Redis
```

## Requirements

Node 22, npm 10, Docker (for local Postgres, Redis and MinIO).

## First run

```bash
npm install                                      # also generates the Prisma client
docker compose up -d postgres redis storage storage-init

cp .env.example .env                             # then replace every "replace-…" value:
#   openssl rand -base64 64  → JWT_ACCESS_SECRET, MFA_CHALLENGE_SECRET
#   openssl rand -base64 32  → FIELD_ENCRYPTION_KEYS (as v1:<value>), BLIND_INDEX_KEY

npm run db:migrate                               # prisma migrate deploy
SEED_SUPER_ADMIN_EMAIL=you@example.com SEED_SUPER_ADMIN_PASSWORD='a long local password' npm run seed

npm run dev                                      # http://localhost:4000
```

In development, emails (verification codes, reset links, invitations) are written to the log. The API refuses to start in production without a real email transport.

The seed creates the UK and US markets, placeholder legal documents (marked "DEVELOPMENT PLACEHOLDER" — replace them with counsel's versions before any real vendor signs), and a development warehouse with three shelf locations in each market. The super admin must set up an authenticator app on first sign-in, and can then invite warehouse operators and other staff.

MinIO's console is at http://localhost:9001 (user `gfn_local`). If the pinned MinIO image tags in `docker-compose.yml` aren't available in your registry, use the nearest release. In production, add a lifecycle rule that expires `incoming/` objects after one day.

## Checks

```bash
npm run typecheck
npm run lint
npm test                                         # unit tests
npm run test:e2e                                 # end-to-end, uses database gfn_test
npm run build
npm run audit:prod
```

## Browser test accounts

`npm run seed:e2e` creates or resets one account per role at `@e2e.gfn.local`, a test partner hub with stock and a funded test vendor, for the web app's browser tests. It only runs against a local database and never in production. `npm run seed:e2e:limits` just clears local rate limits. Each run also closes the test vendor's store so the store journey starts from scratch. Two helpers exist for the store journey only: `npm run seed:e2e:buyer-link -- <email>` prints a one-time buyer sign-in token (instead of reading the log), and `npm run seed:e2e:deliver -- <SF-reference>` marks a store order delivered, and `npm run seed:e2e:hand-off -- <ORD-reference>` moves a warehouse order to handed off.

## Changing the database

Edit `prisma/schema.prisma`, then `npm run db:migrate:dev -- --name <change>`. Database rules Prisma's schema can't describe — triggers, check constraints, partial unique indexes — go in a migration created with `npx prisma migrate dev --create-only --name <change>` and edited by hand, as with the audit and custody chains in `prisma/migrations`.

The first time you set the project up, confirm the schema and migrations agree:

```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma \
  --shadow-database-url postgresql://gfn:gfn_local_only@localhost:5432/postgres --exit-code
```

CI runs the same check.

## Shared contracts

`src/shared` holds the rules both projects must agree on (roles and permissions, money, country rules, request schemas). The web project keeps an identical copy. After changing a file here, copy it to `global-fulfilment-web/src/shared` and run `npm run shared:check` (it expects the web project next to this one, or pass its `src/shared` path as an argument). Test files (`*.spec.ts`) live only in this project.

## Payments

`PAYMENT_ACCOUNTS` is JSON, one entry per country code:

```
{"GB":{"processor":"STRIPE","secretKey":"rk_live_…","webhookSecret":"whsec_…","feePercentBps":150,"fixedFeeMinor":20},
 "US":{"processor":"STRIPE","secretKey":"rk_live_…","webhookSecret":"whsec_…","feePercentBps":290,"fixedFeeMinor":30}}
```

- Use a restricted key with Checkout Sessions write and Refunds write, and nothing else you don't need. The fee figures are what the card processor charges you; they are added to the vendor's payment so the wallet receives the full amount.
- In Stripe, add a webhook endpoint per country: `https://<api host>/v1/webhooks/stripe/<COUNTRY>` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`. Put its signing secret in `webhookSecret`.
- `"processor":"SANDBOX"` (no keys) gives a practice checkout for development. Production refuses it and refuses test keys.
- A refund or dispute that arrives before its payment is answered with 503 on purpose; Stripe sends it again.

## Storefronts

- **Opening a store** needs a store name and address, at least one product listed with a price, and a bank account connected through the partner payout provider (`PARTNER_SERVICES`, Stripe Connect in production). The one-time set-up fee, our commission (if any) and the minimum hold before paying a vendor are in each market's price list under `storefront`.
- **Buyers pay us.** Checkout uses the market's `PAYMENT_ACCOUNTS` entry and the same Stripe webhook. The vendor's share is sent to their bank after the store's return window (fixed for each order when it's paid) or the minimum hold, whichever is longer, and never while a return is open. Their wallet still pays the fulfilment fee; the buyer pays for the label.
- **Tax.** UK prices include VAT and the vendor keeps it; US sales tax is added at checkout from the market's regional rates and kept by us. Have an accountant confirm this for each market before going live.
- **Buyer accounts** are created at checkout. Buyers sign in from an emailed one-time link; nothing to configure.
- Paid orders stuck waiting for a vendor top-up are retried every 10 minutes and payouts are released hourly (with `JOBS_ENABLED=true`).

## Personal shopping

Buyers send links from `/shop-for-me`; country staff price them at `/admin/shopping`. Our fee is in each market's price list under `shopping` (a percentage of the items with a minimum). Payment uses the market's `PAYMENT_ACCOUNTS` entry and the same Stripe webhook as stores (the checkout carries `orderKind: SHOPPING`), and refunds for sold-out items or cancellations go back to the buyer's card through the same account. The warehouse buys the label with the market's carrier account. Nothing else to configure.

## Deploying on Railway

`railway.json` builds the app, applies any new database migrations before each deploy, runs the development seed (it only adds what's missing, and refuses to run when `NODE_ENV=production`), then starts the server once `/v1/health/ready` answers. Set `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` in the service variables to have the first admin created on deploy.

## Testing without email

The helper can answer open questions with Claude. It's off until you set `ASSISTANT_AI=anthropic` and `ANTHROPIC_API_KEY`; `ASSISTANT_AI_MODEL` picks the model (default `claude-haiku-5-5`), and `ASSISTANT_DAILY_ANSWERS` caps answers across everyone per day. It reads the page notes and guides from the web app's `/assistant-knowledge.json` (override with `ASSISTANT_KNOWLEDGE_URL`). The admin console's Support cases page shows questions it couldn't answer and how many tokens it used.

Email goes through Resend once you set `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` and `EMAIL_FROM` (an address on a domain verified in Resend, for example `Posygo <hello@posygo.com>`); `EMAIL_REPLY_TO` sets where replies go. Every email is rendered as a branded HTML email with a plain-text version, tagged with its kind, retried on temporary failures, and recorded in the email log (recipient, kind, subject with codes hidden, sent or failed). Staff can search the log on the admin console's Support cases page. Without Resend, emails are written to the server log.

Set `SUPPORT_EMAIL` to the inbox that should hear about new support cases from the in-app helper; leave it empty to see them only on the admin console's Support cases page.

Until a real email service is connected, codes are written to the server log. Setting `AUTH_TEST_SHORTCUTS=on` adds a "Skip for testing" option to the email code step (the password is still checked) and to authenticator set-up (for that sign-in only). Every skip is audited, and the server refuses to start with it on in production. Remove the variable once email works.

## Moving US data from the old system

1. Create the US warehouse here (platform-run, no partner) and its storage locations, using the same location codes as before if you want stock placed on them.
2. Give this server a read-only connection to the old database: `SOURCE_DATABASE_URL=postgres://readonly@old-host/db`.
3. Build, then run a dry run: `npm run build && npm run migrate:us -- --warehouse <code> --report us-move.md`. Add `--schema <name>` if the old tables aren't in `public`.
4. Fix everything marked BLOCKER in the report (finish or cancel orders being packed, receive or cancel open stock shipments, settle overdrawn wallets and store payouts) and repeat until there are none. Have finance sign off the report.
5. Stop new orders in the old system, run once more with `--apply`, and check that every line in the new report says OK. Running it again is safe: anything already moved is skipped.

Vendors sign in with their old email and password and are asked to accept the US vendor agreement before trading.

## Carriers

`CARRIER_ACCOUNTS` is JSON, one entry per origin country:

```
{"GB":{"provider":"SHIPPO","apiKey":"shippo_live_…","webhookToken":"<openssl rand -hex 32>","senderPhone":"+44 …","senderEmail":"dispatch@…"}}
```

- In Shippo, add a tracking webhook (`track_updated`) per country pointing at `https://<api host>/v1/webhooks/shippo/<COUNTRY>/<webhookToken>`. The token is masked in logs; the status is always re-fetched from Shippo.
- `"provider":"SANDBOX"` gives practice rates and labels for development, with buttons on the order page to move tracking along. Production refuses it and refuses `shippo_test_` tokens.
- Packaging sizes are managed per country under Packaging in the console (`npm run seed` adds five starter sizes).

## Fulfilment partners

Partners are people who run a hub from home. They apply on the public partner page with a referee; nobody is invited by staff.

- **Providers.** `PARTNER_SERVICES` picks payouts, and the Stripe Identity fallback for identity checks (see Identity checks below). `{"provider":"PRACTICE"}` opens a pretend payout account, for development only. Production needs `{"provider":"STRIPE","secretKey":"sk_live_…","identityWebhookSecret":"whsec_…","connectWebhookSecret":"whsec_…"}` and refuses anything else.
- **Stripe webhooks.** Add `account.updated` (Connect) pointing at `https://<api host>/v1/webhooks/stripe-connect`. If Stripe Identity is the identity provider, also add `identity.verification_session.*` events pointing at `https://<api host>/v1/webhooks/stripe-identity`. Signatures are checked on the raw body and the state is always re-read from Stripe.
- **Per-country settings** live under Countries → Partner settings: whether applications are open, the tax reference and its format, the work declaration, the platform's stock cover shown to vendors, optional deposit and partner insurance (zero means none), how long proof of address is kept after the decision (default 90 days), the tiers, and the test vendor for test orders.
- **Test vendor.** Test orders charge and ship from one internal vendor account per country. Mark it with `UPDATE vendors SET is_test_account = true WHERE id = '<id>'` (there's deliberately no screen for this), give it an ordinary business name, keep a little stock at each hub, then pick it in the country's partner settings.
- **What partners earn** — their share of receiving, storage and pick-and-pack fees, the founding bonus and places, the holdback percentage and days — is part of each market's price list and goes through the same approval as vendor prices. Postage and packaging are passed to vendors at cost and aren't shared.
- **Custody rules** per country (same screen): how often routine counts run, the loss rate that raises an alert, the trust score that pauses a hub and the score needed for a tier raise, the parcel value that needs a tamper seal, and how long a handed-off parcel can go without a carrier scan.
- **Claims and transfers.** Country ops and compliance assess claims; finance or a super admin decides them, never the same person. Country ops request transfers between hubs; the sending hub seals and photographs, the receiving hub counts blind.
- Publish the partner agreement for the country under Legal before opening applications. Partners sign it by typing their name; the version, time, IP and a fingerprint of the text are kept.

## Identity checks

Sellers and partners verify their identity (ID document, live selfie and face match) through one provider. The seller verification wizard and the partner identity step both use it, and we keep only the outcome: status, document type, issuing country, expiry and whether the name matches. ID photos are never stored.

| Variable | Meaning |
| --- | --- |
| `IDENTITY_PROVIDER` | `didit`, `stripe` or `practice`. Left empty, Didit is used when its three keys are set, then Stripe Identity when `PARTNER_SERVICES` is Stripe, then practice. If the chosen provider has no settings outside production, the API logs a warning and uses practice. |
| `DIDIT_API_KEY` | API key from the Didit console. |
| `DIDIT_WORKFLOW_ID` | ID of the Didit workflow to run. |
| `DIDIT_WEBHOOK_SECRET` | The webhook destination's shared secret. |
| `DIDIT_API_URL` | Optional. Defaults to `https://verification.didit.me`. |

Production refuses to start with `IDENTITY_PROVIDER=didit` and any Didit key missing, and refuses practice checks.

Setting up Didit:

1. In the Didit console, create a workflow with ID verification, liveness and face match, and copy its ID into `DIDIT_WORKFLOW_ID`.
2. Create an API key and put it in `DIDIT_API_KEY`.
3. Add a webhook destination for the `status.updated` event at `https://api.posygo.com/v1/webhooks/didit`, and copy its secret into `DIDIT_WEBHOOK_SECRET`.
4. Set `IDENTITY_PROVIDER=didit` and redeploy.

Webhooks are checked against `X-Signature-V2` (or `X-Signature` on the raw body) and `X-Timestamp` (5 minutes either way). Each `event_id` is handled once, and the decision is always fetched from Didit rather than read from the payload. If someone comes back from the check before the webhook arrives, the page asks for the result itself (`POST /v1/vendor/verification/identity/refresh` or `POST /v1/partner/identity/refresh`). Older seller cases keep their typed ID number, which reviewers can still reveal.

To fall back to Stripe Identity, set `IDENTITY_PROVIDER=stripe` with a Stripe `PARTNER_SERVICES`; the `/v1/webhooks/stripe-identity` endpoint then takes over, and events sent to the other provider's endpoint are ignored.

## Scheduled jobs

With `JOBS_ENABLED=true` the API runs storage billing at 02:00 UTC, partner upkeep (holdback release, missed stock counts, tier raises, proof-of-address deletion, payout retries, insurance reminders) at 02:30 UTC followed by custody checks (missing carrier scans, losses, trust score, routine counts), wallet reconciliation at 03:00 UTC, and audit-chain anchoring to object storage at 23:50 UTC. Customer returns are tidied at 02:40 UTC (returns that never arrived are closed and the fee given back; returns the vendor didn't answer within 14 days go back on sale), read notifications older than 90 days are deleted at 03:50 UTC, referral sign-ups are matched to their codes and credits paid hourly at :25, and store orders are checked every 10 minutes (unpaid checkouts expire, orders waiting for a vendor top-up are retried, shipping status is copied over, personal shopping prices older than 7 days expire, unconfirmed requests are closed after 48 hours, and refused refunds are tried again) and vendor payouts are released hourly. Turn on object lock for the storage bucket in production so anchors can't be rewritten. Running several instances is safe: each job takes a Redis lock. Set it to `false` on instances that shouldn't run jobs.

## Deployment notes

- Deploy separately from the web app. Serve both on the same registrable domain (for example `app.example.com` and `api.example.com`) so the refresh cookie stays first-party. Set `COOKIE_DOMAIN` only if you need it shared across subdomains.
- Behind a proxy or CDN, set `TRUST_PROXY_HOPS`, and set `CLIENT_IP_HEADER` (for example `cf-connecting-ip`) only when that header is set by infrastructure you control. Rate limits key on this IP.
- Run `npm run db:migrate` as a separate release step with a migration role; run the app with a role that has no DDL rights.
