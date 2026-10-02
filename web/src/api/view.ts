// Where you are looking from.
//
// Like `style(...)`, `view(...)` is **not a step**: it makes nothing, the order of two
// calls does not matter, and the last word on each field wins. A step log alone
// therefore does not describe the camera — the same consequence, written down once
// more, that the scene's styling carries.
//
// The vocabulary and its rules live here, next to the syntax rather than next to the
// renderer, because the seven names and the roll convention are things a *script*
// means; the viewport only carries them out.

/** A point or a direction, in world coordinates. */
export type Vec3 = [number, number, number];

export const VIEW_NAMES = [
  "top",
  "bottom",
  "front",
  "back",
  "left",
  "right",
  "iso",
] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export type Projection = "ortho" | "perspective";

/** What `view(...)` has said about the camera so far — every field optional, since a
 * script may say only the one it cares about. */
export type SceneView = {
  from?: ViewName | Vec3;
  at?: Vec3;
  zoom?: number;
  projection?: Projection;
  fov?: number;
};

/** The same, with the defaults filled in: what the viewport is actually asked for. */
export interface ViewSpec {
  from: ViewName | Vec3;
  /** What to centre on. `null` means the model's own centre. */
  at: Vec3 | null;
  /** A multiplier on the automatic framing — 1.2 is 20% bigger on screen. Not a
   * distance: the canvas and the model are different sizes on every screen, and a
   * distance would tie the script to one of them. */
  zoom: number;
  projection: Projection;
  /** Degrees, and only meaningful under a perspective projection. */
  fov: number;
  /** Which of the above the script actually *said*, as opposed to inherited from the
   * defaults. It is the difference between "the script has an opinion about the
   * camera" and "the script never mentioned it", and the two deserve opposite
   * treatment — see `cameraShouldMove`. */
  said: { any: boolean; from: boolean };
}

export const DEFAULT_VIEW: ViewSpec = {
  from: "iso",
  at: null,
  zoom: 1,
  projection: "ortho",
  fov: 50,
  said: { any: false, from: false },
};

export function resolveView(scene: SceneView): ViewSpec {
  return {
    from: scene.from ?? DEFAULT_VIEW.from,
    at: scene.at ?? DEFAULT_VIEW.at,
    zoom: scene.zoom ?? DEFAULT_VIEW.zoom,
    projection: scene.projection ?? DEFAULT_VIEW.projection,
    fov: scene.fov ?? DEFAULT_VIEW.fov,
    said: {
      any: Object.values(scene).some((v) => v !== undefined),
      from: scene.from !== undefined,
    },
  };
}

const NAMED: Record<ViewName, Vec3> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  // A true isometric: the three axes meet the screen at equal angles. It is also where
  // the viewport opens, so the opening picture is exactly `view({ from: "iso" })`.
  iso: [1, -1, 1],
};

/** Never exactly at a pole, where the azimuth stops meaning anything. */
const POLE = 1e-3;

/** The roll convention, in one number.
 *
 * Two angles fix where the camera stands, but a third freedom is left over: how far it
 * is rolled about the line of sight. Nothing here writes it — `camera.up` is +Z and
 * `OrbitControls.update()` derives the roll from it every frame, exactly as it does
 * while dragging. That construction is degenerate at the poles, though: looking
 * straight down, "world up" projects to a point and cannot say which way is up on
 * screen. The limit it resolves to depends on the azimuth you approach from, so a top
 * view has to *choose* one — and a script cannot borrow the camera's current azimuth
 * without making the same script draw different pictures on different runs.
 *
 * This azimuth is the choice, and it is measured rather than reasoned: it puts +Y up
 * and +X right in a top view, and +X right with −Y up seen from below — the way a part
 * is drawn and the way it reads when flipped over. */
const POLE_AZIMUTH = -Math.PI / 2;

/** Where the camera stands, in the orbit's own angles. */
export function anglesFor(from: ViewName | Vec3): { theta: number; phi: number } {
  const v = typeof from === "string" ? NAMED[from] : from;
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  const raw = Math.acos(Math.min(1, Math.max(-1, v[2] / length)));
  const atPole = raw < POLE || raw > Math.PI - POLE;
  return {
    theta: atPole ? POLE_AZIMUTH : Math.atan2(v[1], v[0]),
    phi: Math.min(Math.max(raw, POLE), Math.PI - POLE),
  };
}

/** The unit direction from the target to the camera — the angles above, spelled as a
 * vector, so `from: [0,0,1]` and `from: "top"` land in exactly the same place. */
export function directionFor(from: ViewName | Vec3): Vec3 {
  const { theta, phi } = anglesFor(from);
  const s = Math.sin(phi);
  return [Math.cos(theta) * s, Math.sin(theta) * s, Math.cos(phi)];
}

/** One run's reason to move the camera, or the absence of one. */
export interface ViewFrame {
  spec: ViewSpec;
  /** Whatever identifies the extent being framed — compared, never read. */
  bounds: string;
}

/** Does the camera have a reason to move?
 *
 * **What the script said is honoured every run; what it did not say is left to the
 * mouse.** A `view(...)` in the source is an instruction, and an instruction you can
 * only obey once is not one — orbit away from a stated front view, press Run, and you
 * are back at the front. But a script that never mentions the camera has no opinion to
 * enforce, so pressing Run there must not throw away the angle you just orbited to;
 * that camera moves only when it has to — the first run, or a model whose extent
 * changed and would otherwise hang off the screen.
 *
 * The direction is a narrower question than the move: `at` and `zoom` re-frame from
 * wherever you are looking, and only `from` is a statement about which way to face.
 *
 * Note what is *not* here: any comparison with what the last run asked for. Such
 * comparisons — move when the spec changed — are unnecessary once a stated view applies
 * every run, because every *change* to a stated view is already a stated view. All they
 * could still decide is the run right after a `view(...)` is deleted, and the answer
 * there follows from the principle rather than from a diff: nothing is asking for a
 * camera, so nobody moves it. The previous run is needed for one thing only — whether
 * the model is a different size than it was. */
export function cameraShouldMove(
  previous: { bounds: string } | null,
  next: ViewFrame,
): { move: boolean; useSpecDirection: boolean } {
  return {
    move: !previous || next.spec.said.any || previous.bounds !== next.bounds,
    useSpecDirection: !previous || next.spec.said.from,
  };
}
