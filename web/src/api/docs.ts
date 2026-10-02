// What the editor knows about the vocabulary — signatures, one-line docs, and just
// enough type information to say what a value carries.
//
// **The names are not here.** They come from the API itself: the globals from
// `Object.keys(makeApi(...))`, the methods from each class's prototype. This file
// supplies only what a program cannot know — how to say it in a sentence. A test
// compares the two lists in both directions, so a new global cannot be added without
// this file finding out.
//
// The one thing the *types* cannot supply either: several entry points take `unknown`
// on purpose, so they can refuse with a human sentence rather than a compiler's. That
// is why `options` is written out by hand — a checker would only ever say
// `view(spec: unknown)`.

export type TypeName =
  | "Solid"
  | "Sketch"
  | "Plane"
  | "WorldPlane"
  | "Dir"
  | "VertexList"
  | "FaceList"
  | "BodyList"
  | "VertexPick"
  | "FacePick"
  | "Point";

export interface OptionEntry {
  doc: string;
  /** The strings this field accepts, when it accepts only a few. */
  values?: string[];
}

export interface Entry {
  /** For a function: how it is called. */
  signature?: string;
  /** For a value (`XY`, `Z`): what it is. */
  type?: TypeName;
  doc: string;
  /** What a call produces — a type, or a map from argument count to one.
   *
   * **No entry uses the map today.** Kept because the shape of the question — "does
   * this call's answer depend on its arity?" — can return. */
  returns?: TypeName | Record<number, TypeName>;
  /** If it takes a predicate, what that predicate is handed. */
  callbackParam?: TypeName;
  /** The fields of an object argument, keyed by which argument it is. `-1` means the
   * last one, for the variadic `display`. Keyed rather than merged so that
   * `plane({ … })` and `plane(XY, { … })` do not offer each other's fields. */
  options?: Record<number, Record<string, OptionEntry>>;
}

const PIVOT: Record<string, OptionEntry> = {
  pivot: { doc: 'the point turned about — "center", or [x, y, z]' },
};

const MIRROR: Record<string, OptionEntry> = {
  offset: { doc: "move the plane this far along its own normal, as plane(…, { offset }) does" },
};

const CORNER: Record<string, OptionEntry> = {
  fillet: { doc: "round this corner with the given radius — a right angle between straight lines" },
  chamfer: { doc: "cut this corner back by the given distance" },
};

const SWEEP: OptionEntry = {
  doc: "degrees turned; positive is +x toward +y (counter-clockwise seen from the normal) — multiples of 90 today",
};

const ARC_PEN: Record<string, OptionEntry> = {
  center: { doc: "the arc's centre — where the pen stands is its start" },
  sweep: SWEEP,
};

const CIRCLE: Record<string, OptionEntry> = {
  center: { doc: "the centre" },
  r: { doc: "the radius" },
  d: { doc: "the diameter — one of r or d" },
};

const STYLE: Record<string, OptionEntry> = {
  color: {
    doc: 'face colour, or a sketch\'s line colour — "#rgb", "#rrggbb" or a CSS name like "red"',
  },
  opacity: { doc: "0 is invisible, 1 is solid" },
  width: { doc: "a sketch's line width, in screen pixels" },
  edges: {
    doc: 'false, true, a colour ("#0b1015" or a CSS name), or { color, opacity, width }',
  },
};

export const GLOBALS: Record<string, Entry> = {
  XY: { type: "WorldPlane", doc: "the world XY plane — sketch +X is X, +Y is Y, normal +Z" },
  YZ: { type: "WorldPlane", doc: "the world YZ plane — sketch +X is Y, +Y is Z, normal +X" },
  ZX: { type: "WorldPlane", doc: "the world ZX plane — sketch +X is Z, +Y is X, normal +Y" },
  X: { type: "Dir", doc: "the +X direction, for picking faces by where they face" },
  Y: { type: "Dir", doc: "the +Y direction" },
  Z: { type: "Dir", doc: "the +Z direction" },

  cuboid: {
    signature: "cuboid({ size, center | corner })",
    doc: "a box, centred on the origin unless anchored",
    returns: "Solid",
    options: {
      0: {
        size: { doc: "[x, y, z]" },
        center: { doc: "put this point at the middle" },
        corner: { doc: "put this point at the min-XYZ corner" },
      },
    },
  },
  cylinder: {
    signature: "cylinder({ r | d, h, axis, base | center })",
    doc: "a cylinder along one world axis (+Z unless told otherwise), centred on the origin unless anchored — every field has a default, so bare cylinder() is r 0.5, h 1 and fits inside cuboid()",
    returns: "Solid",
    options: {
      0: {
        r: { doc: "radius" },
        d: { doc: "diameter — exactly r × 2, for holes said the usual way" },
        h: { doc: "height, along the axis" },
        axis: { doc: "X, Y or Z — which world axis it runs along (Z)" },
        base: { doc: "put this point at the centre of the low cap, along the axis" },
        center: { doc: "put this point at the middle of the solid" },
      },
    },
  },
  fuse: { signature: "fuse(a, b, …)", doc: "the union of every argument", returns: "Solid" },
  cut: { signature: "cut(a, b, …)", doc: "the first, minus every other", returns: "Solid" },
  common: { signature: "common(a, b, …)", doc: "the intersection of every argument", returns: "Solid" },

  translate: {
    signature: "translate(solid, [dx, dy, dz])",
    doc: "move it — also a method on the value",
    returns: "Solid",
  },
  rotateX: {
    signature: "rotateX(solid, deg, { pivot })",
    doc: "turn about the X axis",
    returns: "Solid",
    options: { 2: PIVOT },
  },
  rotateY: {
    signature: "rotateY(solid, deg, { pivot })",
    doc: "turn about the Y axis",
    returns: "Solid",
    options: { 2: PIVOT },
  },
  rotateZ: {
    signature: "rotateZ(solid, deg, { pivot })",
    doc: "turn about the Z axis",
    returns: "Solid",
    options: { 2: PIVOT },
  },
  mirror: {
    signature: "mirror(solid, plane, { offset })",
    doc: "a reflection in a world plane — lengths kept, handedness flipped",
    returns: "Solid",
    options: { 2: MIRROR },
  },
  copy: {
    signature: "copy(solid)",
    doc: "a second thing, not a derived one — both stay on screen",
    returns: "Solid",
  },

  plane: {
    signature: "plane(XY | { origin, xPoint, yHint } | { through }, { offset, origin })",
    doc: "a datum plane — the same plane said twice is one plane",
    returns: "Plane",
    options: {
      0: {
        origin: { doc: "where the sketch origin sits" },
        xPoint: { doc: "a point the sketch +X axis points at" },
        yHint: { doc: "the direction sketch +Y leans toward" },
        through: { doc: "three named vertices — exact, unlike their coordinates" },
      },
      1: {
        offset: { doc: "move the origin this far along the normal" },
        origin: { doc: "put the sketch origin here" },
      },
    },
  },

  sketch: {
    signature: "sketch(plane)",
    doc: "a sketch on a plane — draw on it with the pen and the shortcuts (rect, circle)",
    returns: "Sketch",
  },
  extrude: {
    signature: "extrude(sketch, dist | [lo, hi])",
    doc: "raise a sketch along its plane's normal",
    returns: "Solid",
  },

  pad: {
    signature: "pad(face, sketch, dist)",
    doc: "add material on a face — the sketch is read in that face's own plane",
    returns: "Solid",
  },
  pocket: {
    signature: "pocket(face, sketch, depth)",
    doc: "carve into a face",
    returns: "Solid",
  },

  display: {
    signature: "display(value, …, { color, opacity, width, edges })",
    doc: "show these and nothing else — turns the automatic choice off",
    options: { [-1]: STYLE },
  },
  print: {
    signature: "print(value, …)",
    doc: "say something in words — it lands in the output panel",
  },
  style: {
    signature: "style({ color, opacity, width, edges })",
    doc: "defaults for the scene — says nothing about what is drawn",
    options: { 0: STYLE },
  },
  view: {
    signature: "view({ from, at, zoom, projection, fov })",
    doc: "where you look from — stated fields are applied on every run",
    options: {
      0: {
        from: {
          doc: "a named view, or a direction [x, y, z]",
          values: ["top", "bottom", "front", "back", "left", "right", "iso"],
        },
        at: { doc: "what to centre on — the model's own centre by default" },
        zoom: { doc: "a multiplier on the automatic framing, not a distance" },
        projection: {
          doc: "parallel by default; perspective has a field of view",
          values: ["ortho", "perspective"],
        },
        fov: { doc: "degrees — perspective only" },
      },
    },
  },
};

export const MEMBERS: Record<TypeName, Record<string, Entry>> = {
  Solid: {
    translate: { signature: "translate([dx, dy, dz])", doc: "move it", returns: "Solid" },
    rotateX: { signature: "rotateX(deg, { pivot })", doc: "turn about X", returns: "Solid", options: { 1: PIVOT } },
    rotateY: { signature: "rotateY(deg, { pivot })", doc: "turn about Y", returns: "Solid", options: { 1: PIVOT } },
    rotateZ: { signature: "rotateZ(deg, { pivot })", doc: "turn about Z", returns: "Solid", options: { 1: PIVOT } },
    mirror: { signature: "mirror(plane, { offset })", doc: "reflect it", returns: "Solid", options: { 1: MIRROR } },
    copy: { signature: "copy()", doc: "a second thing — both stay on screen", returns: "Solid" },
    vertices: { signature: "vertices()", doc: "its vertices, to pick from by appearance", returns: "VertexList" },
    faces: { signature: "faces()", doc: "its faces, to pick from by appearance", returns: "FaceList" },
    bodies: { signature: "bodies()", doc: "its bodies — a boolean can answer with several", returns: "BodyList" },
  },
  Sketch: {
    moveTo: { signature: "moveTo([x, y])", doc: "start a new path here", returns: "Sketch" },
    lineTo: { signature: "lineTo([x, y], { fillet | chamfer })", doc: "a segment, and how its corner is treated", returns: "Sketch", options: { 1: CORNER } },
    rect: { signature: "rect([x1, y1], [x2, y2], { fillet | chamfer })", doc: "a closed rectangle by two corners — a corner treatment applies to all four", returns: "Sketch", options: { 2: CORNER } },
    arc: { signature: "arc({ center, sweep })", doc: "an arc from where the pen stands, about a centre, turning sweep degrees", returns: "Sketch", options: { 0: ARC_PEN } },
    circle: { signature: "circle({ center, r | d })", doc: "a closed circle by radius or diameter — a hole or an island by nesting", returns: "Sketch", options: { 0: CIRCLE } },
    close: { signature: "close({ fillet | chamfer })", doc: "close the path — the last segment back to the start, none if the pen is already there; the sketch is usable now and can still be drawn on", returns: "Sketch", options: { 0: CORNER } },
  },
  Plane: {},
  WorldPlane: {},
  Dir: {
    x: { doc: "its X component" },
    y: { doc: "its Y component" },
    z: { doc: "its Z component" },
    isClose: { signature: "isClose(other, tol)", doc: "same direction, within a tolerance" },
  },
  VertexList: {
    nearest: { signature: "nearest([x, y, z])", doc: "the one closest to this point", returns: "VertexPick" },
    // Deliberately no `returns`: this one hands back a plain array, unlike its twin on
    // FaceList. Claiming VertexList here would be the kind of quiet lie the execution
    // lock exists to catch.
    filter: { signature: "filter(v => …)", doc: "the ones a predicate keeps — a plain array", callbackParam: "VertexPick" },
    length: { doc: "how many there are" },
  },
  BodyList: {
    // Counting is free; `at` is what records a step and copies the body, so the doc for
    // each says which one costs.
    at: { signature: "at(i)", doc: "the body at i, as a value — negative counts from the end", returns: "Solid" },
    length: { doc: "how many there are — asking costs nothing" },
  },
  FaceList: {
    filter: { signature: "filter(f => …)", doc: "the ones a predicate keeps", returns: "FaceList", callbackParam: "FacePick" },
    maxBy: { signature: "maxBy(f => …)", doc: "the one scoring highest", returns: "FacePick", callbackParam: "FacePick" },
    length: { doc: "how many there are" },
  },
  VertexPick: {
    x: { doc: "its X coordinate — for choosing, not for stating" },
    y: { doc: "its Y coordinate — for choosing, not for stating" },
    z: { doc: "its Z coordinate — for choosing, not for stating" },
    // A diagnostic, not part of the modelling vocabulary — the planned syntax overhaul may
    // rename or drop it. x/y/z above are the report cache; this asks the kernel to work the
    // coordinate out from the vertex's definition, so the digits are earned rather than a
    // printout of a rounding.
    digits: {
      signature: "digits(places)",
      doc: "its coordinate to that many decimal places, worked out exactly — ask right after picking",
    },
  },
  FacePick: {
    // `returns` on a property is what reading it gives you — so `f.normal.isClose(…)`
    // and `f.center.z` resolve one step further.
    normal: { doc: "where it faces — null on a curved face", returns: "Dir" },
    center: { doc: "its centroid", returns: "Point" },
    area: { doc: "its area" },
  },
  Point: {
    x: { doc: "its X coordinate" },
    y: { doc: "its Y coordinate" },
    z: { doc: "its Z coordinate" },
  },
};

/** Names that exist at runtime but are not the user's to call. Listed rather than
 * silently skipped, so the completeness test says out loud what is being withheld:
 * `rotate` is TypeScript-private (which is compile-time only, so it survives on the
 * prototype), and `ref` is the recorded reference a pick carries for the step log. */
export const INTERNAL: Record<string, string[]> = {
  Solid: ["rotate"],
  // The recorder's own doors: `use` is what extrude/pad/display call to take the sketch's
  // id and freeze it; `drawing`/`record` are TypeScript-private, on the prototype at runtime.
  Sketch: ["use", "drawing", "record"],
  // `ref` is the recorded reference a pick carries for the step log; `rec` is the session it
  // asks for `digits` — TypeScript-private, so on the instance at runtime like `rotate` is on
  // the prototype.
  VertexPick: ["ref", "rec"],
  FacePick: ["ref"],
};
