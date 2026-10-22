// replay.js · card deck slideshow over a recap payload.

import { chartPalette, chartScale, spikeDominated } from "./charts.js";
import { validatePayload } from "./payload.js";

const APP_URL = new URL("./", location.href);

import { startDeckNebula } from "./nebula.js";
import { renderShareCard, copyBlob, downloadBlob } from "./share.js";

const PALETTE = ["#3b82f6", "#2dd4bf", "#0657e9", "#f59e0b", "#fafafa"];

const deck = document.getElementById("deck");
const dotsEl = document.getElementById("dots");
const boot = document.getElementById("boot");
const bootLine = document.getElementById("boot-line");
const bootAddr = document.getElementById("boot-addr");
const bootHint = document.getElementById("boot-hint");
const yearLabel = document.getElementById("replay-year");
const status = document.getElementById("deck-status");
const sourceLabel = document.getElementById("data-source");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The same aurora the landing paints in 3D, here as one fullscreen quad so the
// deck is not a black void. One frame under reduced motion, and it stays quiet
// enough (opacity in replay.css) never to compete with a big number.
startDeckNebula(document.getElementById("aurora"), { reduced: reducedMotion });

const params = new URLSearchParams(location.search);
const address = params.get("address");
// The landing resolves ENS before it navigates; the name travels here so the deck,
// the outro and the share image can say it instead of a truncated address.
const urlName = params.get("name");

// --- Loading state ----------------------------------------------------------

const BOOT_LINES = [
  "warming up the vaults",
  "counting your exits",
  "reading every share transfer",
  "asking the chain to behave",
  "polishing your numbers",
];

let bootTimer = null;
let bootSlowTimer = null;
let bootStageStop = null;
let bootDone = false;
let bootRevealTimer = null;

// The mark has a stable slot while real geometry arrives. Graphics readiness is
// independent of the document transition; slow devices still get the 3D loader.
function mountBootStage() {
  const canvas = document.getElementById("boot-stage");
  if (!canvas) return Promise.resolve();
  let expired = false, stage, timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => { expired = true; stage?.stop(); resolve(); }, 8000);
  });
  const ready = import("./vendor/scene/boot3d.js").then(async mod => {
    // GPU setup can block a visible CSS transition. Download concurrently, then
    // prepare the renderer after the arrival fade has completed.
    await window.wrappedHandoff?.finished;
    if (bootDone || expired) return;
    stage = mod.createBootStage(canvas);
    if (!stage.ok) return;
    bootStageStop = stage.stop;
    if (!await stage.ready || bootDone || expired) { stage.stop(); return; }
    stage.start();
    canvas.classList.add("is-3d");
    window.__bootStage = stage; // debug handle for probes
  }).catch(err => { stage?.stop(); console.warn("boot 3d unavailable", err); });
  return Promise.race([ready, deadline]).finally(() => clearTimeout(timer));
}

function hideBoot() {
  if (bootDone) return;
  bootDone = true;
  if (bootTimer) clearInterval(bootTimer);
  if (bootSlowTimer) clearTimeout(bootSlowTimer);
  clearTimeout(bootRevealTimer);
  bootTimer = null;
  bootSlowTimer = null;
  const stop = () => {
    if (bootStageStop) { bootStageStop(); bootStageStop = null; }
  };
  if (window.wrappedHandoff?.closed()) stop();
  else {
    // Keep the symbol moving until its visible fade is over.
    const timer = setTimeout(stop, 600);
    boot.addEventListener("transitionend", event => {
      if (event.target === boot && event.propertyName === "opacity") { clearTimeout(timer); stop(); }
    });
  }
  boot.classList.add("done");
  document.body.classList.remove("replay-loading");
  window.wrappedHandoff?.reveal();
}

function startBoot() {
  if (!address) return;
  // A real wallet is still loading: don't label the deck sample data yet.
  sourceLabel.textContent = "";
  bootAddr.textContent = shortAddr(address);
  // The landing's symbol, tumbling. The wait gets a body instead of a spinner.
  mountBootStage();
  // Let a cached response skip loading; otherwise reveal the stable mark and
  // atmosphere promptly, without waiting for a separate graphics download.
  bootRevealTimer = setTimeout(() => window.wrappedHandoff?.reveal(), 120);
  if (reducedMotion) return;
  let i = 0;
  bootTimer = setInterval(() => {
    i = (i + 1) % BOOT_LINES.length;
    bootLine.textContent = BOOT_LINES[i];
  }, 2400);
  // A first look at a wallet walks its whole share-transfer history, which takes
  // about a minute; afterwards the service cache answers at once. Say so once so
  // the wait reads as expected rather than stalled.
  bootSlowTimer = setTimeout(() => {
    bootHint.classList.add("show");
    bootHint.textContent = "first look at a new wallet takes about a minute. after that, it's instant.";
  }, 12000);
}

// Returns { payload } or { notFound } or { failed }. A wallet with no history
// must not silently show somebody else's year.
async function loadPayload() {
  if (address) {
    try {
      const r = await fetch(`api/recap?address=${encodeURIComponent(address)}&year=2026`);
      if (r.ok) {
        sourceLabel.textContent = "data: yearn indexer, yearn.fi, CoinGecko";
        return { payload: validatePayload(await r.json()) };
      }
      if (r.status === 404) return { notFound: true };
      return { failed: true };
    } catch {
      return { failed: true };
    }
  }
  const src = params.get("src");
  if (src && src !== "assets/sample-recap.json") return { failed: true };
  try {
    const response = await fetch("assets/sample-recap.json");
    if (!response.ok) return { failed: true };
    return { payload: validatePayload(await response.json()) };
  } catch { return { failed: true }; }
}

// --- Formatting -------------------------------------------------------------

const usdFmt = new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function fmtUsd(v) { return usdFmt.format(Number(v || 0)); }

function fmtUsdShort(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `$${Math.round(n / 1e3)}k`;
  return fmtUsd(n);
}

function fmtNum(v, dp = 2) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: dp }).format(Number(v || 0));
}

function fmtSigned(v, dp = 1) {
  const n = Number(v || 0);
  return `${n > 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

function fmtDate(ts) {
  if (!ts) return "n/a";
  return new Date(ts * 1000).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" });
}

function fmtDateShort(value) {
  if (!value) return "";
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function fmtWindowDate(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", timeZone: "UTC" });
}

function fmtDays(days) { return `${days} day${days === 1 ? "" : "s"}`; }

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "you";
}

// Vault tickers read yvDAI, not DAI: the thing you hold is the vault token.
function vaultTicker(symbol, vault) {
  if (!symbol) return shortAddr(vault);
  return symbol.startsWith("yv") ? symbol : `yv${symbol}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Card chrome ------------------------------------------------------------

// One scene per card: the glow wash, headline gradient and chart tip all take it,
// so consecutive cards never wear the same outfit. Mapped by content, not a rainbow
// rotation: money-earned cards read teal, identity and streak cards read gold,
// market and movement cards read blue.
const SCENE_BY_TITLE = {
  "your wallet": "blue",
  "first activity": "gold",
  "the year outside": "blue",
  "vaults explored": "teal",
  "chains used": "blue",
  "home base": "gold",
  "the ledger": "blue",
  "deposits made": "blue",
  "what if?": "gold",
  "you timed it": "gold",
  "portfolio value": "teal",
  "vault yield earned": "teal",
  "longest holding streak": "gold",
  "how you move": "blue",
  "the shape of the year": "blue",
  "portfolio curve": "teal",
  "share balance": "teal",
  "the verdict": "gold",
};

// A barely-there resting rotation, alternating by build order with a deterministic
// wobble so the deck does not look machine-straight. Two numbers cross the CSS
// boundary as custom properties; the transform stays compositor-friendly.
let cardCounter = 0;

function card(html) {
  const el = document.createElement("section");
  el.className = "card";
  el.innerHTML = html;
  const title = (html.match(/class="card-title">([\s\S]*?)<\/p>/) || [""])[1]
    .replace(/<[^>]+>/g, "");
  el.dataset.scene = SCENE_BY_TITLE[title]
    || (title.includes("yearn wrapped") ? "gold" : "blue");
  const n = cardCounter++;
  el.style.setProperty("--tilt", `${((n % 2 ? 1 : -1) * (0.45 + ((n * 37) % 7) * 0.06)).toFixed(2)}deg`);
  deck.appendChild(el);
  return el;
}

function quipOf(q) {
  return q?.text
    ? `<p class="card-quip tone-${esc(q.tone || "calm")}">${esc(q.text)}</p>`
    : "";
}

// Median holds and fastest round trips are durations, and a duration only lands in
// the unit a person would actually say out loud.
function compactHold(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `${Math.round(s / 3600)} hours`;
  const days = Math.floor(s / 86400);
  if (days < 60) return `${days} days`;
  return `${Math.round((days / 30.44) * 10) / 10} months`;
}

// Chain time is UTC; the person is not. "you move money at 3am" only means something
// in their own clock, so the hour index is rotated before it is drawn.
function localHourOffset() {
  return Math.round(-new Date().getTimezoneOffset() / 60);
}

function localHour(utcHour) {
  if (utcHour == null || !Number.isFinite(Number(utcHour))) return null;
  return ((Number(utcHour) + localHourOffset()) % 24 + 24) % 24;
}

function hoursMarkup(hoursUtc) {
  const hours = Array.isArray(hoursUtc) ? hoursUtc : [];
  if (hours.length !== 24) return "";
  const off = localHourOffset();
  const local = Array.from(
    { length: 24 },
    (_, h) => Number(hours[((h - off) % 24 + 24) % 24]) || 0,
  );
  const peak = Math.max(...local);
  if (!peak) return "";
  const peakHour = local.indexOf(peak);
  const bars = local
    .map((v, h) => `<i data-count="${v}"${h === peakHour ? ' class="is-peak"' : ""}`
      + ` style="--h:${Math.round((v / peak) * 100)}"></i>`)
    .join("");
  // Decorative for screen readers: the loudest hour is already a stat with words on
  // it, and 24 unlabelled bars would only be read as noise.
  return '<p class="viz-title">Activity by hour · local time</p>'
    + `<div class="hours" aria-hidden="true">${bars}</div>`
    + '<div class="hours-x" aria-hidden="true"><span>12a</span><span>6a</span>'
    + "<span>12p</span><span>6p</span><span>12a</span></div>";
}

// A spike-dominated year squeezes a straight line into the bottom of the canvas: one
// month parked at six figures while the rest of the year holds four makes a line you
// cannot read. Square root keeps zero at zero and every ordering intact, it only
// compresses the reach, so the quiet months stay legible and the peak still towers.
// The trigger compares the peak against the value you actually sit at (the 75th
// percentile), so a year that simply grew 4x stays linear: that is growth, not a
// spike. It engages only on single-axis charts, and the title says so, because a chart
// that changes scale silently is a lie with a gradient on it.
// What the market did in the window after the wallet's own best day. Both series have
// to be measurable, and a peak sitting at the end of the year has no after, so the
// builder sends nothing and nothing is printed.
function followUpStats(val) {
  const f = val?.peakFollowUp;
  if (!f || typeof f.changePct !== "number") return [];
  return [
    {
      value: `${f.changePct > 0 ? "+" : ""}${f.changePct.toFixed(1)}%`,
      label: `${String(f.windowDays)} days after your peak`,
      dir: f.changePct < 0 ? "down" : "up",
    },
    typeof f.troughPct === "number" && {
      value: `${f.troughPct.toFixed(1)}%`,
      label: "market's worst day after",
      dir: "down",
    },
  ];
}

// Tenure reads wrong without it: "this is your 2 year" is not a sentence.
function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const s = ["th", "st", "nd", "rd"];
  const last2 = v % 100;
  return `${v}${s[(last2 - 20) % 10] || s[last2] || s[0]}`;
}

function statsOf(items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return "";
  return `<div class="card-stats" data-n="${list.length}" style="--n:${list.length}">${list.map((i, si) => {
    // Long values are vault tickers and date ranges, and a vault ticker is one
    // unbreakable 14-character token. Numbers stay on one line (they are short and a
    // wrapped "$1,007,7" is unreadable); anything long gets to break.
    const long = String(i.value ?? "").length > 12;
    return `<div class="card-stat" style="--i:${si}"><span class="stat-value ${i.dir || ""}${long ? " wrap" : ""}">${esc(i.value)}</span>`
      + `<span class="stat-label">${esc(i.label)}</span></div>`;
  }).join("")}</div>`;
}

// One fact big, two or three supporting, one editorial line. Every value is
// escaped except `big`, which callers build themselves.
function bigCard({ title, big, small, line, sub, stats, quip, count, extra }) {
  const countAttr = count
    ? ` data-count="${esc(Number(count.value))}" data-money="${count.money ? 1 : 0}" data-suffix="${esc(count.suffix || "")}"`
    : "";
  return card(`
    <p class="card-title">${esc(title)}</p>
    <div class="card-big accent${small ? " small" : ""}"${countAttr}>${big}</div>
    ${line ? `<p class="card-line">${line}</p>` : ""}
    ${sub ? `<p class="card-sub">${esc(sub)}</p>` : ""}
    ${statsOf(stats)}
    ${extra || ""}
    ${quipOf(quip)}
  `);
}

// Twelve columns of what you actually did each month: deposits bright, exits
// behind them. Pure CSS on entry, so it needs no draw hook.
function barsOf(monthly) {
  const rows = monthly || [];
  if (!rows.some((m) => m.deposits || m.withdrawals)) return "";
  const peak = Math.max(1, ...rows.map((m) => Math.max(m.deposits, m.withdrawals)));
  return `<div class="bars" role="img" aria-label="deposits and withdrawals by month">` +
    rows.map((m, i) => `<div class="bar-col" data-deposits="${Number(m.deposits) || 0}" data-exits="${Number(m.withdrawals) || 0}" style="--i:${i}">` +
      `<span class="bar bar-out" style="--h:${Math.round((m.withdrawals / peak) * 100)}%"></span>` +
      `<span class="bar bar-in" style="--h:${Math.round((m.deposits / peak) * 100)}%"></span>` +
      `<span class="bar-month">${esc(String(m.month || "").slice(0, 3))}</span></div>`).join("") +
    `</div><p class="viz-key"><span class="key-in">Deposits</span><span class="key-out">Exits</span></p>`;
}

// Ledger amounts come back per symbol; a single-asset wallet gets a clean
// amount, mixed wallets get a count instead of a fake cross-asset total.
// A whale's line should read like a whale's, not a receipt: two decimals on
// twelve million is noise and the string out-sets the headline above it.
function fmtAssets(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return Math.round(v).toLocaleString("en-US");
  return fmtNum(v);
}

function symbolAmount(rows) {
  const known = (rows || []).filter((r) => r.symbol);
  if (!known.length) return null;
  // The unit goes in the label, not the value: "12.02M USDC" as a big value wrapped
  // onto a second line and pushed its label below the labels beside it.
  if (known.length === 1) return { value: fmtAssets(known[0].amount), unit: known[0].symbol };
  return { value: String(known.length), unit: "assets" };
}

// Last value per calendar month from a [ts, value] series, as [monthIndex, value].
// The market card compares two shapes over the same twelve slots.
function monthlyFromTimeline(v) {
  const pts = v?.isComplete ? v.points : null;
  if (!pts || pts.length < 2) return [];
  const byMonth = new Map();
  for (const [ts, value] of pts) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    byMonth.set(new Date(ts * 1000).getUTCMonth(), n);
  }
  return [...byMonth.entries()].sort((a, b) => a[0] - b[0]);
}

// --- Cards ------------------------------------------------------------------

// Stamps: the sticker layer. Rules live together so the tone stays consistent,
// and every one of them has to be earned by a number in the payload. Titles are
// matched after the build because the facts they key on are already in the DOM.
const MONTH_FULL = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function peakMonthIndex(points) {
  let best = null;
  for (const [ts, value] of points || []) {
    const n = Number(value);
    if (Number.isFinite(n) && (!best || n > best[1])) best = [Number(ts), n];
  }
  return best === null ? null : new Date(best[0] * 1000).getUTCMonth();
}

function stampFor(el, p) {
  const c = p.cards || {};
  const mk = c.marketContext || {};
  const pers = mk.personal || {};
  const val = c.valuation || {};
  const dw = c.depositsWithdrawn || {};
  const streak = c.longestHoldingStreak || {};
  const vg = c.vaultGrowth || {};
  const vd = c.verdict || {};
  const title = (el.querySelector(".card-title")?.textContent || "").trim();
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  switch (title) {
    case "first activity": {
      const kind = c.firstActivity?.detail?.kind;
      return kind === "transfer" ? { text: "arrived by transfer", tone: "gold" } : null;
    }
    case "the year outside":
      if ((pers.dipMonths || []).length) return { text: "bought the dip", tone: "gold" };
      // "weathered it" claims you sat through the fall holding. That needs a real
      // measured overlap; a null that defaults to zero would beat the year's drop.
      if (
        (num(mk.changePct) ?? 0) <= -20 &&
        typeof pers.ethWhileHeldPct === "number" &&
        pers.ethWhileHeldPct > (num(mk.changePct) ?? 0)
      ) {
        return { text: "weathered it", tone: "aqua" };
      }
      return (num(mk.maxDrawdownPct) ?? 0) <= -40 ? { text: "in for it", tone: "blue" } : null;
    case "vaults explored": {
      const n = Number(c.vaultsExplored?.count || 0);
      if (n === 1) return { text: "committed", tone: "blue" };
      return n >= 6 ? { text: "polyglot", tone: "aqua" } : null;
    }
    case "chains used": {
      const n = Number(c.chainsUsed?.chainIds?.length || 0);
      if (n >= 3) return { text: "multi chain", tone: "gold" };
      return n === 1 ? { text: "one town only", tone: "aqua" } : null;
    }
    case "home base": {
      const peak = num(c.favouriteVault?.peakPositionUsd);
      const yearPeak = num(val.peakUsd);
      if (peak && yearPeak && peak / yearPeak >= 0.8) return { text: "all in", tone: "gold" };
      return null;
    }
    case "deposits made":
    case "the ledger":
      return Number(dw.depositsCount || 0) > 0 && Number(dw.withdrawalsCount || 0) === 0
        ? { text: "never pulled", tone: "aqua" } : null;
    case "what if?":
    case "you timed it":
      return Number(c.whatIfHeld?.exitsTotal || 0) >= 3 ? { text: "serial exit", tone: "gold" } : null;
    case "vault yield earned": {
      const total = num(vg.totalGrowthUsd) ?? 0;
      if (total >= 10000) return { text: "compounding", tone: "gold" };
      return total >= 1000 ? { text: "yield max", tone: "aqua" } : null;
    }
    case "longest holding streak": {
      const days = Number(streak.days || 0);
      if (Number(streak.drawdownsHeld || 0) >= 1) return { text: "sat through it", tone: "aqua" };
      if (days >= 180) return { text: "half-year club", tone: "gold" };
      return days >= 30 ? { text: "diamond hands", tone: "blue" } : null;
    }
    case "the shape of the year":
      return null;
    case "the verdict":
      return vd.stamp ? { text: String(vd.stamp).toLowerCase(), tone: "gold" } : null;
    case "portfolio curve":
      return null;
    case "share balance":
      return null;
    default: {
      // Outro: the year's own verdict.
      if (!el.classList.contains("is-outro")) return null;
      return (num(mk.changePct) ?? 0) < 0
        ? { text: "survivor", tone: "aqua" } : { text: "max degen", tone: "gold" };
    }
  }
}

function stampCards(list, p) {
  for (const el of list) {
    const title = el.querySelector(".card-title");
    const heading = document.createElement("div");
    heading.className = "card-heading";
    title.before(heading);
    heading.append(title);
    const stamp = stampFor(el, p);
    if (!stamp) continue;
    const span = document.createElement("span");
    span.className = `stamp tone-${stamp.tone}`;
    span.textContent = stamp.text;
    heading.append(span);
  }
}

function buildCards(p) {
  const c = p.cards;
  const year = p.period.year;
  const who = p.resolvedName || urlName || shortAddr(p.address);
  const cards = [];

  const fa = c.firstActivity;
  const tenure = fa?.tenure || null;
  cards.push(card(`
    <p class="card-title">your wallet</p>
    <h1 class="card-big accent${p.resolvedName || urlName ? "" : " mono"}">${esc(who)}</h1>
    <p class="card-line">${tenure
      ? (Number(tenure.seasons) > 1
        ? `your ${esc(ordinal(tenure.seasons))} year with Yearn.`
        : "your first year with Yearn. welcome.")
      : "here's your year in yVaults."}</p>
    <p class="card-sub">tap anywhere to continue</p>
  `));
  cards[0].dataset.private = "true";

  if (fa?.firstTs) {
    const inYear = p.period.startTs <= fa.firstTs;
    const detail = fa.detail || null;
    cards.push(bigCard({
      title: "first activity",
      big: esc(fmtDate(fa.firstTs)),
      line: inYear
        ? `that's when your ${esc(String(year))} started onchain.`
        : "before this year. you've been around.",
      stats: detail && [
        { value: detail.kind === "transfer" ? `a transfer ${detail.direction === "out" ? "out" : "in"}`
            : detail.kind === "deposit" ? "a deposit" : "a withdrawal", label: "your first move" },
        detail.vaultLabel && { value: detail.vaultLabel, label: `on ${detail.chain || ""}` },
        typeof detail.underlying === "number" && detail.symbol
          && { value: `${fmtAssets(detail.underlying)} ${detail.symbol}`, label: "the size of it" },
      ],
      quip: fa.quip,
    }));
  }

  const mk = c.marketContext;
  if (mk?.isComplete) {
    const monthly = (mk.monthly || []).map((m, i) => [i, m.usd]);
    const yours = monthlyFromTimeline(c.valuation);
    const pers = mk.personal || {};
    // "You held on N of those days" is only true if the balance curve could actually
    // be measured. A wallet yearn.fi cannot price has no held window, and telling it
    // "not one of those days found you holding" would be a flat contradiction of its
    // own 118-day streak card.
    const measurable =
      typeof pers.heldDays === "number" && pers.isComplete !== false;
    const held = measurable && pers.heldDays > 0;
    const dual = monthly.length > 1 && yours.length > 1;
    const chart = monthly.length > 1 ? `<div class="spark-wrap"><canvas class="spark" role="img"
      aria-label="${esc(String(mk.asset || "ETH"))} price by month across ${esc(String(year))}, ${esc(fmtSigned(mk.changePct))},${
        dual ? ` against your own balance shape over the same months` : ""}"></canvas></div>` : "";
    const el = card(`
      <p class="card-title">the year outside</p>
      <div class="card-big accent">${esc(fmtSigned(mk.changePct))} ${esc(String(mk.asset || "ETH"))}</div>
      <p class="card-line">${!measurable
        ? `the market backdrop for your year.`
        : held
        ? `you held vault shares for ${pers.heldDays} days. ${esc(String(mk.asset || "ETH"))} moved ${esc(fmtSigned(pers.ethWhileHeldPct))} during that time.`
        : `no measured vault holdings during this period.`}</p>
      ${chart}
      ${statsOf([
        pers.worstHeldDay && { value: fmtSigned(pers.worstHeldDay.pct), label: `worst held day ${fmtDateShort(pers.worstHeldDay.date)}`, dir: "down" },
        typeof pers.heldSharePct === "number" && { value: `${pers.heldSharePct}%`, label: "of the year held" },
        typeof pers.stableDepositPct === "number" && { value: `${pers.stableDepositPct}%`, label: "deposits in stables" },
      ])}
      ${quipOf(mk.quip)}
    `);
    if (monthly.length > 1) {
      el.dataset.spark = JSON.stringify({
        points: monthly, kind: "market", asset: mk.asset || "ETH",
        second: dual ? yours : null,
      });
    }
    cards.push(el);
  }

  const ve = c.vaultsExplored;
  // Seasonal medians ride on the deposits and streak cards only: the vaults card
  // is the deck's tallest screen, and a third stat there wraps into a second row
  // on a phone, which the fit gate correctly calls an overflow.
  const med = (p.medians && typeof p.medians.deposits === "number" && p.medians) || null;
  if (ve?.count) {
    cards.push(card(`
      <p class="card-title">vaults explored</p>
      <div class="card-big accent">${ve.count}</div>
      <p class="card-line">vault${ve.count === 1 ? "" : "s"} you used this year.</p>
      ${statsOf([
        { value: ve.stillHolding ?? 0, label: "still holding" },
        { value: Math.max(0, ve.count - (ve.stillHolding ?? 0)), label: "fully left" },
      ])}
      <ul class="card-list">${(ve.vaults || []).slice(0, 14).map((v) => `<li>${esc(v.label)}</li>`).join("")}</ul>
      ${quipOf(ve.quip)}
    `));
  }

  const names = c.chainsUsed?.names || [];
  cards.push(card(`
    <p class="card-title">chains used</p>
    <div class="card-big accent">${names.length}</div>
    <p class="card-line">chain${names.length === 1 ? "" : "s"} you farmed on this year.</p>
    ${names.length ? `<ul class="card-list">${names.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${quipOf(c.chainsUsed?.quip)}
  `));

  const fv = c.favouriteVault;
  if (fv?.vault && fv.isComplete) {
    // How much of the year's peak sat in one vault. Same units on both sides, so
    // the ratio is honest: both are USD position values.
    const yearPeak = Number(c.valuation?.peakUsd || 0);
    const share = typeof fv.peakPositionUsd === "number" && yearPeak > 0
      ? Math.min(100, Math.round((fv.peakPositionUsd / yearPeak) * 100)) : null;
    // A first-deposit retro: when this relationship started, and with how much.
    // Arrived-by-transfer vaults have no deposit() event, so no retro line.
    const fd = fv.firstDeposit;
    const retro = fd && typeof fd.ts === "number" && fd.assets
      ? `first deposit: ${fmtDateShort(fd.ts)} · ${fmtAssets(fd.assets)}`
        + `${fd.symbol ? ` ${fd.symbol}` : ""}`
      : undefined;
    cards.push(bigCard({
      title: "home base",
      big: esc(fv.label),
      line: fv.basis === "holdings" ? "your largest estimated vault position this year." : "your vault this year.",
      sub: retro,
      stats: [
        typeof fv.peakPositionUsd === "number" && fv.peakPositionUsd >= 1
          && { value: fmtUsdShort(fv.peakPositionUsd), label: "peak in this vault" },
        share != null && { value: `${share}%`, label: "of your peak" },
      ],
    }));
  } else {
    cards.push(bigCard({ title: "home base", big: c.vaultsExplored?.count ? "not ranked" : "off the grid", line: c.vaultsExplored?.count ? "some vault prices are unavailable." : "no vault this year." }));
  }

  const dw = c.depositsWithdrawn || {};
  const moneyIn = dw.isComplete ? symbolAmount(dw.depositsBySymbol) : null;
  const moneyOut = dw.isComplete ? symbolAmount(dw.withdrawalsBySymbol) : null;
  if (!dw.depositsCount && !dw.withdrawalsCount) {
    cards.push(bigCard({
      title: "the ledger",
      quip: dw.quip,
      big: c.vaultsExplored?.count ? "held shares" : "quiet year",
      small: true,
      line: "no deposits or withdrawals this year.",
    }));
  } else {
    const busiest = (dw.monthly || []).reduce(
      (best, m) => (!best || m.deposits > best.deposits ? m : best), null);
    cards.push(bigCard({
      title: "deposits made",
      quip: dw.quip,
      big: dw.depositsCount,
      count: { value: dw.depositsCount },
      line: `${dw.withdrawalsCount} exit${dw.withdrawalsCount === 1 ? "" : "s"} along the way.`,
      stats: [
        moneyIn && { value: moneyIn.value, label: `${moneyIn.unit} deposited` },
        moneyOut && { value: moneyOut.value, label: `${moneyOut.unit} withdrawn` },
        busiest && busiest.deposits > 0 && { value: busiest.deposits, label: `busiest month ${busiest.month}` },
        med && typeof med.deposits === "number" && { value: med.deposits, label: "active-wallet median" },
      ],
      extra: barsOf(dw.monthly),
    }));
  }

  const wi = c.whatIfHeld;
  if (wi?.isComplete && wi.exitsTotal > 0 && typeof wi.forgoneUsd === "number") {
    const positive = wi.forgoneUsd >= 0;
    const shown = fmtUsdShort(Math.abs(wi.forgoneUsd));
    // Per-vault rows, because "somebody walked away from this" lands harder when
    // you can see exactly who and where.
    const rows = (wi.vaults || [])
      .filter((v) => typeof v.forgoneUsd === "number" && Math.abs(v.forgoneUsd) >= 1)
      .sort((a, b) => Math.abs(b.forgoneUsd)
        - Math.abs(a.forgoneUsd))
      .slice(0, 4)
      .map((v, ri) => `<li style="--i:${ri}"><span>${esc(v.label || shortAddr(v.vault || ""))}</span>`
        + `<b>${esc(fmtUsdShort(Math.abs(v.forgoneUsd)))}</b></li>`);
    cards.push(bigCard({
      // "what if?" rather than "if you had held": the old title plus the old line
      // read as one sentence cut in half.
      title: positive ? "what if?" : "you timed it",
      quip: wi.quip,
      big: shown,
      line: positive
        ? "estimated vault yield after you exited."
        : "estimated vault losses avoided by exiting.",
      sub: "if the exited shares had stayed in the vaults",
      stats: [
        { value: wi.exitsTotal, label: "exits" },
        wi.biggestExit && {
          value: typeof wi.biggestExit.forgoneUsd === "number"
            ? fmtUsdShort(Math.abs(wi.biggestExit.forgoneUsd)) : "n/a",
          label: `biggest exit ${fmtDateShort(wi.biggestExit.ts)}`,
        },
      ],
      extra: rows.length ? `<ul class="card-list rows">${rows.join("")}</ul>` : "",
    }));
  }

  const val = c.valuation;
  if (val?.isComplete && val.points?.length > 1) {
    cards.push(bigCard({
      title: "portfolio value",
      quip: val.quip,
      big: fmtUsd(val.endUsd),
      count: { value: Number(val.endUsd || 0), money: true },
      line: `your peak this year was ${esc(fmtUsd(val.peakUsd))}.`,
      stats: [
        { value: fmtUsdShort(val.startUsd), label: "start of year" },
        { value: fmtUsdShort(val.peakUsd), label: "peak" },
        typeof val.changePct === "number" && {
          value: fmtSigned(val.changePct), label: "year change",
          dir: val.changePct >= 0 ? "up" : "down",
        },
      ],
    }));
  } else if (val && val.reason) {
    cards.push(bigCard({
      title: "portfolio value",
      big: "still counting",
      small: true,
      line: "those vaults couldn't be priced yet.",
    }));
  }

  const vg = c.vaultGrowth;
  if (vg?.isComplete && typeof vg.totalGrowthUsd === "number" && vg.vaults?.length) {
    const okVaults = vg.vaults.filter((v) => v.status === "ok" && v.growthUsd != null);
    const total = vg.totalGrowthUsd;
    const top = okVaults[0];
    const rows = okVaults.slice(0, 4).map((v, ri) => `<li style="--i:${ri}"><span>${esc(vaultTicker(v.symbol, v.vault))}</span>`
      + `<b>${esc(fmtUsdShort(v.growthUsd))}${typeof v.annualizedPct === "number"
        ? ` · ${v.annualizedPct.toFixed(2)}%` : ""}</b></li>`);
    cards.push(bigCard({
      title: "vault yield earned",
      quip: vg.quip,
      big: fmtUsd(total),
      count: { value: Number(total || 0), money: true },
      line: `earned while your money sat in ${okVaults.length} vault${okVaults.length === 1 ? "" : "s"}.`,
      sub: vg.estimated ? "estimated from daily vault data" : undefined,
      stats: top && [
        { value: vaultTicker(top.symbol, top.vault), label: "top vault" },
        { value: fmtUsdShort(top.growthUsd), label: "from that vault" },
        typeof top.annualizedPct === "number" && { value: `${top.annualizedPct.toFixed(2)}%`, label: "annualized estimate" },
      ],
      extra: okVaults.length > 1 ? `<ul class="card-list rows">${rows.join("")}</ul>` : "",
    }));
  }

  const streak = c.longestHoldingStreak;
  if (streak?.vault && streak.days > 0) {
    cards.push(bigCard({
      title: "longest holding streak",
      quip: streak.quip,
      big: fmtDays(streak.days),
      count: { value: streak.days, suffix: streak.days === 1 ? " day" : " days" },
      line: `held in ${esc(streak.label)} without a break.`,
      stats: [
        streak.drawdownsHeld > 0 && {
          value: streak.drawdownsHeld,
          label: `crash${streak.drawdownsHeld === 1 ? "" : "es"} sat through`,
        },
        med && typeof med.holdDays === "number" && { value: fmtDays(med.holdDays), label: "active-wallet median" },
        streak.startTs && streak.endTs && {
          value: `${fmtWindowDate(streak.startTs)}–${fmtWindowDate(streak.endTs)}`,
          label: "the window",
        },
      ],
    }));
  } else {
    cards.push(bigCard({
      title: "longest holding streak",
      big: c.behaviour?.holdings?.holds ? "under a day" : "no streak",
      line: c.behaviour?.holdings?.holds ? "every measured hold was under a day." : "no measured holding streak this year.",
    }));
  }

  const bh = c.behaviour;
  if (bh?.isComplete) {
    const rh = bh.rhythm || {};
    const hd = bh.holdings || {};
    const loudest = localHour(rh.peakHourUtc);
    const median = typeof hd.medianHoldSeconds === "number"
      ? compactHold(hd.medianHoldSeconds) : null;
    cards.push(bigCard({
      title: "how you move",
      quip: bh.quip,
      big: median ? esc(median) : "no rhythm",
      small: median ? undefined : true,
      line: median ? "median holding time." : "not enough activity to find a pattern.",
      sub: rh.busiestDay
        ? `busiest day: ${fmtDateShort(rh.busiestDay.date)} · ${rh.busiestDay.events} moves`
        : undefined,
      extra: hoursMarkup(rh.hoursUtc),
      stats: [
        loudest != null && {
          value: `${String(loudest).padStart(2, "0")}:00`,
          label: "busiest hour, local",
        },
        typeof hd.fastestRoundTripSeconds === "number" && {
          value: compactHold(hd.fastestRoundTripSeconds),
          label: "fastest in and out",
        },
        hd.roundTrips > 0 && {
          value: hd.roundTrips,
          label: `full round ${hd.roundTrips === 1 ? "trip" : "trips"}`,
        },
      ],
    }));
  }

  // The year as chapters, not totals: the builder cut it into at most three
  // stretches of months by net direction and traffic, named each one, and the
  // export shows the same story compressed (main chapter as the number, all
  // chapters in the line's place on the share card).
  const ph = c.phases;
  if (ph?.list?.length) {
    const vol = (s) => (Number(s.deposits) || 0) + (Number(s.withdrawals) || 0);
    const main = ph.list.slice().sort(
      (a, b) => (b.months.length - a.months.length) || (vol(b) - vol(a)),
    )[0];
    const addMonths = ph.list.filter(
      (s) => (Number(s.deposits) || 0) > (Number(s.withdrawals) || 0))
      .reduce((n, s) => n + (s.months?.length || 0), 0);
    const exitMonths = ph.list.filter(
      (s) => (Number(s.withdrawals) || 0) > (Number(s.deposits) || 0))
      .reduce((n, s) => n + (s.months?.length || 0), 0);
    const rows = ph.list.map((s, ri) => {
      const span = `${esc(String(s.months[0] || "").slice(0, 3))}–${esc(String(s.months[s.months.length - 1] || "").slice(0, 3))}`;
      return `<li style="--i:${ri}"><span>${span}</span><b>${esc(s.name)}</b></li>`;
    }).join("");
    cards.push(bigCard({
      title: "the shape of the year",
      quip: ph.quip,
      big: esc(main.name),
      line: `${ph.list.length} chapter${ph.list.length === 1 ? "" : "s"} in your year.`,
      stats: [
        { value: addMonths, label: `month${addMonths === 1 ? "" : "s"} adding` },
        { value: exitMonths, label: `month${exitMonths === 1 ? "" : "s"} taking out` },
      ],
      extra: `<ul class="card-list rows">${rows}</ul>`,
    }));
  }

  const sparkUsd = val?.isComplete && val.points?.length > 1 ? { points: val.points } : null;
  const sparkVault = sparkUsd ? null
    : (c.balanceTimeline?.vaults || []).find((v) => v.vault === c.favouriteVault?.vault && v.chainId === c.favouriteVault?.chainId)
      || c.balanceTimeline?.vaults?.[0];
  const pts = sparkUsd ? sparkUsd.points : sparkVault?.points;
  if (pts && pts.length > 1) {
    const isUsd = !!sparkUsd;
    const peak = pts.reduce((best, p) => (Number(p[1]) > Number(best[1]) ? p : best), pts[0]);
    const el = card(`
      <p class="card-title">${isUsd ? "portfolio curve" : "share balance"}</p>
      <div class="spark-wrap">
        <div class="spark-title">${isUsd
          ? `portfolio value in USD over ${esc(String(year))}`
          : `shares held over ${esc(String(year))} (relative)`}${spikeDominated(pts)
          ? " \u00b7 square-root scale, so the quiet months stay visible" : ""}</div>
        <canvas class="spark" role="img"
          aria-label="${isUsd ? `portfolio value peaked at ${fmtUsd(peak[1])} on ${fmtDate(peak[0])}` : "share balance over the year"}"></canvas>
      </div>
      <p class="card-line">${isUsd
        ? `peaked at ${esc(fmtUsd(peak[1]))} on ${esc(fmtDate(peak[0]))}. ended at ${esc(fmtUsd(pts[pts.length - 1][1]))}.`
        : `${pts.length} balance changes across the year.`}</p>
      ${isUsd ? statsOf(followUpStats(val)) : ""}
    `);
    el.dataset.spark = JSON.stringify({ points: pts, kind: isUsd ? "usd" : "relative" });
    cards.push(el);
  }

  // The verdict: one archetype the year earned, decided by the payload. The stamp
  // carries the short form, so the export wears the verdict too.
  const vd = c.verdict;
  if (vd?.name) {
    const rt = c.behaviour?.holdings?.roundTrips;
    cards.push(bigCard({
      title: "the verdict",
      big: esc(vd.name),
      line: esc(vd.line || ""),
      stats: [
        typeof rt === "number" && rt > 0 && { value: rt, label: "round trips" },
        streak?.days > 0 && { value: streak.days, label: "longest sit, days" },
        { value: ve?.count ?? 0, label: "vaults touched" },
      ],
    }));
  }

  // A shareable closing recap uses only metrics already eligible for the deck.
  const hasYield = vg?.isComplete && vg.vaults?.length
    && typeof vg.totalGrowthUsd === "number" && Math.abs(vg.totalGrowthUsd) >= 0.01;
  const hasStreak = streak?.vault && streak.days > 0;
  const asOf = p.period.endTs ? fmtDate(p.period.endTs) : "recently";
  const closing = bigCard({
    title: `${year} · yearn wrapped`,
    big: hasYield ? fmtUsd(vg.totalGrowthUsd) : hasStreak ? fmtDays(streak.days) : `${ve?.count || 0} vault${ve?.count === 1 ? "" : "s"}`,
    line: hasYield ? `${vg.estimated ? "estimated " : ""}vault yield earned.`
      : hasStreak ? "your longest holding streak." : "your year in Yearn.",
    sub: `${p.period.partial ? "your year so far" : "your year, wrapped"} · as of ${asOf}`,
    stats: [
      typeof ve?.count === "number" && { value: ve.count, label: "vaults used" },
      { value: names.length, label: "chains used" },
      typeof dw.depositsCount === "number" && { value: dw.depositsCount, label: "deposits" },
      hasYield && hasStreak ? { value: fmtDays(streak.days), label: "longest hold" }
        : bh?.isComplete && typeof bh.holdings?.roundTrips === "number" && { value: bh.holdings.roundTrips, label: "round trips" },
    ],
    extra: '<p class="card-action"><a class="entry-sample" href="./">run another address</a></p>',
  });
  closing.classList.add("is-summary");
  cards.push(closing);
  cards.forEach(el => {
    if (el.querySelector(".card-title")?.textContent === "longest holding streak") el.classList.add("is-streak");
  });

  stampCards(cards, p);
  return cards;
}

function errorCard(notFound) {
  return card(`
    <p class="card-title">${notFound ? "nothing to replay" : "the index is breathing"}</p>
    <div class="card-big accent small">${notFound ? "no vault history" : "try again shortly"}</div>
    <p class="card-line">${notFound
      ? "this address has no Yearn history on the chains we index."
      : "the recap service couldn't reach its data in time."}</p>
    <p class="card-sub"><a class="entry-sample" href="./">try another address</a> ·
      <a class="entry-sample" href="replay.html?src=assets/sample-recap.json">watch a sample year</a></p>
  `);
}

// --- Curve ------------------------------------------------------------------

function drawSpark(canvas, rawPoints, kind, animate, rawSecond, asset = "ETH") {
  // A chart with one usable point is not a chart, and a malformed point would
  // otherwise surface as a TypeError inside the animation frame.
  const points = (Array.isArray(rawPoints) ? rawPoints : [])
    .filter((p) => p && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  // A second series (your own balance against the market's) gets its own scale: the
  // two are different magnitudes, and pretending otherwise would be a lie with a
  // legend on it. The legend says each line is scaled to itself.
  const second = (Array.isArray(rawSecond) ? rawSecond : [])
    .filter((p) => p && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  if (!canvas || points.length < 2) {
    if (rawPoints && rawPoints.length) {
      console.warn(`spark: only ${points.length} usable points for ${kind}`);
    }
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(260, Math.floor(canvas.clientWidth || 640));
  // The comparison chart needs more room than a single line: two series plus a
  // legend. It still has to leave the stats row on screen, so it scales with the
  // viewport instead of being a fixed box.
  const dual = second.length > 1;
  const h = kind === "market"
    ? (dual ? Math.round(Math.min(190, Math.max(110, window.innerHeight * 0.2))) : 150)
    : 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = "100%";
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const xs = points.map((p) => Number(p[0]));
  const ys = points.map((p) => Number(p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  // A top band keeps the peak badge clear of the line and its sparkle, and the
  // width is measured, not assumed, so 12px mono stays 12px on a phone.
  const padX = 12;
  const padTop = kind === "usd" ? 58 : (second.length > 1 ? 50 : 20);
  const padBottom = kind === "market" ? 24 : 16;
  const scale = chartScale(points, kind, second.length > 1);
  const base = scale.base;
  const X = (t) => padX + scale.x(t) * (w - padX * 2);
  const Y = (v) => h - padBottom - scale.y(v) * (h - padTop - padBottom);

  const peakIdx = ys.reduce((best, v, i) => (v > ys[best] ? i : best), 0);
  const up = ys[ys.length - 1] >= ys[0];
  const grad = ctx.createLinearGradient(padX, 0, w - padX, 0);
  const cs = getComputedStyle(canvas.closest(".card"));
  const palette = chartPalette(["--scene", "--scene-2"].map(v => cs.getPropertyValue(v).trim()), kind, up);
  palette.stops.forEach(([at, color]) => grad.addColorStop(at, color));

  function frame(upTo, withPeak) {
    ctx.clearRect(0, 0, w, h);
    if (kind !== "market") {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(padX, Y(base));
      ctx.lineTo(w - padX, Y(base));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= upTo; i++) {
      const x = X(points[i][0]), y = Y(points[i][1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const lastX = X(points[upTo][0]), lastY = Y(points[upTo][1]);
    ctx.fillStyle = "#fafafa";
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();

    if (kind === "market") {
      if (second.length > 1) {
        const secondScale = chartScale(second, kind, true, true);
        ctx.strokeStyle = palette.comparison;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        second.forEach((p, i) => {
          const x = X(Number(p[0]));
          const y = h - padBottom - secondScale.y(Number(p[1])) * (h - padTop - padBottom);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (second.length > 1) {
        // Legend, because two unlabelled lines is a Rorschatchart.
        ctx.font = "500 11px 'Aeonik Mono', ui-monospace, monospace";
        ctx.textAlign = "left";
        const items = [[asset, palette.stops[0][1]], ["your vaults", palette.comparison]];
        let lx = padX;
        for (const [name, color] of items) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(lx + 4, 11, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = cs.getPropertyValue("--text-muted").trim();
          ctx.fillText(name, lx + 13, 15);
          lx += 22 + ctx.measureText(name).width + 14;
        }
        ctx.fillStyle = cs.getPropertyValue("--text-muted").trim();
        ctx.fillText("each line uses its own scale", padX, 33);
      }
      ctx.font = "500 11px 'Aeonik Mono', ui-monospace, monospace";
      ctx.fillStyle = cs.getPropertyValue("--text-muted").trim();
      ctx.textAlign = "center";
      const full = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      // Single letters collide (J, J, J); drop to them only when the canvas is
      // too narrow for three characters per month.
      const letters = w >= 520 ? full : full.map((m) => m[0]);
      for (let m = 0; m < letters.length; m++) {
        if (m < x0 || m > x1) continue;
        ctx.fillText(letters[m], X(m), h - 7);
      }
      ctx.textAlign = "left";
      return;
    }

    if (!withPeak) return;
    const px = X(points[peakIdx][0]), py = Y(points[peakIdx][1]);

    // Sparkle on the high water mark.
    ctx.save();
    ctx.translate(px, py);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(245, 158, 11, 0.9)";
    ctx.shadowBlur = 14;
    for (const [dx, dy] of [[0, -13], [0, 13], [-13, 0], [13, 0], [-8, -8], [8, 8], [-8, 8], [8, -8]]) {
      ctx.beginPath();
      ctx.moveTo(dx * 0.25, dy * 0.25);
      ctx.lineTo(dx, dy);
      ctx.stroke();
    }
    ctx.restore();

    if (kind !== "usd") return;
    const label = `peak ${fmtUsdShort(points[peakIdx][1])} · ${fmtDateShort(points[peakIdx][0])}`;
    ctx.font = "500 12px 'Aeonik Mono', ui-monospace, monospace";
    const tw = ctx.measureText(label).width + 18;
    const th = 24;
    const bx = Math.min(Math.max(px - tw / 2, padX), Math.max(padX, w - padX - tw));
    const by = Math.max(py - 13 - 10 - th, 2);
    ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, by + th);
    ctx.lineTo(px, py - 15);
    ctx.stroke();
    ctx.fillStyle = "rgba(6, 87, 233, 0.35)";
    ctx.strokeStyle = "rgba(59, 130, 246, 0.85)";
    ctx.beginPath();
    ctx.roundRect(bx, by, tw, th, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fafafa";
    ctx.fillText(label, bx + 9, by + 16);
  }

  if (!animate || reducedMotion) { frame(points.length - 1, true); return; }
  const started = performance.now();
  const dur = 1100;
  (function step(now) {
    const t = Math.max(0, Math.min((now - started) / dur, 1));
    const eased = 1 - Math.pow(1 - t, 3);
    const upTo = Math.round(eased * (points.length - 1));
    if (!points[upTo]) {
      console.warn(`spark: frame index ${upTo} out of range for ${kind} (${points.length} points)`);
      return;
    }
    frame(upTo, t === 1);
    if (t < 1) requestAnimationFrame(step);
  })(started);
}

// --- Deck controller --------------------------------------------------------

let cards = [];
let dots = [];
let idx = 0;
let syncActions = () => {};
const introduced = new WeakSet();

function countUp(el) {
  const target = el.querySelector(".card-big[data-count]");
  if (!target) return;
  const value = Number(target.dataset.count || 0);
  if (!Number.isFinite(value) || value === 0 || reducedMotion) return;
  const isMoney = target.dataset.money === "1";
  const started = performance.now();
  const dur = 900;
  (function step(now) {
    const t = Math.max(0, Math.min((now - started) / dur, 1));
    const eased = 1 - Math.pow(1 - t, 3);
    const current = value * eased;
    target.textContent = isMoney
      ? fmtUsd(current)
      : `${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(current)}${target.dataset.suffix || ""}`;
    if (t < 1) requestAnimationFrame(step);
  })(started);
}

function show(i) {
  idx = Math.max(0, Math.min(i, cards.length - 1));
  cards.forEach((el, k) => el.classList.toggle("active", k === idx));
  deck.scrollTop = 0;
  dots.forEach((d, k) => d.classList.toggle("on", k === idx));
  syncActions();
  if (status) {
    const title = (cards[idx]?.querySelector(".card-title")?.textContent || "").trim();
    status.textContent = `${idx + 1} of ${cards.length}${title ? `: ${title}` : ""}`;
  }

  const el = cards[idx];
  if (!el || introduced.has(el)) return;
  introduced.add(el);
  if (el.dataset.spark) {
    const { points, kind, second, asset } = JSON.parse(el.dataset.spark);
    drawSpark(el.querySelector("canvas"), points, kind, true, second, asset);
  }
  countUp(el);
}

function step(dir) { show(idx + dir); }

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest("button, a, input, textarea, select, [contenteditable]"))) return;
  if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); step(1); }
  if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  // Thirteen cards is a long walk: jump to either end.
  if (e.key === "Home") { e.preventDefault(); show(0); }
  if (e.key === "End") { e.preventDefault(); show(cards.length - 1); }
});
deck.addEventListener("click", () => step(1));

// Touch needs a way back as well as forward: a horizontal swipe in either
// direction moves one card. Single-pointer gesture, no curved-path dependency.
let touchStart = null;
deck.addEventListener("touchstart", (e) => {
  const touch = e.touches.length === 1 ? e.touches[0] : null;
  touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });
deck.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const touch = e.changedTouches[0];
  const dx = (touch?.clientX ?? touchStart.x) - touchStart.x;
  const dy = (touch?.clientY ?? touchStart.y) - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
  step(dx < 0 ? 1 : -1);
}, { passive: true });

// --- Starfield --------------------------------------------------------------

const stars = document.getElementById("stars");
const sctx = stars.getContext("2d");
let starsArr = [];

function sizeStars() {
  stars.width = window.innerWidth;
  stars.height = window.innerHeight;
  starsArr = Array.from({ length: 170 }, () => ({
    x: Math.random() * stars.width,
    y: Math.random() * stars.height,
    r: 0.6 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2,
    c: PALETTE[(Math.random() * PALETTE.length) | 0],
  }));
}
window.addEventListener("resize", sizeStars);
sizeStars();

function tickStars(t) {
  sctx.clearRect(0, 0, stars.width, stars.height);
  for (const s of starsArr) {
    const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.0007 + s.phase));
    sctx.globalAlpha = a;
    sctx.fillStyle = s.c;
    sctx.fillRect(s.x, s.y, s.r, s.r);
  }
  sctx.globalAlpha = 1;
  if (!reducedMotion) requestAnimationFrame(tickStars);
}
requestAnimationFrame(tickStars);

// --- Boot -------------------------------------------------------------------

// Share: the card on screen, composed into a 1200x630 PNG for X. Copy or save.
// It reads the card's own rendered text, so the image can never disagree with what
// the deck just said.
function wireShare(payload) {
  const bar = document.getElementById("recap-actions");
  if (!bar) return;
  if (!payload || !payload.period) { bar.hidden = true; return; }
  bar.hidden = false;
  let busy = false;
  const privateCard = () => cards[idx]?.dataset.private === "true";
  syncActions = () => {
    bar.querySelectorAll("button").forEach(button => { button.disabled = busy || privateCard(); });
    bar.title = privateCard() ? "Sharing is disabled on the wallet card" : "";
  };
  syncActions();

  const model = (el) => {
    const text = (sel) => (el.querySelector(sel)?.textContent || "").replace(/\s+/g, " ").trim();
    const color = (sel) => {
      const node = el.querySelector(sel);
      return node ? getComputedStyle(node).color : "";
    };
    const tracking = (sel) => {
      const node = el.querySelector(sel);
      if (!node) return 0;
      const style = getComputedStyle(node);
      return (parseFloat(style.letterSpacing) || 0) / parseFloat(style.fontSize);
    };
    let chart = null;
    let chartSecond = null;
    let chartKind = null;
    let chartAsset = "";
    let marketUp = undefined;
    try {
      if (el.dataset.spark) {
        const parsed = JSON.parse(el.dataset.spark);
        chart = parsed.points || null;
        chartSecond = parsed.second || null;
        chartKind = parsed.kind || null;
        chartAsset = parsed.asset || "ETH";
        // The market curve's colour is a verdict (up or down), not a scene choice.
        marketUp = chartKind === "market"
          ? (Array.isArray(chart) && chart.length > 1
            ? Number(chart[chart.length - 1][1]) >= Number(chart[0][1]) : true)
          : undefined;
      }
    } catch { chart = null; }
    // The identity card is never eligible; retain address stripping as a backstop.
    const counter = el.querySelector(".card-big[data-count]");
    const rawBig = counter
      ? (counter.dataset.money === "1" ? fmtUsd(Number(counter.dataset.count))
        : `${fmtNum(Number(counter.dataset.count), 0)}${counter.dataset.suffix || ""}`)
      : text(".card-big");
    const whoish = /^0x[a-fA-F0-9]{1,6}…/;
    const gradient = (node) => node ? getComputedStyle(node).backgroundImage.match(/rgba?\([^)]+\)/g) || [] : [];
    const monthly = [...el.querySelectorAll(".bar-col")];
    const hourly = [...el.querySelectorAll(".hours i")];
    const graph = monthly.length ? {
      kind: "monthly", title: "", labels: ["Deposits", "Exits"],
      items: monthly.map(node => ({ label: node.querySelector(".bar-month").textContent,
        incoming: Number(node.dataset.deposits), outgoing: Number(node.dataset.exits) })),
      colors: gradient(el.querySelector(".bar-in")),
      outgoing: getComputedStyle(el.querySelector(".bar-out")).backgroundColor,
      keyColors: [...el.querySelectorAll(".viz-key span")].map(node => getComputedStyle(node, "::before").backgroundColor),
    } : hourly.length ? {
      kind: "hourly", title: text(".viz-title"),
      labels: [...el.querySelectorAll(".hours-x span")].map(node => node.textContent),
      items: hourly.map(node => ({ incoming: Number(node.dataset.count), peak: node.classList.contains("is-peak") })),
      colors: gradient(hourly.find(node => !node.classList.contains("is-peak"))),
      peakColors: gradient(el.querySelector(".hours .is-peak")),
    } : null;
    const details = [...el.querySelectorAll(".card-list li")].map(node => node.children.length
      ? [...node.children].map(child => child.textContent.trim()) : [node.textContent.trim()]);
    return {
      title: text(".card-title"),
      big: whoish.test(rawBig) ? "" : rawBig,
      line: text(".card-line"),
      sub: !el.querySelector(".card-sub a") && text(".card-title") !== "your wallet" ? text(".card-sub") : "",
      chartTitle: text(".spark-title"),
      quip: text(".card-quip"),
      stamp: text(".stamp"),
      stats: [...el.querySelectorAll(".card-stat")].map((s) => ({
        value: (s.querySelector(".stat-value")?.textContent || "").trim(),
        label: (s.querySelector(".stat-label")?.textContent || "").trim(),
        color: getComputedStyle(s.querySelector(".stat-value")).color,
      })),
      graph,
      details,
      summary: el.classList.contains("is-summary"),
      chart,
      chartSecond,
      chartKind,
      marketUp,
      chartAsset,
      year: payload.period.year,
      link: APP_URL.href,
      scene: ["--scene", "--scene-2"].map((v) => getComputedStyle(el).getPropertyValue(v).trim()),
      colors: {
        title: color(".card-title"), line: color(".card-line"), sub: color(".card-sub"),
        quip: color(".card-quip"), stamp: color(".stamp"),
        primary: getComputedStyle(el).getPropertyValue("--text-primary").trim(),
        muted: getComputedStyle(el).getPropertyValue("--text-muted").trim(),
      },
      bigAccent: el.querySelector(".card-big")?.classList.contains("accent"),
      bigMono: el.querySelector(".card-big")?.classList.contains("mono"),
      tracking: { big: tracking(".card-big"), title: tracking(".card-title"), sub: tracking(".card-sub"), label: tracking(".stat-label") },
    };
  };

  const flash = (btn, label) => {
    const slot = btn.querySelector(".btn-label");
    if (!slot) return;
    const was = slot.textContent;
    slot.textContent = label[0].toUpperCase() + label.slice(1);
    if (label === "blocked") bar.dataset.error = "allow pop-ups to open X";
    else btn.classList.add("is-done");
    setTimeout(() => {
      slot.textContent = was;
      btn.classList.remove("is-done");
      if (label === "blocked") delete bar.dataset.error;
    }, 1600);
  };

  const run = (fn) => async () => {
    if (busy || privateCard()) return;
    busy = true;
    syncActions();
    bar.classList.add("is-busy");
    try {
      await fn();
    } catch (err) {
      // A failed export should read as a shrug, not a dead button.
      console.warn("share failed", err);
      bar.dataset.error = "could not build the image";
      setTimeout(() => { delete bar.dataset.error; }, 2000);
    } finally {
      busy = false;
      syncActions();
      bar.classList.remove("is-busy");
    }
  };

  const save = async () => {
    const snapshot = model(cards[idx]);
    const blob = await renderShareCard(snapshot);
    const title = snapshot.title || "card";
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    downloadBlob(blob, `yearn-wrapped-${payload.period.year}-${slug}.png`);
    return blob;
  };

  bar.querySelector('[data-action="download"]').addEventListener("click", run(async () => {
    await save();
    flash(bar.querySelector('[data-action="download"]'), "saved");
  }));

  bar.querySelector('[data-action="copy"]').addEventListener("click", run(async () => {
    const btn = bar.querySelector('[data-action="copy"]');
    // Save the image if the browser cannot write it to the clipboard.
    const blob = await renderShareCard(model(cards[idx]));
    if (await copyBlob(blob)) flash(btn, "copied");
    else { downloadBlob(blob, `yearn-wrapped-${payload.period.year}-card.png`); flash(btn, "saved"); }
  }));

  // Post: the caption comes off the card on screen, so the words and the image a
  // person pastes say the same thing. window.open stays in the click gesture (no
  // await before it) or the popup blocker eats it.
  bar.querySelector('[data-action="post"]').addEventListener("click", run(async () => {
    const btn = bar.querySelector('[data-action="post"]');
    const m = model(cards[idx]);
    const stamp = m.stamp ? ` (${String(m.stamp).toLowerCase()})` : "";
    // The link is bare: a deep link would publish the wallet address in the post
    // text itself, which the export just went out of its way not to do.
    const link = APP_URL.href;
    const head = `${m.big} ${m.summary ? `${m.line} ` : ""}${m.title}${stamp}`.replace(/\s+/g, " ").trim();
    const caption = `${head.length + link.length > 260 ? `${head.slice(0, 220).trimEnd()}…` : head} ${link}`;
    const win = window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(caption)}`,
      "_blank",
      "noopener",
    );
    if (win) {
      flash(btn, "opened");
    } else {
      // Popup blocked: the caption goes on the clipboard so the post can still be
      // pasted instead of the button doing nothing.
      try {
        await navigator.clipboard.writeText(caption);
        flash(btn, "copied");
      } catch {
        flash(btn, "blocked");
      }
    }
  }));
}

startBoot();

// Leaving the deck (the brand link, or "run another address"): the cards pull back
// behind a closing veil, so the landing's fade-in reads as the second half of one
// move instead of two unrelated fades. Navigation waits one short beat, and normal
// link behaviour (new tab, middle click, modified click) is left untouched.
{
  const veil = document.createElement("div");
  veil.className = "deck-veil";
  veil.setAttribute("aria-hidden", "true");
  document.body.appendChild(veil);
  let leaving = false;
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a.brand, a.entry-sample");
    if (!link || leaving || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    leaving = true;
    document.body.classList.add("is-exiting");
    setTimeout(() => { window.location.href = link.href; }, reducedMotion ? 0 : 340);
  });
}

loadPayload().then((result) => {
  try {
    if (result.payload) {
      const payload = result.payload;
      yearLabel.textContent = payload.period.year;
      cards = buildCards(payload);
    } else {
      sourceLabel.textContent = result.notFound ? "no history for this address" : "recap unavailable";
      cards = [errorCard(!!result.notFound)];
    }
  } catch {
    result = { failed: true };
    deck.replaceChildren();
    sourceLabel.textContent = "recap unavailable";
    cards = [errorCard(false)];
  }
  cards.forEach((el, i) => {
    el.setAttribute("role", "group");
    const title = (el.querySelector(".card-title")?.textContent || "").trim();
    el.setAttribute("aria-label", `slide ${i + 1} of ${cards.length}${title ? `: ${title}` : ""}`);
  });
  deck.setAttribute("aria-label", `your year in yVaults, ${cards.length} slides`);
  dotsEl.innerHTML = cards.map(() => '<span class="dot"></span>').join("");
  dots = [...dotsEl.children];
  wireShare(result.payload);
  show(0);
  hideBoot();
});
