/**
 * Compose the deck and write public/feed.json.
 *
 * Two pools:
 *   flow  = published recently (news, new articles)
 *   stock = timeless (Wikipedia entries, archive articles, book cards)
 *
 * The deck reserves deck.minStock slots for stock, so it is never 100% news
 * and stays full on quiet days. Within each pool, sources are taken
 * round-robin so no single feed dominates.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { titleFingerprint } from "./lib/clean.ts";
import { reject, score, type Candidate } from "./lib/filter.ts";
import { deck } from "./lib/config.ts";

const u = (p: string) => new URL(p, import.meta.url);
const readJson = <T,>(p: string, fallback: T): T =>
  existsSync(u(p)) ? JSON.parse(readFileSync(u(p), "utf8")) as T : fallback;

const candidates = readJson<{ items: Candidate[] }>("../state/candidates.json", { items: [] }).items;
const archive = readJson<{ items: Candidate[] }>("../state/archive.json", { items: [] }).items;
const books = readJson<{ items: Candidate[] }>("../books.json", { items: [] }).items;
const seen = new Set(readJson<string[]>("../state/seen.json", []));

const rejects: Record<string, number> = {};
const note = (k: string) => { rejects[k] = (rejects[k] ?? 0) + 1; };

function eligible(pool: Candidate[], maxAgeDays: number | null): Candidate[] {
  const out: Candidate[] = [];
  for (const c of pool) {
    if (seen.has(c.id)) { note("already-seen"); continue; }
    const why = reject(c, deck.minExcerptChars, maxAgeDays);
    if (why) { note(why); continue; }
    out.push({ ...c, score: score(c) });
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

const flow = eligible(candidates.filter((c) => c.kind === "flow"), deck.flowMaxAgeDays);
const stock = eligible(
  [...candidates.filter((c) => c.kind === "stock"), ...archive, ...books],
  null,
);

// Shared state so caps and dedupe hold across every take() call.
const chosen: Candidate[] = [];
const chosenIds = new Set<string>();
const perSource: Record<string, number> = {};
const fingerprints = new Set<string>();
let english = 0;

function take(pool: Candidate[], budget: number): void {
  const bySource = new Map<string, Candidate[]>();
  for (const c of pool) {
    if (!bySource.has(c.sourceId)) bySource.set(c.sourceId, []);
    bySource.get(c.sourceId)!.push(c);
  }
  let taken = 0;
  let progressed = true;
  while (progressed && taken < budget && chosen.length < deck.size) {
    progressed = false;
    for (const [sid, items] of bySource) {
      if (taken >= budget || chosen.length >= deck.size) break;
      if ((perSource[sid] ?? 0) >= deck.maxPerSource) continue;
      const next = items.shift();
      if (!next) continue;
      progressed = true;
      if (chosenIds.has(next.id)) continue; // already taken in an earlier pass
      if (next.lang === "en" && english >= deck.maxEnglish) continue;
      const fp = titleFingerprint(next.title);
      if (fp && fingerprints.has(fp)) { note("duplicate-story"); continue; }
      fingerprints.add(fp);
      perSource[sid] = (perSource[sid] ?? 0) + 1;
      if (next.lang === "en") english++;
      chosen.push(next);
      chosenIds.add(next.id);
      taken++;
    }
  }
}

// Flow gets the deck minus the reserved stock slots; stock fills its quota;
// then whichever pool still has material tops the deck up to size.
take(flow, Math.max(0, deck.size - deck.minStock));
take(stock, deck.size - chosen.length);
take(flow, deck.size - chosen.length);

// Interleave kinds so news and timeless cards alternate rather than arriving in blocks.
const flowCards = chosen.filter((c) => c.kind === "flow");
const stockCards = chosen.filter((c) => c.kind === "stock");
const ordered: Candidate[] = [];
const ratio = stockCards.length ? Math.max(1, Math.round(flowCards.length / stockCards.length)) : Infinity;
let fi = 0, si = 0;
while (fi < flowCards.length || si < stockCards.length) {
  for (let k = 0; k < ratio && fi < flowCards.length; k++) ordered.push(flowCards[fi++]);
  if (si < stockCards.length) ordered.push(stockCards[si++]);
}

const feed = {
  generated: new Date().toISOString(),
  count: ordered.length,
  items: ordered.map((c) => ({
    id: c.id, title: c.title, text: c.text, url: c.url,
    source: c.source, tag: c.tag, lang: c.lang, date: c.date, kind: c.kind,
  })),
};

mkdirSync(u("../public/"), { recursive: true });
writeFileSync(u("../public/feed.json"), JSON.stringify(feed, null, 1));

// Keep every deck, so past days stay readable in the app's archive.
const dayKey = feed.generated.slice(0, 10);
mkdirSync(u("../public/decks/"), { recursive: true });
writeFileSync(u(`../public/decks/${dayKey}.json`), JSON.stringify(feed, null, 1));

interface DayEntry { date: string; count: number }
const index = readJson<{ days: DayEntry[] }>("../public/decks/index.json", { days: [] });
const days = index.days.filter((d) => d.date !== dayKey);
days.unshift({ date: dayKey, count: feed.count });
days.sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(
  u("../public/decks/index.json"),
  JSON.stringify({ updated: feed.generated, days: days.slice(0, 180) }, null, 1),
);

const served = [...ordered.map((c) => c.id), ...seen].slice(0, deck.seenHistoryCap);
writeFileSync(u("../state/seen.json"), JSON.stringify(served, null, 0));

console.log(`deck: ${ordered.length}/${deck.size}  (flow ${flowCards.length}, stock ${stockCards.length})  archived as ${dayKey}`);
console.log(`pools: ${flow.length} flow eligible, ${stock.length} stock eligible`);
console.log("by source:", Object.entries(
  ordered.reduce<Record<string, number>>((a, c) => { a[c.source] = (a[c.source] ?? 0) + 1; return a; }, {}),
).map(([k, v]) => `${k}=${v}`).join("  "));
console.log("rejected:", Object.entries(rejects).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ") || "none");
if (ordered.length < deck.size * 0.6) console.warn(`\n! deck is thin (${ordered.length}). Run: node scripts/archive.ts`);
if (stockCards.length < deck.minStock) console.warn(`! stock short (${stockCards.length}/${deck.minStock}). Run: node scripts/archive.ts`);
