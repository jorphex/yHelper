// nebula.js · one aurora definition, two surfaces.
//
// The landing runs this through three.js (it already has a renderer, bloom and
// a camera to anchor the glow under the symbol). The deck runs it through raw
// WebGL so a slideshow does not pull in 160KB of 3D library for one quad.
// Same shader, same colours, so the two pages read as one place.

export const NEBULA_VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Raw-WebGL vertex shader (gl_Position only; three.js supplies uv automatically).
export const NEBULA_VS_GL = `
precision mediump float;
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const NEBULA_FS = `
uniform float uTime;
uniform vec2 uGlow;
uniform float uIntensity;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(2.6, 1.7);
  float t = uTime * 0.04;
  float warp = fbm(p + vec2(t, -t * 0.6));
  float clouds = fbm(p * 1.35 + vec2(warp * 0.95, warp * -0.65) + vec2(-t * 0.45, t * 0.22));
  clouds = pow(clouds, 2.1);
  float glow = exp(-pow(length((uv - uGlow) * vec2(1.3, 1.0)) * 2.1, 2.0));
  vec3 col = vec3(0.0);
  col += vec3(0.045, 0.15, 0.42) * clouds * 1.55;           // yearn blue body
  col += vec3(0.03, 0.30, 0.20) * pow(clouds, 2.7) * 0.85;  // teal in the crests
  col += vec3(0.05, 0.17, 0.46) * glow * 0.8;
  col *= smoothstep(1.12, 0.22, length(uv - 0.5));          // edges stay black
  col *= uIntensity;                                        // portrait dims it: copy reads first
  gl_FragColor = vec4(col, 1.0);
}
`;

// Deck variant: the composer is skipped on this surface, so encode by hand and
// declare precision (only the vertex shader gets it for free).
export const NEBULA_FS_GL = `precision mediump float;
` + NEBULA_FS.replace(
  "  gl_FragColor = vec4(col, 1.0);",
  `  col = col * (col + 0.074) / (col * (col + 0.864) + 0.072); // sRGB encode
  gl_FragColor = vec4(col, 1.0);`,
);

// startDeckNebula: the quiet twin of the hero's plane. One fullscreen quad, no
// library, no animation under reduced motion (it draws a single frame).
export function startDeckNebula(canvas, { reduced = false } = {}) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: false });
  if (!gl) return () => {};

  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("aurora shader:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, NEBULA_VS_GL);
  const fs = compile(gl.FRAGMENT_SHADER, NEBULA_FS_GL);
  if (!vs || !fs) return () => {};

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("aurora link:", gl.getProgramInfoLog(program));
    return () => {};
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = {
    time: gl.getUniformLocation(program, "uTime"),
    glow: gl.getUniformLocation(program, "uGlow"),
    intensity: gl.getUniformLocation(program, "uIntensity"),
  };
  gl.uniform2f(u.glow, 0.5, 0.5);
  gl.uniform1f(u.intensity, 1);
  gl.clearColor(0, 0, 0, 0);

  let raf = 0;
  let start = performance.now();
  const clock = () => (reduced ? 18 : (performance.now() - start) / 1000);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.floor(canvas.clientWidth * dpr) || 1;
    const h = Math.floor(canvas.clientHeight * dpr) || 1;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      // Keep the aurora's aspect stable so the noise never stretches.
      gl.uniform2f(u.glow, 0.5, 0.5);
    }
  };

  const frame = () => {
    resize();
    gl.uniform1f(u.time, clock());
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduced) raf = requestAnimationFrame(frame);
  };

  const onVisibility = () => {
    if (reduced) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      // Resume without dumping the elapsed time into one giant step.
      start = performance.now() - 18000;
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (reduced) {
    // One still frame, but a viewport change still has to redraw it.
    window.addEventListener("resize", () => frame());
  }
  frame();

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVisibility);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
  };
}
