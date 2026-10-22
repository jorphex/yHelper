// hero.js · three.js scene: extruded yearn symbol, particle field, bloom.
// Rendered behind the landing page copy.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { NEBULA_VS, NEBULA_FS } from "./nebula.js";
import { buildEnvScene, buildSymbol } from "./symbol3d.js";

// Particle dust stays inside the brand: blue, teal, one amber accent. Purple was
// pulled after review read it as a visited link rather than light.
const PALETTE = ["#3b82f6", "#3b82f6", "#3b82f6", "#2dd4bf", "#2dd4bf",
  "#0657e9", "#0657e9", "#f59e0b", "#fafafa"].map((c) => new THREE.Color(c));

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The mark itself, its material and its reflection environment live in
// symbol3d.js so the hero, the boot loader and the share renderer all draw the
// same object.

function makeDotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function buildParticles(count) {
  const positions = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Ellipsoidal shell around and behind the symbol.
    const u = Math.random() * Math.PI * 2;
    const v = Math.acos(2 * Math.random() - 1);
    const rr = 2.4 + Math.pow(Math.random(), 0.7) * 5.6;
    base[i * 3] = rr * Math.sin(v) * Math.cos(u);
    base[i * 3 + 1] = rr * Math.cos(v) * 0.72;
    base[i * 3 + 2] = -1.2 - Math.abs(rr * Math.sin(v) * Math.sin(u)) * 0.85;
    positions[i * 3] = base[i * 3];
    positions[i * 3 + 1] = base[i * 3 + 1];
    positions[i * 3 + 2] = base[i * 3 + 2];
    phases[i] = Math.random() * Math.PI * 2;
    const c = PALETTE[(Math.random() * PALETTE.length) | 0];
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.07,
    map: makeDotTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { base, phases, count };
  return points;
}

// The second focal plane: a slow aurora behind the field, so the scene has
// atmosphere with depth instead of a black void with objects in it. The shader
// lives in nebula.js and is shared with the deck, which renders the same aurora
// through raw WebGL. Kept dim enough that the symbol stays the only bright
// thing on screen.

const NEBULA_DEPTH = -14;

function buildNebula() {
  const material = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VS,
    fragmentShader: NEBULA_FS,
    uniforms: {
      uTime: { value: 0 },
      uGlow: { value: new THREE.Vector2(0.68, 0.5) },
      uIntensity: { value: 1 },
    },
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.position.z = NEBULA_DEPTH;
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export async function createHero(canvas, { isActive = () => true } = {}) {
  // Geometry must be present in the very first scene frame.
  const symbol = await buildSymbol("assets/yearn-symbol-contour.json");
  if (!isActive()) {
    symbol.traverse((node) => { node.geometry?.dispose(); node.material?.dispose(); });
    return null;
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  renderer.setClearColor(0x0a0a0a, 1);

  const scene = new THREE.Scene();
  // Fog gives the particle field depth, but at 0.055 it also laid a dark veil
  // across the symbol itself (about 10% at camera distance), which read as a film
  // over the metal. This density keeps the depth falloff and costs the symbol 2%.
  scene.fog = new THREE.FogExp2(0x0a0a0a, 0.022);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  camera.position.set(0, 0.12, 5.8);
  camera.lookAt(0, 0, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(buildEnvScene(), 0.05).texture;

  // Rig holds the symbol and the aurora's focal framing together so layout
  // offsets move them as one.
  const rig = new THREE.Group();
  scene.add(rig);

  rig.add(symbol);

  const particles = buildParticles(2400);
  scene.add(particles);

  const nebula = buildNebula();
  scene.add(nebula);

  // Lights: the coloured environment does the heavy lifting; these add specular
  // edges so the metal reads as lit rather than flat.
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(2.5, 3.4, 4.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x0657e9, 1.6);
  rim.position.set(-3.4, -1.2, -3);
  scene.add(rim);
  const accent = new THREE.DirectionalLight(0x14f195, 1.1);
  accent.position.set(3.6, -2.6, -2.4);
  scene.add(accent);

  // A cursor-tracked glint: the chrome highlight follows the pointer, which is
  // what makes the metal feel lit by something you are holding.
  const glint = new THREE.PointLight(0xffffff, 3.2, 16, 1.6);
  glint.position.set(0, 0.1, 3.2);
  scene.add(glint);

  // The composer renders into its own buffer, which throws away the canvas's
  // hardware antialiasing unless that buffer is multisampled. Without this the
  // symbol's silhouette is jagged the moment bloom is on.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
  }));
  composer.addPass(new RenderPass(scene, camera));
  // Bloom tight and high-threshold: only true highlights flare. A wider radius or
  // lower threshold milks the whole silhouette, again looking like an overlay.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.45, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // Layout: desktop puts the symbol right of the copy. On a phone the copy block
  // owns the lower three quarters, so the symbol shrinks to an emblem in the band
  // above it and the aurora dims: text must never sit on lit metal.
  let baseScale = 1.0;
  let baseZ = 0;
  let baseX = 0, baseY = 0;

  function layout() {
    const portrait = window.innerWidth / window.innerHeight < 0.9;
    if (portrait) {
      baseScale = 0.3;
      baseZ = -1.2;
      baseX = 0; baseY = 1.62;
      rig.position.set(baseX, baseY, baseZ);
      rig.scale.setScalar(baseScale);
      bloom.strength = 0.24;
      particles.position.set(0, 1.1, 0);
      particles.scale.setScalar(0.72);
    } else {
      baseScale = 1.0;
      baseZ = 0;
      baseX = 1.2; baseY = 0;
      rig.position.set(baseX, baseY, baseZ);
      rig.scale.setScalar(baseScale);
      bloom.strength = 0.26;
      particles.position.set(0.5, 0, 0);
      particles.scale.setScalar(1);
    }
    nebula.material.uniforms.uIntensity.value = portrait ? 0.28 : 0.36;

    // Cover the frustum at the aurora's depth so it never shows a seam, and
    // put its glow under wherever the symbol actually sits.
    const depth = Math.abs(NEBULA_DEPTH - camera.position.z);
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * depth;
    nebula.scale.set(h * camera.aspect * 1.3, h * 1.3, 1);
    const anchor = new THREE.Vector3(rig.position.x, rig.position.y, 0).project(camera);
    nebula.material.uniforms.uGlow.value.set(anchor.x * 0.5 + 0.5, anchor.y * 0.5 + 0.5);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    layout();
    if (reducedMotion) composer.render();
  }
  window.addEventListener("resize", resize);
  resize();

  // Pointer parallax.
  const pointer = { x: 0, y: 0 };
  const eased = { x: 0, y: 0 };
  const movePointer = (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", movePointer);

  let disposed = false;
  let running = false;
  let raf = 0;
  // The shared curtain is opaque at 600ms, before this move reaches its limit.
  // Navigation follows that painted curtain rather than a competing timer.
  const LAUNCH_MS = 620;
  let launchStart = null;
  let launchBase = null;
  const clock = new THREE.Clock();

  function easeInCubic(t) { return t * t * t; }

  function frame() {
    if (disposed || !isActive()) return;
    const t = clock.getElapsedTime();
    const spinScale = reducedMotion ? 0 : 1;

    // Symbol: face the camera with a slow, oscillating tilt. A full spin
    // reads edge-on for a flat glyph.
    if (symbol) {
      symbol.rotation.y = reducedMotion ? 0.1 : Math.sin(t * 0.28) * 0.3 + 0.1;
      symbol.rotation.x = reducedMotion ? 0.1 : 0.1 + Math.sin(t * 0.5) * 0.07;
      symbol.position.y = reducedMotion ? 0 : Math.sin(t * 0.6) * 0.07;
    }

    // Particle drift: global rotation + per-particle sway.
    particles.rotation.y = t * 0.03 * spinScale;
    if (!reducedMotion) {
      const { base, phases, count } = particles.userData;
      const pos = particles.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const ph = phases[i];
        pos.array[i * 3] = base[i * 3] + Math.sin(t * 0.4 + ph) * 0.14;
        pos.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.3 + ph * 1.7) * 0.12;
      }
      pos.needsUpdate = true;
    }

    // Only the symbol responds to the cursor; the camera and field stay anchored.
    eased.x += (pointer.x - eased.x) * 0.04;
    eased.y += (pointer.y - eased.y) * 0.04;
    if (!reducedMotion) {
      rig.position.x = baseX + eased.x * 0.18;
      rig.position.y = baseY - eased.y * 0.12;
      rig.rotation.z = eased.x * 0.05;
      glint.position.set(eased.x * 3.4, 0.1 - eased.y * 2.6, 3.2);
    }

    // Atmosphere drifts in place, with no cursor offset or launch flare.
    const nebulaUniforms = nebula.material.uniforms;
    nebulaUniforms.uTime.value = reducedMotion ? 18 : t;

    // The symbol approaches while the shared atmosphere covers navigation.
    if (launchStart !== null && launchBase) {
      const lp = Math.min((performance.now() - launchStart) / LAUNCH_MS, 1);
      const lk = easeInCubic(lp);
      rig.position.z = launchBase.z + 2.9 * lk;
    }

    composer.render();
    if (running) raf = requestAnimationFrame(frame);
  }
  // Prepare one complete frame; animate only after the page is presented.
  frame();

  return {
    start() {
      if (running || reducedMotion || disposed) return;
      running = true;
      // Give the first frame a paint before asking the GPU for another.
      raf = requestAnimationFrame(() => {
        if (!disposed && isActive()) raf = requestAnimationFrame(frame);
      });
    },
    launch() {
      if (reducedMotion) return;
      // One-shot: called when the user commits to a year, just before navigating.
      if (launchStart !== null) return;
      launchBase = { z: rig.position.z };
      launchStart = performance.now();
    },
    dispose() {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", movePointer);
      scene.traverse((node) => { node.geometry?.dispose(); node.material?.dispose(); });
      scene.environment?.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
