import { existsSync } from "node:fs";
import { join } from "node:path";

export function loadEnvironmentFile(directory: string = process.cwd()): void {
  const path = join(directory, ".env");
  if (process.env.NODE_ENV !== "production" && existsSync(path)) {
    process.loadEnvFile(path);
  }
}
