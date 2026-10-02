// The Step log's wire types — the TypeScript twin of nacre-kit's `step.rs` vocabulary,
// in serde's default (externally tagged) encoding. The kit is the truth; these types
// mirror it field for field, snake_case included.

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type Anchor = { Center: Vec3 } | { Corner: Vec3 };
/** Where a cylinder sits — its own two spellings: a round thing has no corner. */
export type CylAnchor = { Center: Vec3 } | { Base: Vec3 };
export type KitBool = "Fuse" | "Cut" | "Common";
export type KitAxis = "X" | "Y" | "Z";
export type Pivot = "Origin" | "Center" | { At: Vec3 };
export type MirrorPlane = { normal: KitAxis; offset: number };
export type WorldPlane = "XY" | "YZ" | "ZX";
export type PlaneRef = { World: WorldPlane } | { Value: number };

/** A resolved vertex reference — stable within one step log. */
export type VertexRef = { of: number; vertex: number };
/** A resolved face reference — VertexRef's twin for faces. */
export type FaceRef = { of: number; face: number };

export type PlaneSpec =
  | { World: WorldPlane }
  | { WorldAt: { base: WorldPlane; origin: Vec3 } }
  | { Points: { origin: Vec3; x_point: Vec3; y_hint: Vec3 } }
  | { Offset: { base: number; dist: number } }
  | { Through: { vertices: [VertexRef, VertexRef, VertexRef] } };

export type Corner = { Fillet: number } | { Chamfer: number };

/** A pen stroke: a line to a point (with its corner treatment), or an arc from where the
 * pen stands about `center`, turning `sweep` degrees — positive is +x toward +y in the
 * sketch's frame (counter-clockwise seen from its normal side); multiples of 90 today. */
export type SketchSeg =
  | { LineTo: { to: Vec2; corner: Corner | null } }
  | { Arc: { center: Vec2; sweep: number } };

/** How a circle's size was written — kept as written; the kit halves a diameter exactly. */
export type CircleSize = { Radius: number } | { Diameter: number };

export type PenPath = {
  start: Vec2;
  segs: SketchSeg[];
  close_corner: Corner | null;
};

/** One closed path of a sketch: a pen path, or a whole circle. (Lines and arcs come only
 * through the pen, never loose with their starts stated: the pen is the grammar, and the
 * kernel takes each path as one ring.) */
export type Path = { Pen: PenPath } | { Circle: { center: Vec2; size: CircleSize } };

export type Dist = { One: number } | { Both: [number, number] };

export type EdgeStyle = {
  color: string | null;
  opacity: number | null;
  /** Screen pixels. */
  width: number | null;
};
/** Serde's spelling of the enum: `"Off"`, or `{ On: EdgeStyle }`. */
export type Edges = "Off" | { On: EdgeStyle };
export type Style = {
  color: string | null;
  opacity: number | null;
  width: number | null;
  edges: Edges | null;
};

export type Step =
  | { Cuboid: { size: Vec3; at: Anchor } }
  | { Cylinder: { radius: number; height: number; at: CylAnchor; axis: KitAxis } }
  | { Boolean: { kind: KitBool; args: number[] } }
  | { Translate: { src: number; offset: Vec3 } }
  | { Rotate: { src: number; axis: KitAxis; deg: number; pivot: Pivot } }
  | { Mirror: { src: number; plane: MirrorPlane } }
  | { Copy: { src: number } }
  | { Body: { src: number; index: number } }
  | { Plane: { spec: PlaneSpec } }
  | { Sketch: { plane: PlaneRef; paths: Path[] } }
  | { Extrude: { sketch: number; dist: Dist } }
  | { Pad: { face: FaceRef; sketch: number; dist: number } }
  | { Pocket: { face: FaceRef; sketch: number; dist: number } }
  | { Display: { targets: number[]; style: Style | null } };
