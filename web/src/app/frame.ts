// Framing arithmetic — the part of the viewport that can be wrong silently.
//
// A camera distance chosen from the model's size alone ignores the *shape* of the
// canvas, and clips the model as soon as the canvas is not roughly square: it cuts the
// demo plate off on a wide desktop window, and a sheet that shrinks the
// viewport makes every shape from tall-and-thin to wide-and-flat routine.

/** Which lens the viewport is wearing, and enough of its state to say how big the
 * world looks. `distance` is camera-to-target; `halfHeight` and `zoom` belong to the
 * orthographic frustum. */
export interface ViewGeometry {
  ortho: boolean;
  distance: number;
  fovDeg: number;
  halfHeight: number;
  zoom: number;
}

/** How much world the view spans, in world units, at the point being looked at.
 *
 * This is the quantity the grid and the depth range actually need. Under a
 * perspective lens it happens to be proportional to the camera's distance, which is
 * why distance can stand in for it there. Under an orthographic lens the
 * coincidence breaks — dollying changes nothing, `zoom` changes everything — and a
 * grid sized from distance would freeze at one cell size however far you zoomed. */
export function viewSpan(v: ViewGeometry): number {
  if (v.ortho) return (2 * v.halfHeight) / Math.max(v.zoom, 1e-6);
  return 2 * v.distance * Math.tan((v.fovDeg * Math.PI) / 360);
}

/** The orthographic half-height at which a sphere of `radius` fits both fields —
 * `fitDistance`'s twin. There is no distance to solve for: a sphere projects to a
 * circle of its own radius whatever the distance, so the frustum is the whole answer,
 * widened when the canvas is taller than it is wide. */
export function fitHalfHeight(radius: number, aspect: number, margin = 1.15): number {
  return radius * margin * Math.max(1, 1 / Math.max(aspect, 1e-6));
}

/** The distance at which a sphere of `radius` fits both the vertical and the
 * horizontal field of view, with a little room to breathe. */
export function fitDistance(
  radius: number,
  vFovDeg: number,
  aspect: number,
  margin = 1.15,
): number {
  const vFov = (vFovDeg * Math.PI) / 180;
  // The horizontal field follows from the vertical one and the canvas shape.
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 1e-6));
  // Whichever field is tighter is the one that would clip.
  const tight = Math.min(vFov, hFov);
  return (radius / Math.sin(tight / 2)) * margin;
}
