# unbored — plan (free version)

> **Status (2026-11-23): Phases 1–3 are built.** The pipeline runs, the PWA
> works, and the nightly workflow is in place. What's left is deploying it and
> living with it for a week. `README.md` documents what actually exists; this
> file is the reasoning behind it.
>
> Changes from the original plan, all discovered by testing real feeds:
> - Deck is **50/day** (35 fresh + 15 timeless), not 20
> - **Calcalist** 403s, **Davidson** is mid-migration, **Hacker News** and
>   **Ars Technica** ship no real excerpt — all dropped
> - WordPress `wp-json` beat RSS for the three main Hebrew sources, and gave a
>   **1,773-item archive spanning 1996–2026**
> - Book cards are hand-written in `scripts/books.ts` (15 cards, 3 books)

A single-screen Hebrew reading app to open instead of Instagram/Facebook.
One card at a time, swipe up for next. ~50 cards a day, then you close it.
No feed, no likes, no counters, no infinite scroll.

Target device: Samsung S24+ (Android Chrome, installed as a PWA).

**Total running cost: $0.** No LLM API, no server, no database, no app store.

---

## What changed vs. the paid version

The paid plan ran every item through Claude to summarize it into Hebrew and
score how interesting it was (~$16/mo). The free version drops that and leans
on two things instead:

1. **Hebrew RSS feeds already ship a summary.** Most Israeli publishers put a
   1–2 sentence `<description>` in the feed. That *is* the card text.
2. **Source curation replaces the interest filter.** Instead of asking a model
   "is this interesting?", only subscribe to feeds where the answer is usually
   yes, then apply cheap mechanical rules.

### The honest tradeoff

| | Paid | Free |
|---|---|---|
| Hebrew summaries | Written to a consistent 60–100 word voice | Whatever the publisher wrote (varies; some are clickbaity) |
| English sources | Translated into Hebrew | Stay in English, or dropped |
| Interest filter | Model scores each item | Keyword rules + source choice |
| Book summaries | Generated per book | Hand-written seed set (see Phase 4) |

Good enough to find out whether the *idea* works. The LLM layer stays
available as a later upgrade if the raw excerpts read badly.

---

## Phase 1 — Pipeline, no UI

Build the content pipeline and read the output as raw JSON. Do not build any UI
until the content is good — that's the whole gate.

```
unbored/
  sources.json          # feed list, hand-editable
  scripts/fetch.ts      # feeds -> raw candidates
  scripts/build.ts      # clean, filter, dedupe, cap ~20 -> public/feed.json
  state/seen.json       # url hashes already served
```

Node 26 runs `.ts` natively — no build step, no tsconfig, no bundler.
One dependency: `fast-xml-parser`. That's it.

### Sources to start with

The fetcher validates each feed on first run and logs the dead ones, so this
list gets pruned immediately — treat it as candidates, not facts.

- **Hebrew science/knowledge:** הידען, דוידסון אונליין (מכון ויצמן), זווית
- **Hebrew tech/startups:** Geektime, Calcalist tech, TheMarker tech
- **Hebrew general science desk:** Ynet science
- **Facts:** Hebrew Wikipedia API (featured article / הידעת) — free, no key
- **English (optional, stays English):** Quanta, Hacker News top via the
  Algolia API, Works in Progress

### The filter (all mechanical, no model)

- **Deny list** — drop sports, celebrity, crime, traffic, politics, weather,
  horoscopes, anything matching a junk-title pattern
- **Substance floor** — require an excerpt over ~180 characters; a feed item
  with a 30-character teaser is a headline, not a card
- **Round-robin by source** — so one chatty feed can't take over the deck
- **Dedupe** — url hash against `state/seen.json`, plus fuzzy title match to
  catch the same story from three outlets
- **Recency window** — nothing older than ~10 days, except Wikipedia facts

### Excerpt cleanup (plain string work)

Strip HTML tags, decode entities, cut trailing `קרא עוד` / `לכל הכתבות`,
truncate at the last full sentence under ~300 chars.

**Gate: run it, read 40 cards, decide if it's interesting.** If not, fix the
source list and the deny list. Not the UI.

---

## Phase 2 — The app

`public/index.html` — one file, no framework, no build.

- RTL Hebrew, dark by default
- One full-screen card at a time; swipe up = next
- Card: title, excerpt, source name, tag chip, link out to the original
- `localStorage` remembers what you've seen, so nothing repeats
- `manifest.json` + `sw.js` for install + offline

Offline matters more than it sounds: the service worker caches the day's deck,
so it opens instantly with no spinner. It has to feel faster than Instagram or
your thumb won't pick it.

---

## Phase 3 — Deploy (free)

- **Cloudflare Pages** serves `public/`. Free tier: unlimited bandwidth,
  500 builds/month. A nightly build uses ~30.
- **GitHub Actions** cron runs the pipeline nightly and commits the updated
  `feed.json` + `seen.json`, which auto-triggers the redeploy. Free tier:
  unlimited minutes on a public repo, 2000/month on a private one. A nightly
  2-minute job uses ~60.
- **Install on the S24+:** open the URL in Chrome -> menu -> "Install app".
  Chrome builds a WebAPK: real icon in the app drawer, own window, no address
  bar, own entry in recents. Indistinguishable from a native app.

Then put it in the dock slot where Instagram currently lives, and move
Instagram and Facebook to the last page of the app drawer. Pair with Digital
Wellbeing app timers on both. The muscle memory is the actual opponent here,
not the content.

---

## Phase 4 — Books, and two optional experiments

**Books (free):** no API means no generated summaries, so the seed set gets
hand-written instead — a `books.json` of cards, one key idea per card, 5 cards
per book. Slower to grow, costs nothing, and the quality is actually higher
than generated. Mixed into the deck so some days you get a chunk of a book
instead of news.

**Experiment A — on-device translation.** Chrome ships built-in on-device AI
APIs (`Translator`, `Summarizer`) that run locally and cost nothing. If they're
available on your S24+, English sources can be rendered in Hebrew for free.
Android support has been rolling out and may not be there yet, so this is worth
testing on the real device rather than planning around. Fallback is simply
showing the English text.

**Experiment B — add the LLM back, selectively.** If some feeds have great
articles but terrible excerpts, run only those through Claude rather than the
whole deck. A fraction of the items means a fraction of the ~$16/mo.

---

## Effort

- Phase 1: a few hours
- Phases 2–3: another few
- Phase 4: ongoing taste work, not code

Nothing in Phases 1–3 is blocked on anything — no API key, no account, no
payment method.
