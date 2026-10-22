# REFERENCES.md — year-end recap campaigns worth stealing from

A reference shelf, not a spec. Keep the seasonal scope: borrow mobile shareability
and screen-to-screen variety without building permanent infrastructure for each
campaign idea. Current product rules live in DESIGN.md and BUILD.md.

One structural difference to keep in mind while reading: Wrapped-style campaigns
are mobile vertical stories (9:16, thumb-tap advance, one screen alive at a time).
Our deck is a desktop-first slideshow with keyboard/tap/swipe. Everything below
translates except the frame shape.

## Spotify Wrapped (2016–2024, the genre-definer)

Structure each year: identity opener → top artists (5 screens) → top songs → top
genres → minutes/percentile vs other listeners → one special "personality" screen
→ outro CTA (playlist + share). One fact per screen, one hero number, one motion
idea per screen.

What changed year to year (the variety mechanism):
- 2019: bold gradient story cards, "your top song played 89 times" — specificity
  as flex. Billboards amplified the same cards offline.
- 2020: one-line stat cards ("you streamed 21 hours of reggaeton"), podcast
  segment, "you're in the top 1% of X fans" — percentile framing arrives.
- 2021: Wrapped Blend (two friends' data merged), top-10 with podium visuals.
- 2022: **Listening Personality** — 16 archetypes shown on a two-axis chart
  (familiar/exploratory × loyalty/discovery), plus **Audio Aura**: a colour field
  generated from your stats, animated behind every card. The verdict screen people
  screenshot.
- 2023: **Sound Town** — a map card matching you to a city by listening pattern;
  global-trend tie-ins ("this city's top genre").
- 2024: **Music Evolution** — up to three "phases" of your year with named
  descriptors per phase; AI podcast narration as an option.
- Interaction constants: tap to advance, per-card share image, autoplay in stories
  format, rewatchable, "your year in 60 seconds" energy. Cards feel different
  because background treatment, type scale, and motion choreography change while
  the brand frame stays fixed.

Steal-worthiest: the verdict/personality screen (we have stamps but not a
*taxonomy*); percentile framing; the phases/evolution screen; the aura (a stat-
derived colour field per card — our scene system is a fixed-palette version).

## Apple Music Replay '24 and Apple Podcasts year-end

Apple's 2024 Replay evolved "from a stats page into a deeply personal, shareable
celebration" (Instrument case study): a stories reel of personal highlight stats,
each shareable as a motion video or still, plus year-end charts. Apple Podcasts
does annual listening cards in the same family. Design language: restrained, one
accent per card, huge SF numerals, no gradients-for-noise — motion does the
explanation. Interaction: every card is independently shareable (not just the
outro), which our POST button already is; the lesson is per-card export parity.

## Duolingo Year in Review

The closest voice analog to ours. Structure: streak celebration → total stats →
month-by-month with quips ("you missed 3 days but came back — love that for you")
→ "top time of day" → a verdict card → share cards built for Instagram stories.
Lessons: the quip is *specific to the number* (never generic), teasing is
affectionate not scolding, and the streak is treated as an identity trait. They
report a measurable lift in lessons completed after people flow through the recap —
a recap that changes behaviour, not just reports it.

## Strava Year in Sport

The data-dense end of the spectrum. Stories format but denser slides: totals,
"top 5 activities", effort comparisons, and percentile/leaderboard framing
("faster than N% of runners your age") — plus a separate *global* Trend Report
with population-level facts. Lessons: two-audience layering (personal deck +
global trend facts as context lines); density is fine if every slide still has
one hero element; their slides are also individually shareable images.

## Steam Year in Review / Replay

Stats: top games by playtime, % of playtime on this year's releases, rarest
achievement, longest play streak, and — the good bit — **median comparisons**
("median games played: 4; you played 23"). Percentile-adjacent framing without
needing a full leaderboard. Shareable profile showcases. Lesson: a median line
makes any personal number feel meaningful with zero extra infrastructure.

## PlayStation Wrap-Up

Hours played, first-played dates, trophies per game, one shareable summary image.
Lesson: the "first time you did X" retro framing (we have first activity; the
PlayStation move is *per-vault* firsts — "your first day farming yvUSDC").

## Reddit Recap / Twitch Recap

Reddit: karma earned, communities visited, comment counts, playful flat
illustration per card. Twitch: hours watched, top channels, emote usage — the
"you were here on N days" attendance framing. Lessons: illustration/character as
the variety mechanism when data is thin; attendance/streak framing lands better
than totals for habitual products.

## Banking recaps (Monzo "Year in Monzo" and similar)

Category-spend stories: "you spent £412 on coffee" with a tiny comparison to
last year, top day, month-by-month rhythm. Lesson: map totals to *recognisable
life categories* with a wink. Our analog: vault *behaviours* as categories
("yield farming", "dip buying", "vault camping").

## Grammarly "Year in Writing" and the personality-card genre

Grammarly ships an annual personal report with a "writing personality" verdict
card and per-card share images. The personality-verdict card is the most-clipped
screen across this whole genre (Wrapped's MBTI-ish, Spotify's aura, Grammarly's
traits). Verdict taxonomies are cheap to build and endlessly screenshot.

## The recurring screen archetypes (the variety menu)

1. **Hero stat** — one number, huge; the card IS the number.
2. **Specificity flex** — "played 89 times, mostly on Tuesdays" (odd, precise,
   personal). Our analog: "72-second round trip".
3. **Percentile/median** — you vs everyone, or you vs the median.
4. **Verdict/personality** — a named archetype + short description; the screenshot
   magnet.
5. **Evolution/phases** — the year split into named chapters with their own
   descriptors (our analog: phases of vault behaviour by month).
6. **Streak/attendance** — days present vs absent; commitment as identity.
7. **Map/arena** — chains, cities, arenas; geography as flavour.
8. **Aura/colour** — a stat-derived colour field; pure visual variety.
9. **First-time retro** — "your first day doing X".
10. **Global trend tie-in** — a population fact that contextualises the personal.
11. **Quiz/interaction** — one screen asks, the next answers (Wrapped 2024 used a
    shared-playlist quiz; Duolingo asks "guess your streak").
12. **Outro CTA** — playlist/next-year hook; ours is "see you at the next harvest"
    plus the share bar.

## Interaction patterns worth copying

- Tap-to-advance everywhere, with autoplay + progress bar as the second mode.
- Every card independently shareable (Apple Replay's per-card motion video is the
  ceiling; our per-card POST is close).
- Rewatchability: a "replay" affordance at the end (we have arrows; a restart
  link on the outro exists via "run another address").
- Motion language: one idea per screen — kinetic type, count-ups, wipes, a colour
  field that reacts to the stat. Never two ideas competing.
- Export parity: what people screenshot must match what they can post.

## Mapped to yearn wrapped (concrete, seasonal-sized)

- Verdict card: a "vault personality" taxonomy from payload facts we already emit
  (streak length, exits, chains, stables share) — e.g. "the camper", "the
  round-tripper", "the dip buyer". One screen, stamp-style.
- Median lines: one constant + source note on deposits/yield cards ("median
  yearn wallet held 2 vaults; you held 15") — Steam's trick, no batch job needed.
- Evolution/phases: split the year by month into 2–3 behaviour phases from data
  we already have (behaviour.rhythm + vault mix per month).
- Percentiles: deferred (needs the batch job); medians get us the same feel free.
- First-time retro per vault: first deposit day per top vault — data exists.
- Attendance framing: "you were here on 188 days" already exists; adding "absent
  days" framing is free.
- Aura: stretch goal; our scene system is the fixed-palette version.
