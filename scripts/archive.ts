/**
 * Deep-crawl the evergreen WordPress sources into state/archive.json.
 * Run once, then monthly. These articles don't expire, so they backfill
 * the deck on quiet days (Shabbat, holidays, slow news weeks).
 *
 *   node scripts/archive.ts            # top up to the default target
 *   node scripts/archive.ts 6000       # aim for 6000 stored items
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fromWp } from "./lib/adapters.ts";
import { sources, deck } from "./lib/config.ts";
import { reject, type Candidate } from "./lib/filter.ts";

const TARGET = Number(process.argv[2] ?? 4000);
const PER_PAGE = 100;
const u = (p: string) => new URL(p, import.meta.url);

const existing: Candidate[] =
  existsSync(u("../state/archive.json"))
    ? JSON.parse(readFileSync(u("../state/archive.json"), "utf8")).items ?? []
    : [];
const have = new Map(existing.map((c) => [c.id, c]));
console.log(`archive has ${have.size} items, target ${TARGET}`);

const pool = sources.filter((s) => s.archive && s.type === "wp");
const share = Math.ceil((TARGET - have.size) / Math.max(pool.length, 1));

for (const s of pool) {
  if (share <= 0) break;
  const maxPage = Math.max(1, Math.floor((s.archivePosts ?? 2000) / PER_PAGE));
  // Spread sampling across the whole archive so we get many years, not one month.
  const pages: number[] = [];
  const step = Math.max(1, Math.floor(maxPage / Math.ceil(share / PER_PAGE)));
  for (let p = 1; p <= maxPage && pages.length * PER_PAGE < share * 1.6; p += step) pages.push(p);

  let added = 0, failed = 0;
  for (const page of pages) {
    try {
      const items = await fromWp(s, deck.maxExcerptChars, { page, perPage: PER_PAGE });
      for (const c of items) {
        if (have.has(c.id)) continue;
        if (reject(c, deck.minExcerptChars, null)) continue;
        have.set(c.id, { ...c, kind: "stock" });
        added++;
      }
    } catch (err) {
      failed++;
      if (failed > 4) { console.log(`  ${s.id}: stopping after repeated failures`); break; }
    }
    await new Promise((r) => setTimeout(r, 250)); // be polite
  }
  console.log(`  ${s.id.padEnd(12)} +${added} (sampled ${pages.length} pages of ~${maxPage})`);
}

mkdirSync(u("../state/"), { recursive: true });
const items = [...have.values()];
writeFileSync(u("../state/archive.json"), JSON.stringify({ updated: new Date().toISOString(), items }, null, 0));
const years = new Set(items.map((c) => c.date.slice(0, 4)));
console.log(`\narchive: ${items.length} items spanning ${[...years].sort()[0]}–${[...years].sort().at(-1)}`);
