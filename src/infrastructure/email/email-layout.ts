import { PLATFORM_NAME } from "../../common/brand/brand";
import type { EmailDetails, EmailMessage, EmailSignature } from "./email.port";

const INK = "#111111";
const BODY = "#2b2b2b";
const FAINT = "#5c5c5c";
const SEAL = "#1e3a6e";
const YELLOW = "#f8e87d";
const LINE = "#e4e4e7";
const SUNK = "#fafafa";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function linked(text: string): string {
  return escape(text).replace(URL_PATTERN, (url) => `<a href="${url}" style="color:${INK};word-break:break-all">${url}</a>`);
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 18px;font-size:16px;line-height:26px;color:${BODY}">${linked(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function eyebrow(text: string | undefined): string {
  return text ? `<p style="margin:0 0 10px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:1.8px;text-transform:uppercase;color:${SEAL}">${escape(text)}</p>` : "";
}

function details(block: EmailDetails | undefined): string {
  if (!block) {
    return "";
  }
  const rows = block.rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:12px 20px;border-top:1px solid ${LINE};font-size:14px;line-height:20px;color:${FAINT}">${escape(label)}</td><td align="right" style="padding:12px 20px;border-top:1px solid ${LINE};white-space:nowrap;font-size:14px;line-height:20px;font-weight:600;color:${INK}">${escape(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 26px;border:1px solid ${LINE};border-radius:12px;border-collapse:separate;overflow:hidden">
<tr><td colspan="2" style="padding:12px 20px;background:${SUNK};font-size:11px;line-height:16px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:${FAINT}">${escape(block.title)}</td></tr>${rows}</table>`;
}

function button(message: EmailMessage): string {
  if (!message.action) {
    return "";
  }
  const { label, url } = message.action;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 28px"><tr><td bgcolor="${YELLOW}" style="border-radius:10px"><a href="${escape(url)}" style="display:inline-block;padding:13px 22px;font-size:15px;line-height:20px;font-weight:600;color:${INK};text-decoration:none;border-radius:10px">${escape(label)}</a></td></tr></table>`;
}

function signature(signed: EmailSignature | undefined): string {
  if (!signed) {
    return "";
  }
  return `<p style="margin:0 0 4px;font-size:16px;line-height:26px;color:${BODY}">Kind regards,</p><p style="margin:0;font-size:16px;line-height:24px;font-weight:600;color:${INK}">${escape(signed.name)}</p><p style="margin:0 0 8px;font-size:14px;line-height:20px;color:${FAINT}">${escape(signed.title)}</p>`;
}

function preheader(text: string | undefined): string {
  return text ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escape(text)}</div>` : "";
}

export function withoutSignOff(text: string): string {
  return text.replace(new RegExp(`\\n+${PLATFORM_NAME}\\s*$`), "").trimEnd();
}

function withoutButtonLink(text: string, message: EmailMessage): string {
  if (!message.action) {
    return text;
  }
  const parts = text.split(message.action.url);
  return parts
    .map((part, index) => {
      if (index === parts.length - 1) {
        return part;
      }
      const next = parts[index + 1] ?? "";
      return part.replace(/:\s*$/, /^[.,;]/.test(next) ? "" : ".").trimEnd() + (/^\s/.test(next) || /^[.,;]/.test(next) ? "" : " ");
    })
    .join("");
}

export function renderHtml(message: EmailMessage, siteUrl: string): string {
  const site = siteUrl.replace(/\/$/, "");
  const body = paragraphs(withoutButtonLink(withoutSignOff(message.text), message));
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(message.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${FONT}">${preheader(message.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;font-family:${FONT}">
<tr><td style="padding:0 0 20px;border-bottom:1px solid ${LINE}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;vertical-align:middle"><img src="${escape(site)}/brand/email-mark.png" width="28" height="28" alt="" style="display:block;border:0"></td><td style="vertical-align:middle;font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.5px;color:${INK}">${PLATFORM_NAME}</td></tr></table></td></tr>
<tr><td style="padding:36px 0 8px">${eyebrow(message.eyebrow)}<h1 style="margin:0 0 20px;font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.4px;color:${INK}">${escape(message.heading ?? message.subject)}</h1>${body}${details(message.details)}${button(message)}${signature(message.signature)}</td></tr>
<tr><td style="padding:24px 0 0;border-top:1px solid ${LINE};font-size:12px;line-height:18px;color:${FAINT}">${PLATFORM_NAME} · <a href="${escape(site)}" style="color:${FAINT}">${escape(site.replace(/^https?:\/\//, ""))}</a><br>You're getting this because you have a ${PLATFORM_NAME} account.</td></tr>
</table></td></tr></table></body></html>`;
}

function detailsText(block: EmailDetails | undefined): string {
  return block ? `\n\n${block.title}\n${block.rows.map(([label, value]) => `${label}: ${value}`).join("\n")}` : "";
}

export function plainText(message: EmailMessage): string {
  const action = message.action && !message.text.includes(message.action.url) ? `\n\n${message.action.label}: ${message.action.url}` : "";
  const signed = message.signature ? `\n\nKind regards,\n${message.signature.name}\n${message.signature.title}` : "";
  if (!message.details && !message.signature) {
    return `${message.text}${action}`;
  }
  return `${withoutSignOff(message.text)}${detailsText(message.details)}${action}${signed}`;
}
