export function normaliseName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function sameName(first: string | null | undefined, second: string | null | undefined): boolean {
  return Boolean(first && second) && normaliseName(first!) === normaliseName(second!);
}
