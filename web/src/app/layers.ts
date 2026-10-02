// Which of two things at the same depth is drawn.
//
// A depth buffer cannot order two fragments that are at the same depth — and when
// floating point makes them differ by a step here and there, the winner changes from
// pixel to pixel, which is what flickering dashes are. So the order is stated
// here rather than discovered there:
//
//   **Everything drawn belongs to a layer, and the layers are ordered. A tie in
//      depth is settled by the layer, never by the depth buffer.**
//
// Separate numbers, each chosen while looking at one pair — faces pushed back to let
// edges read, the grid pulled forward to survive a part's base — leave the pairs nobody
// looked at unordered, which is how edges and sketch lines come to fight.
//
// The layer decides a depth bias, and nothing else. `renderOrder` is a different
// question (which translucent thing blends over which) and is left where it is: with
// distinct biases the depths are never equal, so the depth test decides the same way
// whatever order things are drawn in.

import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

/** Bottom to top. A later layer wins a tie against every earlier one. */
export const LAYER = {
  /** Solid faces. Lowest: a line has to read against the surface it belongs to. */
  faces: 0,
  /** The ground. Above faces, so a part resting on z=0 keeps the ground drawn across
   * its base — which reads as sitting on it rather than having sunk through. */
  grid: 1,
  /** A model's real edges. Above the ground, so a box's base edges stay its own. */
  edges: 2,
  /** Sketch lines. Above edges: a sketch is on screen because it was asked for by name,
   * and where it coincides with an edge it is the more particular thing to say. */
  sketch: 3,
  /** Failure markers. Highest — the app pointing at where a build failed; its material
   * also ignores the depth buffer, so a failure inside or behind a body stays visible. */
  marker: 4,
} as const;

/** How far apart two neighbouring layers stand, in depth-buffer terms.
 *
 * Not a number picked to taste. The widest gap any pair has needed so far is the
 * grid against a part's base face — an enormous quad whose depth varies enough across
 * itself that a single unit was not enough, and it was measured up to four (plus one
 * of slope) — and that gap is exactly what is reproduced here. So no existing pair's
 * margin shrinks, and every new neighbouring pair inherits a distance already known to
 * be sufficient. Rounding this down to, say, four units would quietly narrow the
 * grid-against-base-face margin that is the reason for the number in the first place.
 */
const STEP = { factor: 2, units: 5 };

/** A layer as material settings — shaped to spread straight into a constructor. */
export function layerBias(layer: number): {
  polygonOffset: true;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;
} {
  return {
    polygonOffset: true,
    // Negative is toward the camera: the higher the layer, the further forward.
    polygonOffsetFactor: -layer * STEP.factor,
    polygonOffsetUnits: -layer * STEP.units,
  };
}

/** A surface on a layer. */
export function layeredMesh(
  layer: number,
  opts: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ ...opts, ...layerBias(layer) });
}

/** A fat line on a layer.
 *
 * Polygon offset is nominally a fill feature, and these are lines — but a fat line is
 * drawn as a pair of screen-facing triangles, and the renderer applies the offset from
 * the material without asking what primitive it belongs to. Since those triangles face
 * the camera their depth slope is about zero, so the constant term is what acts, which
 * is the predictable half of the two. */
export function layeredLine(
  layer: number,
  opts: ConstructorParameters<typeof LineMaterial>[0],
): LineMaterial {
  return new LineMaterial({ ...opts, ...layerBias(layer) });
}
