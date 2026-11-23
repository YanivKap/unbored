import { createHash } from "node:crypto";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m);
}

export function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/** Publisher boilerplate that shows up inside RSS/WP excerpts. */
const BOILERPLATE: RegExp[] = [
  /\[…\]/g,
  /\[\.\.\.\]/g,
  /Read More\.{0,3}/gi,
  /הפוסט\s.*?הופיע\sלראשונה\sב.*$/s, // "הפוסט X הופיע לראשונה ב..."
  /The post\s.*?(?:appeared first on|first appeared on).*$/is,
  /\sfirst appeared on\s.*$/is,
  /קראו?\sעוד.*$/g,      // "קרא/קראו עוד"
  /לכל\sהכתבות.*$/g, // "לכל הכתבות"
  /לחצו\sכאן.*$/g,        // "לחצו כאן"
  /Comments?\s*$/i,
  /Article URL:\s*\S+/gi,
  /Comments URL:\s*\S+/gi,
  /Points:\s*\d+/gi,
  /#\s*Comments:\s*\d+/gi,
];

export function cleanText(raw: string): string {
  let s = decodeEntities(stripHtml(raw));
  for (const re of BOILERPLATE) s = s.replace(re, " ");
  // Drop a leading byline ("מאת תום צייגר", "By Jane Doe") before the real text.
  s = s.replace(/^\s*(?:\u05de\u05d0\u05ea|By)\s+(?:\S+\s){1,3}?(?=[\u05d0-\u05ea A-Z])/u, "");
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Truncate at the last sentence boundary under max, so cards never end mid-thought. */
export function truncateAtSentence(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const cut = Math.max(
    slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "),
    slice.lastIndexOf(".”"), slice.lastIndexOf("־"),
  );
  if (cut > max * 0.5) return slice.slice(0, cut + 1).trim();
  const sp = slice.lastIndexOf(" ");
  return (sp > max * 0.5 ? slice.slice(0, sp) : slice).trim() + "…";
}

export function hashId(url: string): string {
  return createHash("sha1").update(canonicalUrl(url)).digest("hex").slice(0, 16);
}

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Loose fingerprint for catching the same story across outlets. */
export function titleFingerprint(title: string): string {
  const norm = title
    .replace(/["'“”‘’׳״]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const words = norm.split(" ").filter((w) => w.length > 2).sort().slice(0, 6);
  return words.join("-");
}
