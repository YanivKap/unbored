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
 *
 * A day's deck is composed ONCE and then frozen: re-running this script reuses
 * the deck already stored for today rather than reshuffling it, so cards can
 * never disappear from under someone who is still reading them. Pass --force
 * to deliberately recompose today.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { titleFingerprint } from "./lib/clean.ts";
import { reject, score, type Candidate } from "./lib/filter.ts";
import { deck } from "./lib/config.ts";

const u = (p: string) => new URL(p, import.meta.url);
const readJson = <T,>(p: string, fallback: T): T =>
  existsSync(u(p)) ? JSON.parse(readFileSync(u(p), "utf8")) as T : fallback;

interface Feed {
  generated: string;
  count: number;
  items: Array<Record<string, unknown>>;
}

const force = process.argv.includes("--force");
const today = new Date().toISOString().slice(0, 10);
const todayPath = `../public/decks/${today}.json`;

const archive = readJson<{ items: Candidate[] }>("../state/archive.json", { items: [] }).items;
const books = readJson<{ items: Candidate[] }>("../books.json", { items: [] }).items;

let feed: Feed;

if (!force && existsSync(u(todayPath))) {
  feed = JSON.parse(readFileSync(u(todayPath), "utf8")) as Feed;
  console.log(`deck: reusing today's ${feed.count} cards (pass --force to recompose)`);
} else {
  const candidates = readJson<{ items: Candidate[] }>("../state/candidates.json", { items: [] }).items;
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
      for (const [sid, queue] of bySource) {
        if (taken >= budget || chosen.length >= deck.size) break;
        if ((perSource[sid] ?? 0) >= deck.maxPerSource) continue;
        const next = queue.shift();
        if (!next) continue;
        progressed = true;
        if (chosenIds.has(next.id)) continue;
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

  feed = {
    generated: new Date().toISOString(),
    count: ordered.length,
    items: ordered.map((c) => ({
      id: c.id, title: c.title, text: c.text, url: c.url,
      source: c.source, tag: c.tag, lang: c.lang, date: c.date, kind: c.kind,
    })),
  };

  const served = [...ordered.map((c) => c.id), ...seen].slice(0, deck.seenHistoryCap);
  writeFileSync(u("../state/seen.json"), JSON.stringify(served, null, 0));

  console.log(`deck: ${ordered.length}/${deck.size}  (flow ${flowCards.length}, stock ${stockCards.length})`);
  console.log(`pools: ${flow.length} flow eligible, ${stock.length} stock eligible`);
  console.log("by source:", Object.entries(
    ordered.reduce<Record<string, number>>((a, c) => { a[c.source] = (a[c.source] ?? 0) + 1; return a; }, {}),
  ).map(([k, v]) => `${k}=${v}`).join("  "));
  console.log("rejected:", Object.entries(rejects).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ") || "none");
  if (ordered.length < deck.size * 0.6) console.warn(`\n! deck is thin (${ordered.length}). Run: node scripts/archive.ts`);
  if (stockCards.length < deck.minStock) console.warn(`! stock short (${stockCards.length}/${deck.minStock}). Run: node scripts/archive.ts`);
}

mkdirSync(u("../public/"), { recursive: true });
mkdirSync(u("../public/decks/"), { recursive: true });
writeFileSync(u("../public/feed.json"), JSON.stringify(feed, null, 1));

const dayKey = feed.generated.slice(0, 10);
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

/**
 * Search index.
 *
 * This covers the whole library, not only the cards that happened to be dealt:
 * every archived deck, plus the full timeless archive and every book card. An
 * article that was fetched but never made it into a deck is still findable —
 * otherwise "I saw something about black holes" has no answer.
 */
const keepDays = new Set(days.slice(0, 180).map((d) => d.date));
const searchItems: Array<Record<string, unknown>> = [];
const seenIds = new Set<string>();

function addToIndex(it: Record<string, unknown>, day?: string) {
  const id = it.id as string;
  if (!id || seenIds.has(id)) return;
  seenIds.add(id);
  searchItems.push({
    id, title: it.title, text: it.text, url: it.url,
    source: it.source, tag: it.tag, lang: it.lang, date: it.date,
    ...(day ? { day } : {}),
  });
}

// Dealt decks first, so a card that was actually served carries its day.
for (const file of readdirSync(u("../public/decks/")).sort().reverse()) {
  if (!file.endsWith(".json") || file === "index.json") continue;
  const day = file.replace(/\.json$/, "");
  if (!keepDays.has(day)) continue;
  try {
    const d = JSON.parse(readFileSync(u(`../public/decks/${file}`), "utf8"));
    for (const it of d.items ?? []) addToIndex(it, day);
  } catch { /* skip an unreadable deck rather than failing the build */ }
}
// Then everything else that exists, dealt or not.
for (const it of [...books, ...archive]) addToIndex(it as unknown as Record<string, unknown>);

writeFileSync(
  u("../public/search.json"),
  JSON.stringify({ updated: feed.generated, count: searchItems.length, items: searchItems }),
);
const kb = Math.round(JSON.stringify(searchItems).length / 1024);
console.log(`search index: ${searchItems.length} items (${keepDays.size} dealt day(s) + full archive), ${kb} KB`);
