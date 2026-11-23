import { readFileSync } from "node:fs";
import type { Source } from "./adapters.ts";

export interface DeckConfig {
  size: number; maxPerSource: number; maxEnglish: number;
  minExcerptChars: number; maxExcerptChars: number;
  flowMaxAgeDays: number; seenHistoryCap: number;
  /** Minimum timeless cards per deck, so it is never 100% news. */
  minStock: number;
}

const raw = JSON.parse(readFileSync(new URL("../../sources.json", import.meta.url), "utf8"));
export const sources: Source[] = raw.sources;
export const deck: DeckConfig = raw.deck;
