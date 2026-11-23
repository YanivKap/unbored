const UA = "Mozilla/5.0 (compatible; unbored/1.0; +https://github.com/YanivKap/unbored)";

export async function get(url: string, timeoutMs = 20000, tries = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "user-agent": UA, accept: "application/json, application/xml, text/xml, */*" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < tries) await new Promise((r) => setTimeout(r, 600 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetch failed for ${url}: ${lastErr}`);
}

export async function getJson<T = unknown>(url: string, timeoutMs = 20000): Promise<T> {
  return JSON.parse(await get(url, timeoutMs)) as T;
}
