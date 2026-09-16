export const DEFAULT_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json",
  "Accept-Language": "en-US,en;q=0.9,pl;q=0.8",
};

export interface FetchHtmlOptions {
  /** Bun-specific: allow sites with broken TLS chains */
  insecureTls?: boolean;
}

export async function fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
  const init: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
    headers: DEFAULT_FETCH_HEADERS,
  };
  if (options.insecureTls) {
    init.tls = { rejectUnauthorized: false };
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

export async function fetchJson<T>(url: string, options: FetchHtmlOptions = {}): Promise<T> {
  const text = await fetchHtml(url, options);
  return JSON.parse(text) as T;
}

/** True when the response body is a Cloudflare bot challenge, not real content. */
export function isCloudflareChallengePage(html: string): boolean {
  return (
    /cdn-cgi\/challenge-platform/i.test(html) ||
    /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(html) ||
    /Enable JavaScript and cookies to continue/i.test(html)
  );
}
