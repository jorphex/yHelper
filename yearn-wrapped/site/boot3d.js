// boot3d.js · the deck's loading state: the yearn mark as a physical object.
//
// Same extruded glyph as the landing hero, scaled into a 200px box and given toy
// physics: gravity, restitution off an invisible floor, and angular velocity that
// gets a fresh kick on every impact so it tumbles instead of orbiting. It is a
// loading indicator that admits the data is heavy, and it stops the instant the
// first card is ready.
//
// The floor is measured, not guessed. The bounce limits come from the camera's own
// frustum and the glyph's measured box, so the mark's lowest point lands on the
// canvas edge instead of below it; a hand-picked floor put it outside the visible
// frame and the mark read as a glyph with its bottom sliced off. That also caps the
// bounce energy, since an apex above the frame clips just as hard as a floor below.
//
// Reduced motion renders one still frame. WebGL failure or a missing contour
// leaves the CSS mark in place; the loader never depends on this file working.

import * as THREE from "three";
import { buildSymbol, buildEnvScene } from "./symbol3d.js";

const SIZE = 200;          // CSS pixels of the square stage
const EDGE_PX = 9;         // breathing room between the glyph and the canvas edge
const FILL = 0.58;         // glyph height as a share of the visible stage height
const GRAVITY = -7.6;
const RESTITUTION = 0.62;  // energy kept per bounce

export function createBootStage(canvas) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    return { ok: false, start() {}, stop() {} };
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  // 0.02, not 0.05: three caps the convolution at 20 samples and warns that a wider
  // sigma will clip, which is console noise for a gradient environment bed.
  scene.environment = pmrem.fromScene(buildEnvScene(), 0.02).texture;

  const cameraRestZ = 4.6;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 0.3, cameraRestZ);
  camera.lookAt(0, 0, 0);

  // What the camera can actually see at the glyph's plane, in world units — measured
  // at the resting distance.
  const target = new THREE.Vector3(0, 0, 0);
  const viewDist = Math.hypot(0.3, cameraRestZ);
  const halfView = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * viewDist;
  const pxToWorld = (2 * halfView) / SIZE;
  const limit = halfView - EDGE_PX * pxToWorld;

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.2, 3.2, 4.2);
  scene.add(key);
  // A fill from the camera side: the mark rolls, and without it the face goes dark on
  // the half of the rotation that turns away from the key.
  const fill = new THREE.DirectionalLight(0xdfeaff, 1.1);
  fill.position.set(0.4, 0.6, 4.4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x0657e9, 1.4);
  rim.position.set(-3, -1, -2.5);
  scene.add(rim);

  let mark = null;
  let baseScale = 1;
  let floorY = -0.4;
  let ceilY = 0.4;
  let reach = 0.4;

  // Start centered and upright to match the fallback's first frame; gravity
  // begins the bounce once the complete mark is visible.
  // Rocking on x and y plus an in-plane roll on z, rather than free tumbling: a mark
  // that spins on all three axes spends half the loop edge-on, and an edge-on yearn
  // mark is an unrecognisable metal sliver, not a logo.
  const body = {
    y: 0,
    vy: 0,
    rock: { x: 0, y: 0, tx: 0, ty: 0 },
    roll: 0,
    rollRate: 0.7,
    impacts: 0,
  };
  // Speed that just reaches the ceiling from the floor. Anything above it exits frame.
  const apexSpeed = () => Math.sqrt(2 * -GRAVITY * Math.max(0.05, ceilY - floorY) * 0.94);

  let stopped = false;
  const disposeMark = group => {
    group.traverse(node => node.geometry?.dispose());
    group.children[0]?.material?.dispose();
  };
  const ready = buildSymbol().then((group) => {
    if (stopped) { disposeMark(group); return false; }
    // Measure before choosing a size. The contour is normalized to [-1,1], but the
    // extrusion depth, the slab gap and the glyph's own off-centre mass all live
    // outside that promise, and the bounce fit depends on the real box.
    const raw = new THREE.Box3().setFromObject(group);
    const rawSize = new THREE.Vector3();
    raw.getSize(rawSize);
    baseScale = (FILL * 2 * limit) / Math.max(rawSize.y, 1e-6);
    group.scale.setScalar(baseScale);
    group.position.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(group);
    // The mark tumbles, so the vertical reach is whichever direction reaches furthest
    // from its origin, not just the box's height.
    reach = Math.max(
      -box.min.y, box.max.y, -box.min.x, box.max.x, -box.min.z, box.max.z,
    ) * 1.04;
    floorY = -(limit - reach);
    ceilY = limit - reach;
    body.y = Math.min(body.y, ceilY);
    group.userData.base = baseScale;
    mark = group;
    scene.add(group);
    group.position.y = reduced ? 0 : body.y;
    group.rotation.z = reduced ? 0 : body.roll;
    renderer.render(scene, camera);
    return true;
  }).catch(() => false);

  let raf = 0;
  let last = 0;
  let running = false;

  function step(dt) {
    body.vy += GRAVITY * dt;
    body.y += body.vy * dt;
    if (body.y <= floorY && body.vy < 0) {
      body.y = floorY;
      body.vy = -body.vy * RESTITUTION;
      body.impacts += 1;
      const cap = apexSpeed();
      // A dead bounce is a boring loader: re-inject energy and change the tumble so
      // the object never settles into a predictable loop, but never so much that the
      // apex leaves the frame.
      if (body.vy < cap * 0.45) body.vy = cap * (0.82 + Math.random() * 0.18);
      else body.vy = Math.min(body.vy, cap);
      // Each impact changes the lean and the roll, so the loop never repeats. The
      // lean stays inside ±0.5 rad, which is enough tilt to read as a thrown object
      // and little enough to keep the glyph facing the viewer.
      body.rock.tx = (Math.random() - 0.5) * 1.0;
      body.rock.ty = (Math.random() - 0.5) * 1.2;
      // Slow enough that the mark is upright often enough to be read as the yearn
      // logo, fast enough that it never looks parked.
      body.rollRate = (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.9);
    }
    if (body.y > ceilY) {
      body.y = ceilY;
      if (body.vy > 0) body.vy = 0;
    }
    if (mark) {
      const base = mark.userData.base;
      const ease = Math.min(1, dt * 5.5);
      body.rock.x += (body.rock.tx - body.rock.x) * ease;
      body.rock.y += (body.rock.ty - body.rock.y) * ease;
      body.roll += body.rollRate * dt;
      mark.position.y = body.y;
      mark.rotation.set(body.rock.x, body.rock.y, body.roll);
      // Squash on contact: the one cheat that makes a rigid mesh read as weighty.
      const contact = body.y <= floorY + 0.04;
      const squash = contact ? 0.92 : 1;
      const widen = 1 + (1 - squash) * 0.6;
      mark.scale.set(base * widen, base * squash, base * widen);
    }
  }

  function frame(now) {
    const dt = Math.min(0.032, (now - last) / 1000) || 0.016;
    last = now;
    step(dt);
    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (stopped || running || !mark) return;
    if (reduced) {
      // One composed still frame: the mark lit and centred, no motion at all.
      body.y = 0;
      mark.position.y = 0;
      mark.scale.setScalar(mark.userData.base);
      renderer.render(scene, camera);
      return;
    }
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pmrem.dispose();
    if (mark) disposeMark(mark);
    scene.environment?.dispose();
    renderer.dispose();
  }

  return { ok: true, ready, start, stop, size: SIZE, debug: () => ({ limit, reach, floorY, ceilY, baseScale, cameraZ: camera.position.z, running, stopped, y: body.y }) };
}
