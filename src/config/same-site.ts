function siteOf(url: string): string {
  return new URL(url).hostname.split(".").slice(-2).join(".");
}

export function sharesSite(apiUrl: string, webUrl: string): boolean {
  return siteOf(apiUrl) === siteOf(webUrl);
}
