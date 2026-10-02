// The cheat sheet's content — data only, no DOM: a summary of the grammar you can hold
// in view while typing.
//
// **The whole sheet is one small program.** Its rows are concatenated and run by
// `tests/cheatsheet.test.ts`, so the string shown on screen is the string that
// executes — a summary that stops being true fails the build instead of quietly
// misleading someone. Two consequences for whoever edits this file:
//   · declare each name once and reuse it (a second `let part` is a syntax error), and
//   · keep the groups in dependency order, which is also the order a reader wants.

export interface CheatRow {
  /** Shown as code — and executed. */
  code?: string;
  note: string;
}

export interface CheatGroup {
  title: string;
  rows: CheatRow[];
}

export const CHEAT: CheatGroup[] = [
  {
    title: "Shapes",
    rows: [
      { code: "let plate = cuboid({ size: [40, 20, 5] });", note: "size, centred on the origin" },
      {
        code: "let post = cuboid({ size: [6, 6, 30], corner: [0, 0, 0] });",
        note: "or anchored by its min-XYZ corner (`center:` for the middle)",
      },
      {
        code: "let pin = cylinder({ d: 6, h: 30, base: [0, 0, -5] });",
        note: "`r:` or `d:`, anchored by `center:` (the default, like `cuboid`) or `base:` (bottom circle) — sugar for a circle sketch extruded",
      },
      {
        code: "let lug = cylinder({ r: 3, h: 20, axis: X });",
        note: "stands along X, Y or Z — Z if unsaid. A name, not a string; tilt with `rotateX/Y/Z` instead",
      },
    ],
  },
  {
    title: "Booleans — any number of arguments",
    rows: [
      { code: "let block = fuse(plate, post);", note: "union of all of them" },
      { code: "let holed = cut(block, cuboid({ size: [6, 6, 60] }));", note: "the first minus every other" },
      { code: "let lens = common(holed, cuboid({ size: [30, 30, 30] }));", note: "intersection of all" },
      { code: "let drilled = cut(cuboid({ size: [20, 20, 6] }), pin);", note: "a round hole — the drill may stop flush with the faces or run past them" },
    ],
  },
  {
    title: "Moving, copying",
    rows: [
      { code: "let moved = lens.translate([12, 0, 0]);", note: "every unary op is a method and a global" },
      { code: "let turned = moved.rotateZ(30, { pivot: \"center\" });", note: "also rotateX and rotateY; pivot: \"center\" or a point" },
      { code: "let flipped = mirror(turned, YZ);", note: "a world plane — XY, YZ or ZX" },
      {
        code: "let half = mirror(turned, YZ, { offset: 3 });",
        note: "that plane moved 3 along its normal, the sense plane(YZ, { offset: 3 }) uses",
      },
      { code: "let twin = flipped.copy();", note: "for keeping both on screen — reuse copies by itself" },
    ],
  },
  {
    title: "Planes",
    rows: [
      { note: "XY · YZ · ZX are the world planes; X · Y · Z are directions for picking." },
      { code: "let top = plane(XY, { offset: 5 });", note: "parallel, 5 along the normal" },
      { code: "let slant = plane({ origin: [0,0,0], xPoint: [1,0,1], yHint: [0,1,0] });", note: "three points: origin, +X, and where +Y leans" },
    ],
  },
  {
    title: "Sketches — you draw lines and arcs, the kernel finds the shape",
    rows: [
      {
        code: "let outline = sketch(XY)\n  .moveTo([0, 0])\n  .lineTo([40, 0])\n  .lineTo([40, 20], { chamfer: 6 })\n  .lineTo([0, 20])\n  .close();",
        note: "the pen: close() draws the last line for you",
      },
      { code: "let win = sketch(top).rect([4, 4], [12, 12]);", note: "shortcut; nesting decides holes and islands" },
      {
        code: "let gen = sketch(XY).moveTo([0, 0]);\n[[8, 0], [8, 8], [0, 8]].forEach(([x, y]) => gen.lineTo([x, y])); gen.close();",
        note: "generated code drives the pen too — there is no order-free entrance; endpoints meet by construction",
      },
      { note: "A sketch you have not used yet is drawn on its plane; extruding it hands the screen to the solid." },
      { code: "display(gen, { color: \"#e0b060\", width: 2 });", note: "for a sketch, colour and width are its lines" },
      {
        code: "let rounded = sketch(XY).rect([0, 0], [30, 10], { fillet: 5 });",
        note: "a fillet rounds a right-angle corner (on lineTo/close too); two that meet are a half circle — this one is a slot",
      },
      {
        code: "let holes = sketch(XY)\n  .moveTo([0, 0])\n  .lineTo([40, 0], { fillet: 4 })\n  .lineTo([40, 20], { fillet: 4 })\n  .lineTo([0, 20], { fillet: 4 })\n  .close({ fillet: 4 })\n  .circle({ center: [10, 10], r: 3 })\n  .circle({ center: [30, 10], d: 6 });",
        note: "close() finishes the path, not the sketch — keep drawing on it until something uses it; `r:` or `d:`; a circle inside a path is a hole, by nesting",
      },
      {
        code: "let cam = sketch(XY)\n  .moveTo([25, 5])\n  .arc({ center: [20, 5], sweep: 90 })\n  .lineTo([0, 10])\n  .arc({ center: [0, 5], sweep: 180 })\n  .close();",
        note: "arc: from the pen, about a centre, by degrees (positive = +x toward +y; multiples of 90); close() draws the last line",
      },
      {
        code: "let slot = sketch(XY)\n  .moveTo([0, -5])\n  .lineTo([30, -5])\n  .arc({ center: [30, 0], sweep: 180 })\n  .lineTo([0, 5])\n  .arc({ center: [0, 0], sweep: 180 })\n  .close();",
        note: "the last arc brings the pen home, so close() draws nothing more — the same slot as `rounded`",
      },
      { note: "Today: sweeps are multiples of 90°, fillets round right angles between axis-aligned lines, and two arcs may not meet at a corner. Washers, slots and filleted plates fuse, cut and intersect with other solids; a side plane that runs exactly through a fillet's axis still declines by name." },
    ],
  },
  {
    title: "Extruding",
    rows: [
      { code: "let part = extrude(outline, 5);", note: "along the plane's stated normal" },
      { code: "let plug = extrude(win, [-2, 6]);", note: "[lo, hi] is where the sweep starts and ends along the plane's normal — any two ordered numbers, so [3, 9] saves a translate" },
    ],
  },
  {
    title: "Picking by appearance, then padding",
    rows: [
      { code: "let cap = part.faces().filter(f => f.normal?.isClose(Z)).maxBy(f => f.center.z);", note: "faces carry normal · center · area (report values)" },
      { code: "let boss = sketch(XY).rect([28, 4], [36, 12]);", note: "a pad's sketch is read in the face's own plane" },
      { code: "part = pad(cap, boss, 3);", note: "pocket(face, sketch, depth) carves instead" },
      { code: "let corner = part.vertices().nearest([0, 0, 5]);", note: "vertices are picked the same way…" },
      { code: "let n = part.bodies().length;", note: "a boolean can answer with several solids — counting them is free" },
      { code: "let first = part.bodies().at(0);", note: "…and at(i) takes one as a value of its own (negative counts from the end)" },
      { code: "let tilted = plane({ through: [corner, part.vertices().nearest([40, 0, 5]), part.vertices().nearest([0, 20, 5])] });", note: "…and named, not measured: three of them state a plane exactly" },
    ],
  },
  {
    title: "Showing",
    rows: [
      { note: "By default whatever no later step consumes is drawn." },
      { code: "display(part, { color: \"#7fb2c8\", opacity: 1 });", note: "explicit display turns the default off; a colour is \"#rgb\", \"#rrggbb\" or a CSS name like \"red\"" },
      { code: "style({ edges: { width: 1.5 } });", note: "defaults for the scene — says nothing about what is drawn" },
      { code: "display(part, { edges: { color: \"#0b1015\", opacity: 0.8 } });", note: "edges: false · true · a colour · or { color, opacity, width }" },
      { code: "print(\"bodies:\", part.bodies().length);", note: "say it in words — the output panel (>_) has it, and keeps what a failed run printed" },
    ],
  },
  {
    title: "Looking at it",
    rows: [
      { code: "view({ from: \"front\", zoom: 1.2 });", note: "top · bottom · front · back · left · right · iso — or a direction [x, y, z]" },
      { code: "view({ projection: \"perspective\", fov: 35, at: [0, 0, 5] });", note: "parallel by default; `at` re-centres; `zoom` multiplies the automatic framing" },
      { note: "A view you state is applied on every Run — orbit away and Run puts you back. Say nothing about the camera and it stays yours; it only re-frames when the model changes size." },
    ],
  },
];

/** The line under the sheet: this is a summary, and the editor's completions say the rest. */
export const CHEAT_FOOTER =
  "A summary. The editor completes every name and shows each call's signature.";

/** Every word the sheet shows, for the staleness tests. */
export function cheatText(): string {
  return CHEAT.flatMap((g) => [g.title, ...g.rows.map((r) => `${r.code ?? ""} ${r.note}`)]).join(
    "\n",
  );
}

/** The sheet as a runnable script: every row that carries code, in order. */
export function cheatScript(): string {
  return CHEAT.flatMap((g) => g.rows)
    .filter((r) => r.code)
    .map((r) => r.code)
    .join("\n");
}
