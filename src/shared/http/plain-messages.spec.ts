import { z } from "zod";

import "./plain-messages";

const first = (schema: z.ZodType, value: unknown) => schema.safeParse(value).error?.issues[0]?.message;

describe("plain validation messages", () => {
  it("explains limits in everyday words", () => {
    expect(first(z.string().trim().min(10), "short")).toBe("Use at least 10 characters.");
    expect(first(z.string().min(1), "")).toBe("Fill this in.");
    expect(first(z.string().max(3), "toolong")).toBe("Use 3 characters or fewer.");
    expect(first(z.number().min(1), 0)).toBe("Use 1 or more.");
    expect(first(z.string().email(), "nope")).toBe("Enter a valid email address.");
    expect(first(z.object({ name: z.string() }), {})).toBe("Fill this in.");
    expect(first(z.enum(["A", "B"]), "C")).toBe("Choose one of the options.");
  });

  it("keeps messages written for a specific field", () => {
    expect(first(z.string().min(2, "Enter your full name"), "a")).toBe("Enter your full name");
  });
});
