# Yearn Wrapped design

A seasonal wallet story for Yearn users: a quiet landing poster, a bright 3D Yearn symbol, then a deck built around specific facts. Keep entry simple, copy short and financial meaning precise. [BUILD.md](BUILD.md) defines data, startup timing and verification; this file defines the visual and interaction constraints.

## Typography and brand

- Use the shipped Yearn fonts: Aeonik Regular/Bold for display and body, Aeonik Mono Regular/Bold for data, labels and addresses. System fonts are a bounded startup/failure fallback, not a new brand choice.
- Typography is fluid, not one fixed size scale. Current main headlines use `clamp(46px, …, 104px)`, supporting slide statements 19–27px, and ordinary supporting copy about 14–21px. Labels/chart ticks are smaller (roughly 10–13px); do not put essential explanations in microcopy.
- Reserve uppercase and wide tracking for short mono topic/data labels. Headlines use tight tracking, usually −0.02em to −0.03em; body copy remains sentence case. Protect descenders and wrapping at narrow widths.
- Headers and PNGs use the same `site/assets/yearn-wrapped-lockup.svg`, never separately sized symbols or live wordmarks. It preserves the official Yearn symbol/wordmark paths and spacing. “wrapped” uses Aeonik Bold with matched lowercase height and baseline; this weight is a product choice, not a Yearn brand requirement. Site height is 24px; export height is 32px. Rebuild with `tools/build_brand.py` and the official SVG.
- The hero and loader extrude `yearn-symbol-contour.json`, reconstructed from the official symbol PNG. Keep the dense circular contour and verify its silhouette with `tools/verify_symbol_contour.py`; shading cannot repair incorrect geometry.

## Color and surfaces

| Role | Current tokens |
| --- | --- |
| Base / primary text | `#0a0a0a` / `#fafafa` |
| Secondary / muted text | `#a0a0a0` / `#8b93a1` |
| Yearn action blue / soft blue | `#0657e9` / `#3b82f6` |
| Teal / purple | `#2dd4bf` / `#a855f7` |
| Positive / negative / warning | Green / `#f87171` / `#fbbf24`, with component-specific green shades |
| Hairlines | White at 0.06, 0.10 or 0.15 opacity |

Use hierarchy, size and spacing before reducing text opacity. Contrast must hold against the actual composited background: ordinary text ≥4.5:1, large text ≥3:1. Flat-token ratios are not proof over an animated scene; gradient text needs visual review as well as automated checks. Meaning cannot depend on color alone.

Keep surfaces restrained and the active slide borderless. The landing entry panel is a deliberate exception: an 18px radius, subtle tint, hairline, depth shadow and pointer highlight group the wallet controls. The sparkline panel uses a 14px radius, tint and hairline without a wide shadow. Inputs/main buttons use 12px radii; share icons use 6px; chips may be pills. Chart bars, stamps and utility controls have their own smaller radii. Do not impose an inaccurate universal radius scale.

Glow has specific jobs: the main action's blue shadow, hero metal highlights/bloom, atmospheric depth and the deck's subdued scene wash. The status dot has a static teal shadow. Do not add floating decorative glows, pulsing status indicators, a circular launch burst or a second scene flare.

Display gradients are intentional: the landing headline uses a subtle blue shimmer; deck hero figures fade from primary text into the card's scene color. Keep them off small/body text. Chart gradients and direction colors come from the shared chart logic, not a separately invented export palette.

No decorative grids, accent side-stripes, icon tiles above headings, nested dashboard-card stacks, generic blob art, glass walls, cream/beige theme or neon/purple-to-blue backdrop. The Yearn symbol is the illustration; data earns the remaining graphics.

## Composition and reading

The landing is one viewport with headline, short supporting copy and wallet/address entry. No tutorial sections, scroll narrative, extra eyebrow or decorative section numbering. Keep the symbol away from the copy, especially in portrait: it becomes a smaller emblem above the text rather than a large object behind it.

The deck has separate header, slide and action-footer rows. Short cards center; dense cards scroll within the available area. Never cover content with controls. The active card rests straight. Center title and sticker on independent, adjacent rows so a sticker cannot displace the title. Stats share centered column axes and value/label tracks; comparative list rows may retain left/right columns. Holding windows use MM/DD–MM/DD alongside the other stats.

Each card needs one clear subject and a dominant fact or graphic. Charts, monthly activity and hourly bars use payload values. When context is unavailable, show an honest non-monetary state or omit the card. The final card is a useful recap: eligible estimated yield, otherwise longest hold or vault count, supporting counts and period context.

## Motion and atmosphere

- Present a complete landing frame. The scene, UI and fonts resolve within the budgets in BUILD.md; once a static fallback is visible, do not replace it with late 3D. No staged text entrance while the background is already showing.
- `site/motion.js` shares one loop for DOM pointer springs; hero, background and loader rendering have separate loops. Current magnetic controls move at most 3px within a 56px reach. The entry panel tilts at most ±1° with 4px lift. Fine-pointer/hover input only; touch and reduced motion get neither.
- Only the symbol and its glint respond to the cursor. Keep the camera, full canvas, particle field and aurora anchored. Their ambient drift may continue independently. Gentle symbol oscillation replaces full spins.
- The landing layers aurora, particles, extruded symbol/bloom and DOM UI, with a vignette protecting the copy. No orbit rings. Current landing particle opacity is 0.38 and aurora intensity is 0.36 desktop/0.28 portrait. Portrait symbol placement uses scale 0.3, y 1.62, z −1.2. Judge legibility on rendered devices, not these numbers alone.
- Landing particles use soft radial sprites. Replay uses tiny dim canvas points and a scene wash; neither background may compete with the numbers. Avoid introducing conspicuous square/confetti particles.
- The hero composer uses a multisampled half-float target with four samples to retain silhouette antialiasing through bloom.
- Landing flight and replay arrival share one subdued linear atmosphere. Cover before navigation; release promptly over the atmospheric loader or a cached recap. Prepare the loader renderer after the cover fade to avoid a GPU hitch. No detached glow, second zoom or black loading panel.
- The loading slot holds a Yearn mark until the real 3D bounce is ready. Do not restore the old spinner. Keep rendering during a visible fade, then dispose, including cancelled late resources. This loading bounce is intentional; controls do not bounce for decoration.
- Slide swaps may settle with a short vertical/scale/blur transition and restrained internal staggering; readable cards stay level. Animation must not change metric meaning or chart scale. Exports use final values immediately.
- Reduced motion disables continuous graphics, shimmer, traveling/blurred transitions, count-ups, magnetic pull and tilt. Still frames and short opacity fades remain. Use Three.js/GLSL and the existing springs; do not add a motion library for effects already covered here.

## Actions and sharing

Copy/save/post are compact 44px square icon buttons with a hairline and 6px radius, no tinted tile, shadow or permanent text row. SVG icons, hover titles and accessible names identify the actions; a check and live announcement confirm success. Keep class names neutral so social-button filters do not hide the controls.

Disable every export/share action on the identity card, including synthetic-click handlers. Other cards omit raw addresses and wallet query parameters from exported images/captions; the underlying financial facts can still identify a wallet. Preserve keyboard navigation, focus rings, horizontal swipe and vertical content scrolling without accidental slide changes.

PNG exports must retain the matching logo, scene and semantic colors, typography, independently centered title/sticker, complete supporting stats and material qualifiers. Monthly/hourly graphics read raw data, not current animation heights. Slide and image charts share scales; disclose square-root or independent scales wherever applicable. The ETH export deliberately reduces density to its headline, chart and two facts. The final export summarizes the recap rather than displaying a generic goodbye.

## Copy

- Prefer numbers, dates and vault labels to claims. One idea per sentence; keep secondary copy short enough to scan. No tutorial-like explanation blocks.
- Keep definitions in BUILD.md/payload fields; retain brief “estimated”, incomplete-coverage and partial-year qualifiers where they change the meaning.
- Quips may be playful and affectionate when supported by facts. Never turn missing data into a loss, incident or zero, or claim population percentiles from active-wallet medians.
- No “supercharge”, “world-class”, “next-gen”, “seamless”, slogan-contrast pairs or user-facing em dashes. Avoid repeating the same helper sentence across visible labels and placeholders; accessible names must still identify controls.

## Review bar

For visual changes, use the browser checks described in BUILD.md and inspect their saved screenshots/PNG pairs. `tests/a11y-check.cjs` checks text contrast/reflow across viewports; it reports gradient text separately and cannot certify every animated frame. Review it visually. Do not depend on private notes or an old audit's “passed” claim.

Primary actions should be at least 44px; other targets retain at least a 24px floor. Require visible keyboard focus, reachable cards, no horizontal overflow at 320 CSS px, legible text at zoom and no continuous motion under reduced motion. Verify desktop/mobile, dense and sparse recaps, failure states and export parity. Save repeatable evidence in ignored `data/verification/`.

References: [Yearn official lockup](https://presskit.yearn.fi/index/logo_black_background.svg), [WCAG contrast](https://www.w3.org/TR/WCAG22/#contrast-minimum), [reflow](https://www.w3.org/TR/WCAG22/#reflow), [keyboard](https://www.w3.org/TR/WCAG22/#keyboard), [target size](https://www.w3.org/TR/WCAG22/#target-size-minimum) and [reduced motion](https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion). These are review criteria, not a claim of complete standards conformance.
