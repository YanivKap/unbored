# unbored

A quiet Hebrew reading deck to open instead of Instagram and Facebook.
One card at a time, ~50 a day, and then it **ends**.

No feed, no likes, no counters, no infinite scroll, no algorithm.
No LLM API, no server, no database. **Running cost: $0.**

**→ https://yanivkap.github.io/unbored/**

![50 cards a day](https://img.shields.io/badge/deck-50%20cards%2Fday-6fa8ff) ![cost](https://img.shields.io/badge/cost-%240-brightgreen)

---

## How it works

A nightly GitHub Action pulls from curated Hebrew sources, filters them with
mechanical rules, composes a 50-card deck, and commits `public/feed.json`.
A single-file PWA reads that JSON and shows one card at a time.

```
sources ──► fetch.ts ──► build.ts ──► public/feed.json ──► index.html (PWA)
                            ▲
                     archive.json + books.json
```

### Two pools

| Pool | What it is | Where it comes from |
|---|---|---|
| **flow** | published recently | today's RSS / WordPress feeds |
| **stock** | timeless | 30 years of archive, Wikipedia featured articles, book cards |

The deck reserves **15 stock slots**, so it is never 100% news and stays full
on Shabbat, holidays and slow news weeks.

### Why there's no AI in it

The paid design ran every item through an LLM to write a Hebrew summary and
score how interesting it was — about $16/month. It turned out to be
unnecessary: most Hebrew publishers already ship a real 150–450 character
summary in their feed, and *source curation* does the interest filtering that a
model would otherwise do.

The tradeoff is honest: excerpts are in the publisher's voice rather than one
consistent voice, and English sources stay in English. See `PLAN.md`.

---

## Sources

| Source | Type | Topic | Archive |
|---|---|---|---|
| הידען | WordPress API | science | 28,156 posts |
| גיקטיים | WordPress API | tech / startups | 41,866 posts |
| זווית | WordPress API | environment | 2,504 posts |
| ynet מדע | RSS | science | — |
| ynet דיגיטל | RSS | tech | — |
| ויקיפדיה | API | featured + good articles | curated set |
| ספרים | hand-written | one idea per card | `scripts/books.ts` |
| Quanta | RSS | science (English) | — |

Rejected during testing, and why: **Calcalist** (403s all feed requests),
**Davidson** (site mid-migration, 2 posts), **Hacker News** and **Ars Technica**
(RSS carries no real excerpt — just `Article URL: …` or a one-line teaser),
**TheMarker** and **ynet-5363** (market noise / shopping).

## The filter

No model. Four mechanical rules, in `scripts/lib/filter.ts`:

1. **Deny list** — sport, celebrity, crime, politics, traffic, shopping, promos.
   Matched on *word boundaries with Hebrew prefix support*, so `גשם` can't fire
   inside `יערות הגשם` but `בלאק פריידי` still catches `לבלאק פריידי`.
2. **Substance floor** — the excerpt must exceed 150 characters. A 30-character
   teaser is a headline, not a card.
3. **Dedupe** — canonical-URL hash against `state/seen.json`, plus a title
   fingerprint to catch the same story from three outlets.
4. **Round-robin by source**, capped at 12 per source, so no feed dominates.

`score()` only *orders* the deck; it never drops anything.

---

## Commands

```bash
node scripts/fetch.ts        # pull today's items  -> state/candidates.json
node scripts/build.ts        # compose the deck    -> public/feed.json
node scripts/archive.ts 6000 # top up the timeless archive
node scripts/books.ts        # regenerate book cards from the source list
node scripts/icons.ts        # regenerate PWA icons
node scripts/serve.ts        # preview at http://localhost:4173
```

Zero dependencies. Node 22+ runs the TypeScript directly — no build step, no
bundler, no `node_modules`.

## Tuning it

Everything lives in `sources.json`:

```jsonc
"deck": {
  "size": 50,            // cards per day
  "minStock": 15,        // reserved timeless slots
  "maxPerSource": 12,
  "maxEnglish": 5,
  "minExcerptChars": 150,
  "flowMaxAgeDays": 10
}
```

To add a source, add an entry with `type: "wp"` (any WordPress site — check
`/wp-json/wp/v2/posts` works) or `type: "rss"`. To add a book, edit
`scripts/books.ts` and re-run it.

If the deck feels wrong, tune the deny list and the source list first. That is
where almost all the quality lives.

---

## Install on Android

1. Open the deployed URL in Chrome
2. Menu → **Install app**
3. Chrome builds a WebAPK — real icon in the app drawer, own window, no address
   bar, own entry in recents

Then put it in the dock slot where Instagram used to be, and move Instagram and
Facebook to the last page of the app drawer. The muscle memory is the real
opponent, not the content.

## Hosting

GitHub Pages serves the `gh-pages` branch at
<https://yanivkap.github.io/unbored/>. Three workflows keep it running, all on
the free tier:

| Workflow | When | What |
|---|---|---|
| `daily.yml` | 03:00 UTC nightly | fetch + build, commits `public/feed.json` |
| `pages.yml` | on push to `public/**` | publishes `public/` to `gh-pages` |
| `archive.yml` | 1st of the month | tops the timeless archive up |

So the nightly deck commit triggers the deploy on its own, and nothing needs
touching.
