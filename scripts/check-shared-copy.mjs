import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const here = resolve(import.meta.dirname, "../src/shared");
const there = resolve(process.argv[2] ?? resolve(import.meta.dirname, process.env.SHARED_COPY_PEER ?? "../../global-fulfilment-web/src/shared"));

function fingerprints(root) {
  const result = new Map();
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name.endsWith(".ts") && !name.endsWith(".spec.ts")) {
        result.set(relative(root, path), createHash("sha256").update(readFileSync(path)).digest("hex"));
      }
    }
  };
  walk(root);
  return result;
}

const mine = fingerprints(here);
const theirs = fingerprints(there);
const differences = [...new Set([...mine.keys(), ...theirs.keys()])].filter((file) => mine.get(file) !== theirs.get(file)).sort();

if (differences.length > 0) {
  process.stderr.write(`Shared contracts differ from ${there}:\n${differences.map((file) => `  ${file}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Shared contracts match ${there}\n`);
