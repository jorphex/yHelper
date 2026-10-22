// One scale specification for the on-screen chart and its exported image.
export function chartPalette(scene, kind, up) {
  return {
    stops: kind === "market" ? [[0, up ? "#14f195" : "#f87171"], [1, "#fafafa"]]
      : [[0, "#0657e9"], [0.55, scene[0]], [1, scene[1]]],
    comparison: "#2dd4bf",
  };
}

export function spikeDominated(points) {
  const ys = points.map((p) => Number(p[1])).filter(Number.isFinite).sort((a, b) => a - b);
  const usual = ys[Math.floor(ys.length * 0.75)] || 0;
  return ys.length >= 8 && usual > 0 && Math.max(...ys) / usual >= 4;
}

export function chartScale(points, kind, dual = false, secondary = false) {
  const xs = points.map((p) => Number(p[0]));
  const ys = points.map((p) => Number(p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const min = Math.min(...ys), max = Math.max(...ys);
  const base = kind === 'market' ? (secondary ? min : min * 0.985) : Math.min(min, 0);
  const sqrt = kind !== 'market' && !dual && spikeDominated(points);
  const span = (value) => Math.max(0, sqrt ? Math.sqrt(value - base) : value - base);
  return { base, sqrt, x: (t) => (t - x0) / ((x1 - x0) || 1), y: (v) => span(v) / (span(max) || 1) };
}
