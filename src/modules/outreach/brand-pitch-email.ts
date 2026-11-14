import type { EmailInlineImage } from "../../infrastructure/email/email.port";
import { COMPANY_FOOTER, CONTACT, FOUNDER, PLATFORM_NAME } from "../../common/brand/brand";

const COLOUR = {
  cream: "#f5f1e0",
  paper: "#fffdf2",
  ink: "#4d3927",
  inkSoft: "#6e5a47",
  inkFaint: "#76644f",
  line: "#e3dcc4",
  onInk: "#e2d8bf",
  yellow: "#f8e87d",
  lime: "#dce88c",
  sky: "#8dd0fb",
  pink: "#f3b2af",
  orange: "#ec905d",
  blue: "#4176c5",
} as const;

const FONT = "'Instrument Sans','Helvetica Neue',Arial,sans-serif";
const LABEL = `font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${COLOUR.inkFaint}`;

export interface BrandPitchFields {
  business: string;
  name: string | null;
  stopUrl: string;
  siteUrl: string;
}

export interface BrandPitchEmail {
  html: string;
  images: EmailInlineImage[];
}

interface Step {
  colour: string;
  image: string;
  alt: string;
  label: string;
  title: string;
}

const STEPS: readonly Step[] = [
  {
    colour: COLOUR.yellow,
    image: "ship.gif",
    alt: "Stock flying in one bulk shipment from Lagos to a Posygo hub abroad",
    label: "1 · Send once, in bulk",
    title: "Your stock goes in one shipment to our hub in your customers' country, like the UK.",
  },
  { colour: COLOUR.lime, image: "pack.gif", alt: "A hub worker picks, scans and packs a new order", label: "2 · A customer orders", title: "Our hub picks, checks and packs it the same day." },
  {
    colour: COLOUR.sky,
    image: "deliver.gif",
    alt: "A courier walks the parcel to the customer's door: delivered on day 2",
    label: "3 · Delivered locally",
    title: "Your customer gets it in 2–3 days, with no duties at the door.",
  },
];

const BENEFITS: ReadonlyArray<readonly [text: string, background: string, colour: string]> = [
  ["2–3 day delivery", COLOUR.yellow, COLOUR.ink],
  ["No customs charge for customers", COLOUR.pink, COLOUR.ink],
  ["Local delivery prices", COLOUR.sky, COLOUR.ink],
  ["Every order tracked from Lagos", COLOUR.lime, COLOUR.ink],
  ["No warehouse to run", COLOUR.blue, "#ffffff"],
  ["Pay only for what you use", COLOUR.orange, COLOUR.ink],
];

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function row(content: string, padding: string, style = ""): string {
  return `<tr><td style="padding:${padding};${style}">${content}</td></tr>`;
}

function image(src: string, alt: string, width: number, radius: number): string {
  return `<img src="${src}" width="${width}" alt="${escape(alt)}" style="display:block;border:0;width:100%;max-width:${width}px;height:auto;border-radius:${radius}px">`;
}

function contentId(file: string): string {
  return file.replace(/\.\w+$/, "");
}

function inline(file: string): string {
  return `cid:${contentId(file)}`;
}

function step(item: Step): string {
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${item.colour};border-radius:6px">
${row(image(inline(item.image), item.alt, 508, 12), "18px 18px 0")}
${row(`<span style="font-size:12px;font-weight:700;text-transform:uppercase">${escape(item.label)}</span><br><span style="font-size:20px;line-height:26px;font-weight:600">${escape(item.title)}</span>`, "14px 18px 18px")}
</table>`,
    "18px 28px 0",
  );
}

function benefits(): string {
  return BENEFITS.map(
    ([text, background, colour]) =>
      `<span style="display:inline-block;font-size:14px;font-weight:600;padding:8px 12px;border-radius:8px;background:${background};color:${colour};line-height:20px">${escape(text)}</span>`,
  ).join(" ");
}

export function brandPitchWhatsappUrl(): string {
  return `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(`Hi Tolu, I'd like to know more about ${PLATFORM_NAME}`)}`;
}

const IMAGES = ["logo.png", "today.gif", ...STEPS.map((item) => item.image)];

export function renderBrandPitch(fields: BrandPitchFields): BrandPitchEmail {
  const site = fields.siteUrl.replace(/\/$/, "");
  const assets = `${site}/email/brand`;
  return { html: pitchHtml(fields, site), images: IMAGES.map((file) => ({ contentId: contentId(file), filename: file, url: `${assets}/${file}` })) };
}

function pitchHtml(fields: BrandPitchFields, site: string): string {
  const brand = escape(fields.business);
  const greeting = escape(fields.name ?? "there");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Faster delivery for ${brand}'s customers abroad</title></head>
<body style="margin:0;padding:0;background:${COLOUR.cream}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Your customers abroad could get ${brand} orders in 2–3 days, with no duties at the door.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOUR.cream}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLOUR.cream};font-family:${FONT};color:${COLOUR.ink}">
${row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="left" valign="middle"><img src="${inline("logo.png")}" width="135" height="44" alt="${PLATFORM_NAME}" style="display:block;border:0;width:135px;height:44px"></td><td align="right" valign="middle"><span style="display:inline-block;background:${COLOUR.lime};${LABEL};color:${COLOUR.ink};padding:6px 10px;border-radius:8px">For brands selling abroad</span></td></tr></table>`, "8px 28px 0")}
${row(`Hi ${greeting},`, "32px 28px 0", "font-size:16px;line-height:24px")}
${row(`Your customers abroad shouldn't wait two weeks for ${brand}.`, "14px 28px 0", "font-size:40px;line-height:42px;font-weight:600;letter-spacing:-1.4px")}
${row(`I'm Tolu, founder of ${PLATFORM_NAME}. I noticed ${brand} ships from Lagos to customers abroad, in places like the UK. Here's a faster, cheaper way to get your orders to them.`, "16px 28px 0", `font-size:17px;line-height:27px;color:${COLOUR.inkSoft}`)}
${row(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOUR.paper};border:1px solid ${COLOUR.line};border-radius:20px">
${row("Today", "20px 20px 0", LABEL)}
${row(image(inline("today.gif"), "A customer waiting at her door, days passing, with a customs charge to pay", 502, 14), "12px 20px 0")}
${row("Every order travels alone from Lagos. Your customer waits one to two weeks, and is often asked to pay import duties at her own door. Many don't order again, not because of your product, but because of the delivery.", "14px 20px 20px", "font-size:16px;line-height:24px")}
</table>`,
  "28px 28px 0",
)}
${row(`With ${PLATFORM_NAME}`, "40px 28px 0", LABEL)}
${row("Sell abroad like a local brand.", "6px 28px 0", "font-size:30px;line-height:33px;font-weight:600;letter-spacing:-1px")}
${STEPS.map(step).join("\n")}
${row(`What ${brand} gets`, "36px 28px 0", LABEL)}
${row(benefits(), "10px 28px 0", "line-height:44px")}
${row(
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOUR.ink};border-radius:20px">
${row(`Can I show you how it would work for ${brand}?`, "28px 26px 0", `font-size:27px;line-height:31px;font-weight:600;letter-spacing:-0.8px;color:${COLOUR.cream}`)}
${row("Send me a message on WhatsApp and I'll walk you through it. Or simply reply to this email.", "12px 26px 0", `font-size:16px;line-height:24px;color:${COLOUR.onInk}`)}
${row(`<a href="${escape(brandPitchWhatsappUrl())}" style="display:inline-block;background:${COLOUR.lime};color:${COLOUR.ink};font-size:16px;font-weight:700;text-decoration:none;padding:15px 22px;border-radius:8px">Chat with me on WhatsApp</a>`, "20px 26px 28px")}
</table>`,
  "34px 28px 0",
)}
${row(`Thank you for your time. I'd love to help ${brand}'s customers abroad get their orders faster.<br><br>Best regards,<br><strong style="font-size:18px">${FOUNDER.name}</strong><br><span style="font-size:14px;color:${COLOUR.inkSoft}">${FOUNDER.title}</span><br><span style="font-size:14px;color:${COLOUR.inkSoft}"><a href="${site}" style="color:${COLOUR.ink}">${site.replace(/^https?:\/\//, "")}</a> · <a href="mailto:${CONTACT.email}" style="color:${COLOUR.ink}">${CONTACT.email}</a> · ${CONTACT.phone}</span>`, "32px 28px 0", "font-size:16px;line-height:24px")}
${row(`<div style="height:1px;background:${COLOUR.line};line-height:1px;font-size:1px">&nbsp;</div>`, "32px 28px 8px")}
${row("Sell abroad like a local brand", "8px 28px 0", LABEL)}
${row(`${escape(COMPANY_FOOTER)}<br>Not the right person? I'd be grateful if you could forward this to whoever handles delivery. Not interested? <a href="${escape(fields.stopUrl)}" style="color:${COLOUR.inkFaint};text-decoration:underline">Don't email me again</a>`, "6px 28px 24px", `font-size:12px;line-height:18px;color:${COLOUR.inkFaint}`)}
</table>
</td></tr></table>
</body></html>`;
}
