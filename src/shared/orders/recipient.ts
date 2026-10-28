import { z } from "zod";

import { type AddressRules, isoCountryCode } from "../country/country.schema";

const text = (max: number) => z.string().trim().min(1).max(max);

export const recipientSchema = z.object({
  name: z.string().trim().min(2, "Enter the recipient's name").max(100),
  company: z.string().trim().max(100).optional(),
  line1: text(100),
  line2: z.string().trim().max(100).optional(),
  city: text(60),
  region: z.string().trim().max(40).optional(),
  postalCode: z.string().trim().toUpperCase().max(16),
  countryCode: isoCountryCode,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/, "Enter a phone number with digits, spaces or dashes")
    .optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254).optional(),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const orderRecipientSchema = recipientSchema.extend({ countryCode: isoCountryCode.optional() });
export type OrderRecipient = z.infer<typeof orderRecipientSchema>;

const MAX_POSTAL_INPUT = 16;

export function recipientProblems(recipient: Recipient, rules: AddressRules): Record<string, string[]> {
  const problems: Record<string, string[]> = {};
  const add = (field: string, message: string) => {
    problems[field] = [...(problems[field] ?? []), message];
  };
  const postal = recipient.postalCode;
  if (postal.length === 0 || postal.length > MAX_POSTAL_INPUT || !new RegExp(rules.postalCodePattern, "i").test(postal)) {
    add("postalCode", `Enter a valid ${rules.postalCodeLabel.toLowerCase()}`);
  }
  if (rules.regionRequired && !recipient.region) {
    add("region", `Enter the ${rules.regionLabel.toLowerCase()}`);
  }
  if (recipient.region && rules.regionCodes.length > 0 && !rules.regionCodes.includes(recipient.region.toUpperCase())) {
    add("region", `Choose a valid ${rules.regionLabel.toLowerCase()}`);
  }
  return problems;
}

export function prefixProblems(problems: Record<string, string[]>, prefix: string): Record<string, string[]> {
  return Object.fromEntries(Object.entries(problems).map(([field, messages]) => [`${prefix}.${field}`, messages]));
}
