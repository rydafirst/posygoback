import { type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

import { Errors } from "./app-exception";

export class ZodValidationPipe<Output> implements PipeTransform<unknown, Output> {
  constructor(private readonly schema: ZodType<Output>) {}

  transform(value: unknown): Output {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.map(String).join(".") || "_";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    throw Errors.validation(fieldErrors);
  }
}
