/** Pull today's items from every source into state/candidates.json. */
import { writeFileSync, mkdirSync } from "node:fs";
import { fetchSource } from "./lib/adapters.ts";
import { sources, deck } from "./lib/config.ts";
import type { Candidate } from "./lib/filter.ts";

const results = await Promise.allSettled(
  sources.map(async (s) => ({ s, items: await fetchSource(s, deck.maxExcerptChars) })),
);

const all: Candidate[] = [];
let failed = 0;
for (const r of results) {
  if (r.status === "fulfilled") {
    all.push(...r.value.items);
    console.log(`  ok    ${r.value.s.id.padEnd(14)} ${String(r.value.items.length).padStart(3)} items`);
  } else {
    failed++;
    console.log(`  FAIL  ${String(r.reason).slice(0, 120)}`);
  }
}

mkdirSync(new URL("../state/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../state/candidates.json", import.meta.url),
  JSON.stringify({ fetchedAt: new Date().toISOString(), items: all }, null, 0),
);
console.log(`\nfetched ${all.length} candidates from ${sources.length - failed}/${sources.length} sources`);
if (failed === sources.length) process.exit(1);
