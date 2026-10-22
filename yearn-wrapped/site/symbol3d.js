// symbol3d.js · the yearn mark as a real 3D object, shared by the landing hero,
// the deck's boot loader and the share-card renderer.
//
// The silhouette comes from site/assets/yearn-symbol-contour.json, which
// tools/trace_symbol.py reconstructs from the official PNG (see BUILD.md for the
// fidelity check). Nothing here should reshape the brand: the glyph pieces are
// emitted in one shared image-space origin, so re-centering a single mesh breaks
// the alignment between the Y and the band.

import * as THREE from "three";

// Normalized footprint: the JSON rings live in [-1,1] and the glyph itself is
// about 0.62 wide, so 1.28 is what makes it fill its intended box.
export const SYMBOL_BOUND = 1.28;

export function shapeFromRing(ring) {
  const shape = new THREE.Shape();
  ring.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  return shape;
}

// Brand-coloured reflection environment instead of three's neutral room: the
// symbol picks up yearn blue on one side and yearn green on the other. It also
// avoids pulling in the room's texture loader, which 404s on a static host.
export function buildEnvScene() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x05070c);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const panel = (hex, intensity, x, y, z, sx, sy, sz) => {
    const color = new THREE.Color(hex).multiplyScalar(intensity);
    const mesh = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    env.add(mesh);
  };
  panel(0x0657e9, 4.2, 4.2, 1.4, 2.2, 7, 7, 0.4);    // yearn blue key
  panel(0x14f195, 1.6, -4.6, -0.6, -2.2, 7, 5, 0.4); // yearn green rim
  panel(0xffffff, 1.4, 0, 5.2, 0, 9, 0.4, 9);        // top sheen
  panel(0x0a0a0a, 1.0, 0, -5.2, 0, 9, 0.4, 9);       // floor
  return env;
}

export function symbolMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf0f5ff,
    metalness: 0.9,
    // Sharp speculars are what make the mark read as polished metal. Above about
    // 0.15 the highlights smear into a matte cast, which is the "something is
    // sitting over it" look.
    roughness: 0.07,
    envMapIntensity: 2.3,
  });
}

// Promise<Group> of the extruded mark, centered on its own origin.
//
// The ring is built as two depth-slabs rather than one solid extrusion. The glyph
// body passes *through* the ring, and one solid ring hides that crossing behind its
// front face: the mark then reads as a flat glyph with a glossy plate over it,
// whichever way the camera looks. Slabbing the ring leaves a 0.02 air gap in front
// of and behind the body, so the body reads continuous in front, inside the gap and
// behind, and the air keeps the coplanar faces from z-fighting.
//
// The glyph body stays a single extrusion so it never shows a seam.
const RING_VERTEX_MIN = 64;   // trace_symbol.py emits the body at 10, the ring at ~482
const DEPTH = 0.3;
const AIR = 0.02;

function extrude(shape, depth) {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.04,
    bevelSegments: 6,
    // The ring is a circle. Few segments per curve drew it as a polygon and the
    // facets caught the light as flat steps; 24 reads as a smooth edge.
    curveSegments: 24,
  });
}

export async function buildSymbol(jsonUrl = "assets/yearn-symbol-contour.json", material = symbolMaterial()) {
  const data = await (await fetch(jsonUrl)).json();
  const group = new THREE.Group();
  const half = DEPTH / 2;
  for (const s of data.shapes) {
    const shape = shapeFromRing(s.outer);
    for (const hole of s.holes || []) shape.holes.push(shapeFromRing(hole));
    const isRing = (s.outer || []).length >= RING_VERTEX_MIN;
    if (!isRing) {
      const mesh = new THREE.Mesh(extrude(shape, DEPTH), material);
      mesh.position.z = -half;
      group.add(mesh);
      continue;
    }
    // ExtrudeGeometry spans z in [0, depth], so each slab is placed by hand.
    const front = new THREE.Mesh(extrude(shape, DEPTH - AIR), material);
    front.position.z = half - (DEPTH - AIR);
    const back = new THREE.Mesh(extrude(shape, DEPTH - AIR), material);
    back.position.z = -half;
    group.add(front, back);
  }
  group.scale.setScalar(SYMBOL_BOUND);
  return group;
}
