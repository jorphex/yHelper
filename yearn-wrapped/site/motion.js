// motion.js · the site's motion language.
//
// One shared rAF loop, critically damped springs for anything the pointer
// touches. Presentation is owned by the landing startup gate. No library, no
// build step, one compositor-friendly transform per animated element.
//
// Contract with hero.js: this file never writes to #stage. The 3D scene owns
// that canvas and reads the pointer itself, so there is exactly one pointer
// consumer per surface.

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");

// A spring is the only easing here: physically believable settle, no bounce
// past the resting point, and it stays smooth when the pointer direction
// reverses mid-flight (k = stiffness, damping = critical).
class Spring {
  constructor(value = 0, k = 220) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.k = k;
  }

  step(dt) {
    const c = 2 * Math.sqrt(this.k);
    this.v += (this.k * (this.target - this.x) - c * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const tickers = new Set();
let last = 0;
let raf = 0;

function frame(now) {
  const dt = Math.min(0.032, (now - last) / 1000) || 0.016;
  last = now;
  for (const tick of tickers) tick(dt);
  raf = tickers.size ? requestAnimationFrame(frame) : 0;
}

function addTicker(tick) {
  tickers.add(tick);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function removeTicker(tick) {
  tickers.delete(tick);
}

// Magnetic pull: the control leans toward the cursor, then releases. Deliberately
// tiny. At pull 0.28 / reach 12 the button moved more than the pointer expected and
// people reported chasing it; the panel tilt moves underneath it at the same time,
// so the two add up. This is a lean of at most 3px, not a commute.
function magnetic(el, { pull = 0.06, reach = 3, radius = 56 } = {}) {
  const x = new Spring(0, 260);
  const y = new Spring(0, 260);
  const tick = (dt) => {
    const dx = x.step(dt);
    const dy = y.step(dt);
    el.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)`;
    if (Math.abs(x.target - dx) < 0.05 && Math.abs(y.target - dy) < 0.05
      && Math.abs(x.v) < 0.05 && Math.abs(y.v) < 0.05) {
      x.x = x.target;
      y.x = y.target;
      if (x.target === 0 && y.target === 0) {
        el.style.transform = "";
        el.classList.remove("magnetized");
        removeTicker(tick);
      }
    }
  };
  const onMove = (event) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    if (Math.abs(dx) > box.width / 2 + radius || Math.abs(dy) > box.height / 2 + radius) {
      if (x.target !== 0 || y.target !== 0) {
        x.target = 0;
        y.target = 0;
        addTicker(tick);
      }
      return;
    }
    x.target = Math.max(-reach, Math.min(reach, dx * pull));
    y.target = Math.max(-reach, Math.min(reach, dy * pull * 0.7));
    el.classList.add("magnetized");
    addTicker(tick);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
}

// Pointer tilt plus a specular highlight that tracks the cursor. Written as
// custom properties so the gradient stays in CSS and only two numbers cross
// the JS boundary per frame.
function tilt(el, { max = 3, lift = 10 } = {}) {
  const rx = new Spring(0, 160);
  const ry = new Spring(0, 160);
  const h = new Spring(0, 200);
  let point = { x: 0.5, y: 0.5 };
  const tick = (dt) => {
    const x = rx.step(dt);
    const y = ry.step(dt);
    const k = h.step(dt);
    el.style.transform =
      `perspective(1200px) rotateX(${(-x * max).toFixed(3)}deg) rotateY(${(y * max).toFixed(3)}deg)`
      + ` translate3d(0, ${(k * -lift).toFixed(2)}px, 0)`;
    el.style.setProperty("--mx", `${(point.x * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(point.y * 100).toFixed(1)}%`);
    el.style.setProperty("--glow", k.toFixed(3));
  };
  const onMove = (event) => {
    const box = el.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    point = { x: Math.max(0, Math.min(1, px)), y: Math.max(0, Math.min(1, py)) };
    rx.target = -(point.y - 0.5) * 2;
    ry.target = (point.x - 0.5) * 2;
    h.target = 1;
    addTicker(tick);
  };
  const onLeave = () => {
    rx.target = 0;
    ry.target = 0;
    h.target = 0;
    addTicker(tick);
  };
  el.addEventListener("pointermove", onMove, { passive: true });
  el.addEventListener("pointerleave", onLeave, { passive: true });
}

function boot() {
  if (reduced.matches || !canHover.matches) return;
  for (const el of document.querySelectorAll("[data-magnet]")) magnetic(el);
  // The panel leans too. Past about a degree the lean reads as the buttons moving on
  // their own, which is what people mean when they say they are chasing them.
  for (const el of document.querySelectorAll("[data-tilt]")) tilt(el, { max: 1, lift: 4 });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
