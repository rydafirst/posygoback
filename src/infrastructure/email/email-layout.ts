import { PLATFORM_NAME } from "../../common/brand/brand";
import type { EmailMessage } from "./email.port";

const INK = "#111111";
const SOFT = "#3d3d3d";
const CREAM = "#fffdf2";
const YELLOW = "#f8e87d";
const LINE = "#e3dcc4";
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
    .map((block) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${INK}">${linked(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function button(message: EmailMessage): string {
  if (!message.action) {
    return "";
  }
  const { label, url } = message.action;
  return `<p style="margin:8px 0 24px"><a href="${escape(url)}" style="display:inline-block;background:${YELLOW};color:${INK};font-weight:600;font-size:16px;text-decoration:none;padding:14px 22px;border-radius:999px">${escape(label)}</a></p>`;
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
  const body = paragraphs(withoutButtonLink(withoutSignOff(message.text), message));
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(message.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 20px;font-size:22px;font-weight:700;color:${INK};letter-spacing:-0.5px">✿ ${PLATFORM_NAME}</td></tr>
<tr><td style="background:${CREAM};border:1.5px solid ${LINE};border-radius:20px;padding:28px 28px 12px"><h1 style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:700;color:${INK}">${escape(message.subject)}</h1>${body}${button(message)}</td></tr>
<tr><td style="padding:20px 4px;font-size:13px;line-height:20px;color:${SOFT}">${PLATFORM_NAME} · <a href="${escape(siteUrl)}" style="color:${SOFT}">${escape(siteUrl.replace(/^https?:\/\//, ""))}</a><br>You're getting this because of activity on your ${PLATFORM_NAME} account.</td></tr>
</table></td></tr></table></body></html>`;
}

export function plainText(message: EmailMessage): string {
  return message.action && !message.text.includes(message.action.url) ? `${message.text}\n\n${message.action.label}: ${message.action.url}` : message.text;
}
