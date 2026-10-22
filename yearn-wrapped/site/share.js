import { chartPalette, chartScale } from "./charts.js";

// Compose the slide's final text and computed colors into a 1200×630 image.
export const SHARE_W = 1200;
export const SHARE_H = 630;
const SANS = "'Aeonik', system-ui, sans-serif";
const MONO = "'Aeonik Mono', ui-monospace, monospace";
let lockup;
function loadLockup() {
  return lockup ||= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { lockup = null; reject(new Error("lockup unavailable")); };
    image.src = "assets/yearn-wrapped-lockup.svg";
  });
}

function wrap(ctx, text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text || "").split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(trial).width > width) { lines.push(line); line = word; }
    else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}

function font(ctx, size, mono = false, bold = false, tracking = 0) {
  ctx.letterSpacing = `${size * tracking}px`;
  ctx.font = `${bold ? 700 : 400} ${size}px ${mono ? MONO : SANS}`;
}

function fit(ctx, text, width, size, mono = false, bold = false, tracking = 0) {
  font(ctx, size, mono, bold, tracking);
  while (ctx.measureText(text).width > width && size > 18) font(ctx, --size, mono, bold, tracking);
  return size;
}

function headline(ctx, model, x, y, width, size) {
  size = fit(ctx, model.big, width, size, model.bigMono, true, model.tracking.big);
  const measured = ctx.measureText(model.big).width;
  x += (width - measured) / 2;
  ctx.fillStyle = model.colors.primary;
  if (model.bigAccent && measured) {
    const gradient = ctx.createLinearGradient(x, 0, x + measured, 0);
    gradient.addColorStop(0.28, model.colors.primary);
    gradient.addColorStop(0.92, model.scene[0]);
    ctx.fillStyle = gradient;
  }
  ctx.fillText(model.big, x, y + size * 0.85);
  return size * 1.1;
}

function paragraph(ctx, text, x, y, width, size, color, mono = false, draw = true, tracking = 0) {
  font(ctx, size, mono, false, tracking);
  const lines = wrap(ctx, text, width);
  if (draw) {
    ctx.fillStyle = color;
    lines.forEach((line, i) => ctx.fillText(line, x + (width - ctx.measureText(line).width) / 2, y + size * 0.85 + i * size * 1.3));
  }
  return lines.length * size * 1.3;
}

function statsRow(ctx, stats, x, y, width, scale, muted, tracking, draw = true) {
  if (!stats.length) return 0;
  const gap = 28;
  const col = (width - gap * (stats.length - 1)) / stats.length;
  const values = stats.map(s => fit(ctx, s.value, col, 30 * scale, true));
  const valueHeight = Math.max(...values) * 1.2;
  font(ctx, 14 * scale, true, false, tracking);
  const labels = stats.map(s => wrap(ctx, s.label.toUpperCase(), col));
  const labelHeight = Math.max(...labels.map(lines => lines.length)) * 18 * scale;
  if (draw) stats.forEach((s, i) => {
    const sx = x + i * (col + gap);
    font(ctx, values[i], true);
    ctx.fillStyle = s.color;
    ctx.fillText(s.value, sx + (col - ctx.measureText(s.value).width) / 2, y + valueHeight * 0.85);
    font(ctx, 14 * scale, true, false, tracking);
    ctx.fillStyle = muted;
    labels[i].forEach((line, j) => ctx.fillText(line, sx + (col - ctx.measureText(line).width) / 2, y + valueHeight + 14 * scale + j * 18 * scale));
  });
  return valueHeight + labelHeight + 6 * scale;
}

function topic(ctx, model, baseline) {
  font(ctx, 19, true, false, model.tracking.title);
  const title = model.title.toUpperCase(), titleWidth = ctx.measureText(title).width;
  const stamp = model.chartKind !== "market" && model.stamp;
  font(ctx, 14, true);
  const stampText = String(stamp || "").toUpperCase();
  const stampWidth = stamp ? ctx.measureText(stampText).width + 24 : 0;
  const x = (SHARE_W - titleWidth) / 2;
  font(ctx, 19, true, false, model.tracking.title);
  ctx.fillStyle = model.colors.title;
  ctx.fillText(title, x, baseline);
  if (stamp) {
    ctx.save(); ctx.translate(SHARE_W / 2, baseline + 30); ctx.rotate(-0.04);
    font(ctx, 14, true);
    ctx.strokeStyle = model.colors.stamp; ctx.fillStyle = model.colors.stamp; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-stampWidth / 2, -15, stampWidth, 30, 6); ctx.stroke();
    ctx.fillText(stampText, -stampWidth / 2 + 12, 5); ctx.restore();
  }
}

function details(ctx, items, x, y, width, scale, color, draw) {
  if (!items.length) return 0;
  if (items.every(item => item.length === 1)) {
    return paragraph(ctx, items.flat().join(" · "), x, y, width, 16 * scale, color, true, draw);
  }
  const rowHeight = 24 * scale;
  if (draw) items.forEach(([label, value], i) => {
    const rowWidth = Math.min(width, 720);
    const left = x + (width - rowWidth) / 2;
    fit(ctx, label, rowWidth * 0.45, 16 * scale, true);
    ctx.fillStyle = color; ctx.fillText(label, left, y + i * rowHeight + 14 * scale);
    fit(ctx, value, rowWidth * 0.5, 16 * scale, true);
    ctx.fillText(value, left + rowWidth - ctx.measureText(value).width, y + i * rowHeight + 14 * scale);
  });
  return items.length * rowHeight;
}

function activity(ctx, graph, x, y, width, scale, muted, draw) {
  const monthly = graph.kind === "monthly";
  const plotWidth = Math.min(width, 800), plotHeight = 86 * scale;
  const left = x + (width - plotWidth) / 2;
  const captionHeight = graph.title ? 25 * scale : 0;
  const bottom = y + captionHeight + plotHeight;
  if (draw) {
    if (graph.title) paragraph(ctx, graph.title, x, y, width, 14 * scale, muted, true);
    const max = Math.max(1, ...graph.items.flatMap(item => [item.incoming, item.outgoing || 0]));
    const col = plotWidth / graph.items.length;
    graph.items.forEach((item, i) => {
      const cx = left + col * (i + 0.5);
      const h = Math.max(0, item.incoming / max * plotHeight);
      if (monthly) {
        const out = Math.max(0, item.outgoing / max * plotHeight);
        ctx.fillStyle = graph.outgoing; ctx.fillRect(cx - col * 0.31, bottom - out, col * 0.62, out);
      }
      const colors = item.peak ? graph.peakColors : graph.colors;
      const gradient = ctx.createLinearGradient(0, bottom - Math.max(2, h), 0, bottom);
      gradient.addColorStop(0, colors[0]); gradient.addColorStop(1, colors.at(-1));
      ctx.fillStyle = gradient;
      const barWidth = col * (monthly ? 0.30 : 0.72);
      ctx.fillRect(cx - barWidth / 2, bottom - (monthly ? h : Math.max(2, h)), barWidth, monthly ? h : Math.max(2, h));
      if (monthly) paragraph(ctx, item.label, cx - col / 2, bottom + 7 * scale, col, 12 * scale, muted, true);
    });
    if (monthly) {
      font(ctx, 13 * scale, true);
      const widths = graph.labels.map(label => ctx.measureText(label).width + 22 * scale);
      let keyX = x + (width - widths.reduce((sum, w) => sum + w, 0) - 24 * scale) / 2;
      graph.labels.forEach((label, i) => {
        ctx.strokeStyle = graph.keyColors[i]; ctx.lineWidth = 3 * scale;
        ctx.beginPath(); ctx.moveTo(keyX, bottom + 33 * scale); ctx.lineTo(keyX + 14 * scale, bottom + 33 * scale); ctx.stroke();
        ctx.fillStyle = muted; ctx.fillText(label, keyX + 22 * scale, bottom + 37 * scale);
        keyX += widths[i] + 24 * scale;
      });
    } else graph.labels.forEach((label, i) => {
      font(ctx, 12 * scale, true); ctx.fillStyle = muted;
      const tx = left + i * plotWidth / (graph.labels.length - 1);
      ctx.fillText(label, tx - ctx.measureText(label).width / 2, bottom + 18 * scale);
    });
  }
  return captionHeight + plotHeight + (monthly ? 45 : 25) * scale;
}

function chart(ctx, model, box) {
  const points = (model.chart || []).filter(p => p && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  if (points.length < 2) return;
  const second = model.chartSecond?.filter(p => p && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
  const dual = second?.length > 1;
  const market = model.chartKind === "market";
  const palette = chartPalette(model.scene, model.chartKind, model.marketUp);
  const scale = chartScale(points, model.chartKind, dual);
  const X = t => box.x + scale.x(t) * box.w;
  const Y = (v, s) => box.y + box.h - s.y(v) * box.h;
  const gradient = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
  palette.stops.forEach(([at, color]) => gradient.addColorStop(at, color));
  if (!market) {
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(box.x, Y(scale.base, scale)); ctx.lineTo(box.x + box.w, Y(scale.base, scale)); ctx.stroke();
    ctx.setLineDash([]);
  }
  const line = (series, s, color, dashed) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = dashed ? 2 : 3;
    ctx.lineJoin = "round";
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath();
    series.forEach((p, i) => { const x = X(p[0]), y = Y(p[1], s); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
  };
  line(points, scale, gradient, false);
  if (dual) line(second, chartScale(second, model.chartKind, true, true), palette.comparison, true);
  const last = points.at(-1);
  ctx.fillStyle = model.colors.primary;
  ctx.beginPath(); ctx.arc(X(last[0]), Y(last[1], scale), 4, 0, Math.PI * 2); ctx.fill();
  if (market) {
    if (dual) {
      font(ctx, 14, true);
      let x = box.x;
      for (const [name, color] of [[model.chartAsset, palette.stops[0][1]], ["your vaults", palette.comparison]]) {
        ctx.fillStyle = color; ctx.fillRect(x, box.y - 47, 14, 3);
        ctx.fillStyle = model.colors.muted; ctx.fillText(name, x + 23, box.y - 41);
        x += ctx.measureText(name).width + 60;
      }
      ctx.fillText("each line uses its own scale", box.x, box.y - 14);
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    font(ctx, 12, true);
    ctx.fillStyle = model.colors.muted;
    months.forEach((month, i) => {
      if (i >= points[0][0] && i <= last[0]) ctx.fillText(month, X(i) - ctx.measureText(month).width / 2, box.y + box.h + 26);
    });
  }
}

// Optional decoration never competes with the data or its qualifiers.
function background(ctx, model) {
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  const glow = ctx.createRadialGradient(880, 480, 20, 880, 480, 700);
  glow.addColorStop(0, model.scene[0]); glow.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.17; ctx.fillStyle = glow; ctx.fillRect(0, 0, SHARE_W, SHARE_H); ctx.globalAlpha = 1;
  let seed = 20260101;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 80; i++) {
    const x = rand() * SHARE_W, y = rand() * SHARE_H;
    ctx.globalAlpha = 0.08 + rand() * 0.16;
    ctx.fillStyle = model.scene[0]; ctx.beginPath(); ctx.arc(x, y, 0.6 + rand(), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export async function renderShareCard(model) {
  await document.fonts.ready;
  const brand = await loadLockup();
  // A fresh canvas also keeps simultaneous callers from sharing mutable pixels.
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W; canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  const pad = 64, width = SHARE_W - pad * 2;
  background(ctx, model);
  ctx.drawImage(brand, pad, 44, 32 * brand.width / brand.height, 32);
  font(ctx, 17, true); ctx.fillStyle = model.colors.muted;
  const year = String(model.year);
  ctx.fillText(year, SHARE_W - pad - ctx.measureText(year).width, 67);
  const market = model.chartKind === "market";
  if (market) {
    topic(ctx, model, 140);
    // The market card is a visual summary: one figure, two facts, one chart.
    headline(ctx, model, pad, 197, 515, 94);
    statsRow(ctx, model.stats.slice(0, 2), pad, 371, 495, 1, model.colors.muted, model.tracking.label);
    chart(ctx, model, { x: 650, y: 248, w: 470, h: 225 });
  } else if (model.chart?.length > 1) {
    topic(ctx, model, 140);
    let y = 169;
    y += paragraph(ctx, model.chartTitle, pad, y, width, 16, model.colors.muted, true) + 18;
    chart(ctx, model, { x: pad + 4, y, w: width - 8, h: 160 });
    y += 184;
    y += paragraph(ctx, model.line, pad, y, width, 25, model.colors.line) + 15;
    if (model.sub) y += paragraph(ctx, model.sub, pad, y, width, 17, model.colors.sub, true) + 12;
    statsRow(ctx, model.stats, pad, y, width, 0.9, model.colors.muted, model.tracking.label);
  } else {
    // Measure the complete composition before drawing: no silent line truncation.
    const compose = (scale, draw, start = 0) => {
      let y = start;
      if (model.big) {
        const size = fit(ctx, model.big, width, (model.graph ? 82 : 104) * scale, model.bigMono, true, model.tracking.big);
        y += draw ? headline(ctx, model, pad, y, width, size) : size * 1.1;
        y += 13 * scale;
      }
      for (const [key, size, mono] of [["line", model.big ? 28 : 56, false], ["sub", 17, true]]) {
        if (model[key]) y += paragraph(ctx, model[key], pad, y, width, size * scale, model.colors[key], mono, draw, model.tracking[key] || 0) + 13 * scale;
      }
      if (model.stats.length) {
        y += 8 * scale;
        y += statsRow(ctx, model.stats, pad, y, width, scale, model.colors.muted, model.tracking.label, draw) + 18 * scale;
      }
      if (model.graph) y += activity(ctx, model.graph, pad, y, width, scale, model.colors.muted, draw) + 14 * scale;
      if (model.details.length) y += details(ctx, model.details, pad, y, width, scale, model.colors.muted, draw) + 12 * scale;
      if (model.quip) {
        y += 5 * scale;
        y += paragraph(ctx, model.quip, pad, y, width, 23 * scale, model.colors.quip, false, draw);
      }
      return y - start;
    };
    const headingHeight = model.stamp ? 82 : 50;
    let scale = 1;
    while (compose(scale, false) > 436 - headingHeight && scale > 0.65) scale -= 0.025;
    const top = 112 + (436 - compose(scale, false) - headingHeight) / 2;
    topic(ctx, model, top + 18);
    compose(scale, true, top + headingHeight);
  }
  // The shared link deliberately contains no wallet identity or query parameters.
  const link = new URL(model.link, location.href);
  font(ctx, 15, true); ctx.fillStyle = model.colors.muted;
  ctx.fillText(link.host + link.pathname.replace(/\/$/, ""), pad, 590);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("canvas encode failed")), "image/png"));
}

/** Copy the PNG to the clipboard. False means the browser refused or cannot. */
export async function copyBlob(blob) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (err) {
    return false;
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for Safari to start the download before the object dies.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
