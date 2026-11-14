import { z } from "zod";

export const OUTREACH_KINDS = ["PREP_CENTRE", "CARGO_AGENT", "COURIER", "INDIVIDUAL", "BRAND", "OTHER"] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];

export const OUTREACH_STATUSES = ["NOT_CONTACTED", "MESSAGED", "REPLIED", "CALL_BOOKED", "ONBOARDED", "DECLINED", "UNSUBSCRIBED"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const OUTREACH_LIMITS = { perSend: 50, perDay: 150 } as const;

export const OUTREACH_FIELDS = ["{business}", "{name}", "{city}", "{country}"] as const;

export const OUTREACH_DESIGNS = ["brand-pitch"] as const;
export type OutreachDesign = (typeof OUTREACH_DESIGNS)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const outreachContactSchema = z.object({
  business: z.string().trim().min(2).max(120),
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(254)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  phone: optionalText(40),
  website: z
    .string()
    .trim()
    .url()
    .max(300)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  country: z.string().trim().min(2).max(60),
  city: optionalText(80),
  kind: z.enum(OUTREACH_KINDS),
  notes: optionalText(1000),
  source: optionalText(300),
});
export type OutreachContactInput = z.infer<typeof outreachContactSchema>;

export const updateOutreachContactSchema = outreachContactSchema.partial().extend({ status: z.enum(OUTREACH_STATUSES).exclude(["UNSUBSCRIBED"]).optional() });
export type UpdateOutreachContactInput = z.infer<typeof updateOutreachContactSchema>;

export const importOutreachSchema = z.object({ contacts: z.array(outreachContactSchema).min(1).max(200) });
export type ImportOutreachInput = z.infer<typeof importOutreachSchema>;

export const sendOutreachSchema = z.object({
  contactIds: z
    .array(z.string().uuid())
    .min(1)
    .max(OUTREACH_LIMITS.perSend)
    .refine((ids) => new Set(ids).size === ids.length, "Each contact can only be picked once"),
  subject: z.string().trim().min(3).max(150),
  body: z.string().trim().min(20).max(5000),
  design: z.enum(OUTREACH_DESIGNS).optional(),
});
export type SendOutreachInput = z.infer<typeof sendOutreachSchema>;

export const outreachListSchema = z.object({ status: z.enum(OUTREACH_STATUSES).optional(), country: z.string().trim().max(60).optional(), q: z.string().trim().max(120).optional() });
export type OutreachListQuery = z.infer<typeof outreachListSchema>;

export interface OutreachContactView {
  id: string;
  business: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  country: string;
  city: string | null;
  kind: OutreachKind;
  status: OutreachStatus;
  notes: string | null;
  source: string | null;
  lastMessagedAt: string | null;
  messageCount: number;
  createdAt: string;
}

export interface OutreachMessageView {
  id: string;
  subject: string;
  body: string;
  status: "SENT" | "FAILED";
  error: string | null;
  sentAt: string;
  sentByEmail: string;
}

export interface OutreachContactDetailView extends OutreachContactView {
  messages: OutreachMessageView[];
}

export interface OutreachSkip {
  contactId: string;
  business: string;
  reason: string;
}

export interface OutreachSendResultView {
  sent: number;
  failed: number;
  skipped: OutreachSkip[];
  sentToday: number;
}

export interface OutreachImportResultView {
  added: number;
  duplicates: string[];
}

export interface OutreachTemplate {
  id: string;
  title: string;
  subject: string;
  body: string;
  design?: OutreachDesign;
}

type Fillable = Pick<OutreachContactView, "business" | "contactName" | "city" | "country">;

export function fillOutreach(template: string, contact: Fillable): string {
  return template
    .replaceAll("{business}", contact.business)
    .replaceAll("{name}", contact.contactName ?? "there")
    .replaceAll("{city}", contact.city ?? contact.country)
    .replaceAll("{country}", contact.country);
}

export const OUTREACH_TEMPLATES: readonly OutreachTemplate[] = [
  {
    id: "brand",
    title: "Brand selling abroad (designed email)",
    subject: "Faster delivery for {business}'s customers abroad",
    design: "brand-pitch",
    body: `Hi {name},

I'm Tolu, founder of Posygo. I noticed {business} ships to customers in the UK and beyond from Lagos. Here's a faster, cheaper way to get your orders to them.

Today, every order travels alone from Lagos. Your customer waits one to two weeks, and is often asked to pay import duties at her own door. Many don't order again, not because of your product, but because of the delivery.

With Posygo:
1. You send your stock to our hub in the UK once, in bulk.
2. When a customer orders, our hub picks, checks and packs it the same day.
3. Your customer gets it in 2-3 days, with no duties at the door.

Can I show you how it would work for {business}? Send me a message on WhatsApp and I'll walk you through it: https://wa.me/447350162342. Or simply reply to this email.

Best regards,
Tolulope Olonibua
Founder, Posygo Ltd`,
  },
  {
    id: "prep-centre",
    title: "Prep centre or 3PL",
    subject: "More clients for {business}",
    body: `Hi {name},

I'm Tolu, founder of Posygo (posygo.com). We help online sellers, many of them in Nigeria, keep their stock in the country their customers are in, so orders arrive in days instead of weeks.

I'm looking for one fulfilment partner in {city} to receive, store and post orders for our sellers. It's the work {business} already does: count the boxes when they arrive, keep them on the shelf, and pack and post each order through our app.

You keep 70% of the storage, receiving and packing fees on every box and order you handle, and the first five partners in each country get an extra 5%. There's no deposit and no cost to join.

Would you be open to a 15-minute call this week?

Thanks,
Tolu
Posygo Ltd`,
  },
  {
    id: "cargo-agent",
    title: "Nigerian cargo agent",
    subject: "A second income stream for {business}",
    body: `Hi {name},

I'm Tolu, founder of Posygo (posygo.com). {business} already ships between Nigeria and {country}, so I think this could add a second income stream for you.

Nigerian sellers use Posygo to keep their stock in {country} and post orders to customers there, instead of shipping each order from Lagos. I need a partner in {city} to receive their boxes, store them, and pack and post orders through our app.

You keep 70% of the storage, receiving and packing fees, with an extra 5% for the first five partners in each country. There's no deposit and no cost to join, and the sellers who send stock abroad may well use your cargo service to get it there.

Could we talk for 15 minutes this week?

Tolu
Posygo Ltd`,
  },
  {
    id: "follow-up",
    title: "Follow-up",
    subject: "Following up: fulfilment partner in {city}",
    body: `Hi {name},

I wanted to follow up on my note about becoming Posygo's fulfilment partner in {city}. We're onboarding sellers now and I'd love {business} to handle their stock.

If it helps, I can send our partner earnings sheet or answer questions by email. Would a short call work this week?

Thanks,
Tolu
Posygo Ltd`,
  },
];
