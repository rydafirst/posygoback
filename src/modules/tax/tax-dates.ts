export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dayOf(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function today(): string {
  return isoDay(new Date());
}
