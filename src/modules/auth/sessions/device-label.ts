const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/Firefox\//, "Firefox"],
  [/Chrome\/|CriOS/, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

function first(table: ReadonlyArray<[RegExp, string]>, text: string): string | null {
  return table.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export function deviceLabel(userAgent: string | null | undefined): string {
  const text = userAgent ?? "";
  const browser = first(BROWSERS, text);
  const system = first(SYSTEMS, text);
  if (browser && system) {
    return `${browser} on ${system}`;
  }
  return browser ?? system ?? "an unrecognised browser";
}
