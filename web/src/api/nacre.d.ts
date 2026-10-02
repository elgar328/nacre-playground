// The user script's world — the types a script sees, as documentation (the editor
// does not typecheck yet).
//
// Everything here is injected into the script's scope; scripts import nothing.

type Vec2 = [number, number];
type Vec3 = [number, number, number];

/** A world sketch plane constant: `XY`, `YZ`, `ZX`. */
declare const XY: PlaneToken;
declare const YZ: PlaneToken;
declare const ZX: PlaneToken;
declare class PlaneToken {}

/** The three world axes: `X`, `Y`, `Z`. They read normals like any direction
 * (`face.normal.isClose(Z)`) **and** they are what a call that *states* an axis takes. */
declare const X: Axis;
declare const Y: Axis;
declare const Z: Axis;
declare class Dir {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Approximate comparison for *selection* (never a geometric judgment). */
  isClose(other: Dir, tol?: number): boolean;
}
/** A world axis — the narrower thing a statement asks for. A measured `face.normal` is a
 * `Dir` and not one of these, which is the point: an arbitrary direction would be a
 * *tilted* cylinder, and the kernel refuses those at the first boolean. */
declare class Axis extends Dir {
  /** Nominal marker — never written, never read. Without it `Axis` would be
   * *structurally* a `Dir` (it adds no members), so `cylinder({ axis: face.normal })`
   * would typecheck and the door this class exists to be would not close. */
  private readonly isAWorldAxis: never;
}

/** A solid value: zero or more disjoint bodies. Operations return new values; the
 * original stays usable (the build copies before consumption). */
declare class Solid {
  translate(offset: Vec3): Solid;
  rotateX(deg: number, opts?: { pivot?: "center" | Vec3 }): Solid;
  rotateY(deg: number, opts?: { pivot?: "center" | Vec3 }): Solid;
  rotateZ(deg: number, opts?: { pivot?: "center" | Vec3 }): Solid;
  mirror(plane: PlaneToken, opts?: { offset?: number }): Solid;
  copy(): Solid;
  /** Pick vertices by appearance (report f64); state them by name. */
  vertices(): VertexList;
  /** Pick faces by appearance; pad/pocket take the picks. */
  faces(): FaceList;
  /** Its bodies, each usable as a value of its own — a boolean can answer with several
   * (two parts that only touch are two parts). Counting is free; taking one costs a copy. */
  bodies(): BodyList;
}

declare class BodyList {
  /** The body at `i`; negative counts from the end, as `Array.prototype.at` does. */
  at(i: number): Solid;
  readonly length: number;
  [Symbol.iterator](): Iterator<Solid>;
}

declare class Plane {} // a datum value — never consumed

declare class VertexPick {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** This vertex's coordinate to `places` decimal places, worked out from its definition
   * rather than read from the report cache — a diagnostic. Ask for `places` and you get
   * `places`; the kernel raises its own precision until they are determined. */
  digits(places: number): string;
}
declare class VertexList {
  nearest(p: Vec3): VertexPick;
  /** The answer is read for its **truth**, not required to be a boolean — the same
   * rule `Array.prototype.filter` keeps. Declared `boolean`, the ordinary
   * `f.normal?.isClose(Z)` would not type-check: it is `boolean | undefined` on a curved
   * face. */
  filter(pred: (v: VertexPick) => unknown): VertexPick[];
  readonly length: number;
}

declare class FacePick {
  readonly normal: Dir | null; // null on curved faces — skip those
  readonly center: { x: number; y: number; z: number };
  readonly area: number;
}
declare class FaceList {
  /** Truthiness, for the reason `VertexList.filter` gives. */
  filter(pred: (f: FacePick) => unknown): FaceList;
  maxBy(key: (f: FacePick) => number): FacePick;
  readonly length: number;
}

declare function cuboid(arg?: { size: Vec3; center?: Vec3; corner?: Vec3 }): Solid;


declare function cylinder(arg?: {
  r?: number;
  d?: number;
  h?: number;
  axis?: Axis;
  base?: Vec3;
  center?: Vec3;
}): Solid;

declare function fuse(...solids: Solid[]): Solid;
declare function cut(base: Solid, ...tools: Solid[]): Solid;
declare function common(...solids: Solid[]): Solid;

declare function translate(s: Solid, offset: Vec3): Solid;
declare function rotateX(s: Solid, deg: number, opts?: { pivot?: "center" | Vec3 }): Solid;
declare function rotateY(s: Solid, deg: number, opts?: { pivot?: "center" | Vec3 }): Solid;
declare function rotateZ(s: Solid, deg: number, opts?: { pivot?: "center" | Vec3 }): Solid;
/** Reflect in a world plane, moved `offset` along its own normal — the same sense
 * `plane(XY, { offset })` uses. A reflection is *in a plane*, so a plane is what it
 * takes. Only the three world planes: the kernel reflects in a coordinate plane, so a
 * tilted mirror plane is not something this can say. */
declare function mirror(
  s: Solid,
  plane: PlaneToken,
  opts?: { offset?: number },
): Solid;
declare function copy(s: Solid): Solid;

/** Every plane form. The statement's orientation is the extrude's `+`. */
declare function plane(base: PlaneToken, opts?: { offset?: number; origin?: Vec3 }): Plane;
declare function plane(base: Plane, opts: { offset: number }): Plane;
declare function plane(spec: { origin: Vec3; xPoint: Vec3; yHint: Vec3 }): Plane;
declare function plane(spec: { through: [VertexPick, VertexPick, VertexPick] }): Plane;

/** A sketch to draw on — the pen (`moveTo…close`) and the shortcuts (`rect`, `circle`).
 * `close()` finishes a path, not the sketch: keep drawing until something uses it.
 * Generated code drives the pen too — there is no order-free entrance. */
declare function sketch(plane: PlaneToken | Plane): Sketch;

/** Pure data; extruding never consumes it. Drawing on it after it has been used is an
 * error — a solid already made from it cannot change under it. */
declare class Sketch {
  moveTo(start: Vec2): this;
  /** `fillet` rounds a right-angle corner between straight lines; `chamfer` cuts any corner. */
  lineTo(to: Vec2, corner?: { chamfer?: number; fillet?: number }): this;
  /** From where the pen stands, about `center`, turning `sweep` degrees (positive = +x
   * toward +y; multiples of 90 today). */
  arc(a: { center: Vec2; sweep: number }): this;
  /** Draws the closing line unless the pen is already at the start; the sketch is usable
   * from here and can still be drawn on. */
  close(corner?: { chamfer?: number; fillet?: number }): this;
  /** A corner treatment here applies to all four corners. */
  rect(c1: Vec2, c2: Vec2, corner?: { chamfer?: number; fillet?: number }): this;
  /** A whole circle by radius or diameter — a hole or an island by nesting. */
  circle(a: { center: Vec2; r?: number; d?: number }): this;
}

/** dist > 0 along the plane's stated normal; negative goes the other way (world-axes
 * planes only — a tilted plane's opposite frame is the user's statement to make);
 * `[lo, hi]` straddles the plane. */
declare function extrude(s: Sketch, dist: number | [number, number]): Solid;

/** The sketch's coordinates are read in the face's own plane frame — for an
 * axis-aligned face, in-plane world coordinates (draw near `face.center`). */
declare function pad(face: FacePick, sketch: Sketch, dist: number): Solid;
declare function pocket(face: FacePick, sketch: Sketch, dist: number): Solid;

/** A colour: `"#rgb"`, `"#rrggbb"`, or a CSS colour name (`"red"`, `"slategray"`).
 * Case does not matter. The app refuses anything else rather than letting the renderer
 * paint white without saying so. */
type Colour = string;

/** Scene-wide defaults. Merges field by field, so several calls stack up; it says nothing
 * about *what* is drawn — that is `display`'s alone. */
type Appearance = {
  color?: Colour;
  opacity?: number;
  width?: number;
  edges?: false | true | Colour | { color?: Colour; opacity?: number; width?: number };
};

declare function style(spec: Appearance): void;

/** Where the camera is, and through what lens. Merges field by field like `style`. */
declare function view(spec: {
  from?: "top" | "bottom" | "front" | "back" | "left" | "right" | "iso" | Vec3;
  at?: Vec3;
  zoom?: number;
  projection?: "ortho" | "perspective";
  /** Degrees, 0–180 — a perspective view's only. */
  fov?: number;
}): void;

/** Say something in words; it lands in the output panel, not the browser's console. */
declare function print(...args: unknown[]): void;

/** Explicit display — turns the automatic draw-the-leaves rule off.
 *
 * A sketch is drawable too, and the appearance is the same set of fields `style` sets
 * scene-wide — both read them with one function. Spelling a narrower pair here made the
 * cheat sheet's own lines fail to type-check against the declarations shipped beside them
 * (`display(sk, …)` and `display(x, { edges })`, both of which the app takes). */
declare function display(...args: (Solid | Sketch | Appearance)[]): void;
