// The ground grid — drawn by a shader, not by line geometry.
//
// A `GridHelper` is a fixed set of segments: it ends somewhere, its cells are one
// size forever, and its 1px lines alias into moiré as they recede. A fragment shader
// asks a different question per pixel — "how close is this to a grid line, in *screen*
// terms" — which gives an even, anti-aliased weight at any zoom, a fade instead of an
// edge, and cells that can change size as the camera pulls back.
//
// **The level decision lives here in TypeScript, not in GLSL.** If the shader picked
// the cell sizes, a test for that rule could only ever test a *copy* of it. The CPU
// picks `{ minor, major, blend }` each frame and the shader draws lines at the sizes
// it is handed — so the pure function below is the rule itself, and the GLSL stays
// short enough to read.

import * as THREE from "three";
import { LAYER, layerBias } from "./layers";

export interface GridLevels {
  /** The finer spacing, in world units — always a power of ten. */
  minor: number;
  /** The coarser spacing: ten minor cells. */
  major: number;
  /** 0 at the start of a decade, approaching 1 at its end — how far the minor lines
   * have faded out on their way to being replaced by the major ones. */
  blend: number;
}

/** How much world a 50° perspective view spans per unit of camera distance. The two
 * constants below are tuned against distance under that lens; they are restated in
 * terms of the span so an orthographic view — where distance says nothing about
 * apparent size — asks the same question. Expressed as the conversion rather than as a
 * rounded number, the perspective picture is the same *by construction*, which is what
 * makes the restatement testable as an equality. */
const SPAN_PER_DISTANCE = 2 * Math.tan((50 * Math.PI) / 360);

/** How many world units one decade of view span is worth — larger is a coarser grid.
 * Exported so a test can find a decade boundary by reading the rule rather than
 * keeping its own copy of the number. */
export const BASE = 12 * SPAN_PER_DISTANCE;

/** How big a cell should be when the view spans `span` world units.
 *
 * The rule is scale invariance: ten times the span gives ten times the spacing with
 * the *same* blend, so zooming shows the same picture at every scale and the decade
 * boundaries pass without a jump. */
export function gridLevels(span: number, base = BASE): GridLevels {
  const d = Math.max(span, 1e-6) / base;
  const decade = Math.floor(Math.log10(d));
  const minor = Math.pow(10, decade);
  return { minor, major: minor * 10, blend: Math.log10(d) - decade };
}

export interface InfiniteGrid {
  mesh: THREE.Mesh;
  /** Follow the camera: re-centre, re-scale, and hand the shader this frame's cells.
   * It is told where the eye is and how much world the view spans — not which lens is
   * in front of it, which is the viewport's business and not the grid's. */
  update(eye: THREE.Vector3, span: number): void;
}

// GLSL ES 3.00, so `fwidth` is core. Compiled as 1.00 it needs an extension the
// material would have to ask for, and a derivative that quietly returns zero turns
// every line mask into 1 — a dark sheet across the whole view, which is exactly what
// "the grid and the model both vanished" looked like.
const VERTEX = /* glsl */ `
  out vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// One line weight, measured in pixels, whatever the zoom: `fwidth` is how much the
// coordinate changes between neighbouring pixels, so dividing by it turns a world
// distance into a screen distance.
const FRAGMENT = /* glsl */ `
  precision highp float;
  in vec3 vWorld;
  out vec4 fragColor;
  uniform float uMinor;
  uniform float uMajor;
  uniform float uBlend;
  uniform float uFade;
  uniform vec3 uEye;
  uniform vec3 uMinorColor;
  uniform vec3 uMajorColor;
  uniform vec3 uXColor;
  uniform vec3 uYColor;

  // A derivative of zero would make every pixel "on a line"; floored, it makes them
  // all "infinitely far from one" instead. Failing to nothing beats failing to a wall.
  float lineMask(vec2 p, float spacing, float width) {
    vec2 cell = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
    vec2 d = cell / max(fwidth(p), vec2(1e-8));
    return 1.0 - smoothstep(0.0, width, min(d.x, d.y));
  }

  float axisMask(float coord, float width) {
    return 1.0 - smoothstep(0.0, width, abs(coord) / max(fwidth(coord), 1e-8));
  }

  void main() {
    vec2 p = vWorld.xy;

    float minor = lineMask(p, uMinor, 1.0) * (1.0 - uBlend);
    float major = lineMask(p, uMajor, 1.4);

    vec3 color = uMinorColor;
    float alpha = minor * 0.7;
    if (major > 0.0) {
      color = mix(color, uMajorColor, major);
      alpha = max(alpha, major * 0.95);
    }

    // The axes are the same lines, said louder — this is where "where is the origin"
    // is answered, so the corner gizmo never has to.
    float ax = axisMask(p.y, 1.6);
    float ay = axisMask(p.x, 1.6);
    if (ax > 0.0) { color = mix(color, uXColor, ax); alpha = max(alpha, ax * 0.9); }
    if (ay > 0.0) { color = mix(color, uYColor, ay); alpha = max(alpha, ay * 0.9); }

    // Fade to nothing well before the quad's edge, so the ground reads as endless.
    float fade = 1.0 - smoothstep(uFade * 0.35, uFade, distance(uEye.xy, p));
    alpha *= fade;
    if (alpha < 0.004) discard;
    fragColor = vec4(color, alpha);
  }
`;

/** The ground plane: one quad, re-centred under the camera every frame. */
export function makeInfiniteGrid(): InfiniteGrid {
  const uniforms = {
    uMinor: { value: 1 },
    uMajor: { value: 10 },
    uBlend: { value: 0 },
    uFade: { value: 100 },
    uEye: { value: new THREE.Vector3() },
    // Read against a near-black background (#16181d): anything much dimmer is barely
    // a shade off it, which is not subtlety, it is invisibility.
    uMinorColor: { value: new THREE.Color(0x454c58) },
    uMajorColor: { value: new THREE.Color(0x6b7482) },
    uXColor: { value: new THREE.Color(0xc4696b) },
    uYColor: { value: new THREE.Color(0x6aa870) },
  };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // The grid and a solid's base face are exactly coplanar at z = 0, and a depth
    // buffer cannot order a tie. Who wins is stated by the layer — `./layers.ts` holds
    // the ordering and the reasons, so that the numbers are not chosen here against
    // one opponent and there against another.
    ...layerBias(LAYER.grid),
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  // Transparent objects are sorted by distance, and this quad sits under the camera —
  // near enough to be drawn last, over a translucent model. It belongs underneath.
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  return {
    mesh,
    update(eye, span) {
      span = Math.max(span, 1e-3);
      const { minor, major, blend } = gridLevels(span);
      uniforms.uMinor.value = minor;
      uniforms.uMajor.value = major;
      uniforms.uBlend.value = blend;
      uniforms.uEye.value.copy(eye);

      // The quad is only a canvas for the shader: keep it centred under the eye and
      // big enough that the fade finishes long before its edge could show. The lines
      // are computed from world coordinates, so moving the quad does not move them.
      // The quad's own size matters to the depth fight: the wider it is, the more the
      // depth varies across it, so it stays as small as the fade allows.
      const radius = (span / SPAN_PER_DISTANCE) * 8;
      uniforms.uFade.value = radius * 0.45;
      mesh.scale.setScalar(radius * 2);
      mesh.position.set(eye.x, eye.y, 0);
    },
  };
}
