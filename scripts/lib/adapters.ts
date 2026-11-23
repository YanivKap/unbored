import { get, getJson } from "./http.ts";
import { cleanText, truncateAtSentence, hashId, canonicalUrl } from "./clean.ts";
import type { Candidate } from "./filter.ts";

export interface Source {
  id: string; name: string; type: "wp" | "rss" | "wiki";
  base?: string; url?: string; tag: string; lang: string;
  weight: number; archive?: boolean; archivePosts?: number;
}

const field = (block: string, tag: string): string => {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
};

/** Minimal RSS/Atom extractor. These feeds are known and stable. */
export function parseFeed(xml: string): Array<Record<string, string>> {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)
    ?? xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.map((b) => {
    let link = cleanText(field(b, "link"));
    if (!link) {
      const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href ? href[1] : "";
    }
    return {
      title: cleanText(field(b, "title")),
      link,
      date: cleanText(field(b, "pubDate") || field(b, "published") || field(b, "updated") || field(b, "dc:date")),
      body: field(b, "description") || field(b, "summary") || field(b, "content:encoded") || field(b, "content"),
    };
  });
}

function mk(s: Source, title: string, body: string, url: string, date: string, kind: "flow" | "stock", max: number): Candidate {
  const text = truncateAtSentence(cleanText(body), max);
  const iso = (() => {
    const t = new Date(date);
    return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
  })();
  return {
    id: hashId(url), title: cleanText(title), text, url: canonicalUrl(url),
    sourceId: s.id, source: s.name, tag: s.tag, lang: s.lang,
    date: iso, weight: s.weight, kind,
  };
}

export async function fromRss(s: Source, max: number): Promise<Candidate[]> {
  const xml = await get(s.url!);
  return parseFeed(xml)
    .filter((e) => e.title && e.link)
    .map((e) => mk(s, e.title, e.body, e.link, e.date, "flow", max));
}

interface WpPost {
  date_gmt?: string; date?: string; link: string;
  title: { rendered: string }; excerpt: { rendered: string };
}

export async function fromWp(s: Source, max: number, opts: { page?: number; perPage?: number; afterDays?: number } = {}): Promise<Candidate[]> {
  const perPage = opts.perPage ?? 30;
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(opts.page ?? 1),
    _fields: "date_gmt,date,link,title,excerpt",
  });
  if (opts.afterDays) {
    params.set("after", new Date(Date.now() - opts.afterDays * 86400000).toISOString());
  }
  const posts = await getJson<WpPost[]>(`${s.base}/wp-json/wp/v2/posts?${params}`);
  const kind = opts.page && opts.page > 1 ? "stock" : "flow";
  return posts
    .filter((p) => p?.link && p?.title?.rendered)
    .map((p) => mk(s, p.title.rendered, p.excerpt?.rendered ?? "", p.link, p.date_gmt ?? p.date ?? "", kind, max));
}

/**
 * Hebrew Wikipedia featured + good articles: a curated, finite, timeless set.
 * Far better signal than the random-article endpoint.
 */
export async function fromWiki(s: Source, max: number, limit = 40): Promise<Candidate[]> {
  const cats = ["ערכים מומלצים", "ערכים טובים"];
  const titles: string[] = [];
  for (const cat of cats) {
    const q = new URLSearchParams({
      action: "query", list: "categorymembers", cmtitle: `Category:${cat}`,
      cmlimit: "500", cmnamespace: "0", format: "json", origin: "*",
    });
    try {
      const r = await getJson<{ query?: { categorymembers?: Array<{ title: string }> } }>(
        `https://he.wikipedia.org/w/api.php?${q}`,
      );
      titles.push(...(r.query?.categorymembers ?? []).map((m) => m.title));
    } catch { /* category may be renamed; the other one still works */ }
  }
  if (titles.length === 0) return [];

  // Rotate deterministically by day so the deck differs but never repeats within a day.
  const day = Math.floor(Date.now() / 86400000);
  const picked: string[] = [];
  for (let i = 0; i < Math.min(limit, titles.length); i++) {
    picked.push(titles[(day * 37 + i * 101) % titles.length]);
  }

  const out: Candidate[] = [];
  for (let i = 0; i < picked.length; i += 20) {
    const batch = picked.slice(i, i + 20);
    const q = new URLSearchParams({
      action: "query", prop: "extracts", exintro: "1", explaintext: "1",
      titles: batch.join("|"), format: "json", origin: "*",
    });
    try {
      const r = await getJson<{ query?: { pages?: Record<string, { title: string; extract?: string }> } }>(
        `https://he.wikipedia.org/w/api.php?${q}`,
      );
      for (const p of Object.values(r.query?.pages ?? {})) {
        if (!p.extract) continue;
        out.push({
          ...mk(
            s, p.title, p.extract,
            `https://he.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
            new Date().toISOString(), "stock", max,
          ),
          titleIsName: true,
        });
      }
    } catch { /* skip batch */ }
  }
  return out;
}

export async function fetchSource(s: Source, max: number): Promise<Candidate[]> {
  if (s.type === "rss") return fromRss(s, max);
  if (s.type === "wp") return fromWp(s, max, { perPage: 30, afterDays: 14 });
  if (s.type === "wiki") return fromWiki(s, max);
  return [];
}
