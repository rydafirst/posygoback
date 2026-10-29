import { z } from "zod";

type Issue = z.core.$ZodRawIssue;

function sizeMessage(issue: Issue & { minimum?: unknown; maximum?: unknown; origin?: string }): string | undefined {
  const limit = Number(issue.code === "too_small" ? issue.minimum : issue.maximum);
  if (issue.origin === "string") {
    if (issue.code === "too_small") {
      return limit <= 1 ? "Fill this in." : `Use at least ${limit} characters.`;
    }
    return `Use ${limit} characters or fewer.`;
  }
  if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
    return issue.code === "too_small" ? `Use ${limit} or more.` : `Use ${limit} or less.`;
  }
  if (issue.origin === "array" || issue.origin === "set") {
    return issue.code === "too_small" ? (limit <= 1 ? "Add at least one." : `Add at least ${limit}.`) : `Add no more than ${limit}.`;
  }
  return undefined;
}

export function plainMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case "too_small":
    case "too_big":
      return sizeMessage(issue);
    case "invalid_type":
      return issue.input === undefined || issue.input === null ? "Fill this in." : "Check this value.";
    case "invalid_format":
      return (issue as { format?: string }).format === "email" ? "Enter a valid email address." : "Check the format.";
    case "invalid_value":
      return "Choose one of the options.";
    default:
      return undefined;
  }
}

z.config({ customError: plainMessage });
