// The greeting script — the syntax's vocabulary in a dozen lines: pen + chamfer,
// value semantics (hole is reused after being consumed), an n-ary cut, a face picked
// by appearance, a pad on it. A vitest case runs this very string.
//
// The holes are cylinders standing exactly on the plate — cap flush with its base,
// top flush with its face — the drill says what the hole is, not a cylinder overshooting
// the plate. Note `f.normal?` — a drilled part has a curved face, and a curved face has
// no single normal.
//
// The holes sit at mid-plate (y = 10), where they belong. The boss's own wall at y = 12
// is parallel to the cylinder's axis, and the gate asks about that wall's face, not its
// infinite plane — the face is 20 away, at the far end.

export const demo = `let s = sketch(XY)
  .moveTo([0, 0])
  .lineTo([40, 0])
  .lineTo([40, 20], { chamfer: 6 })
  .lineTo([0, 20])
  .close();
let plate = extrude(s, 5);

let hole = cylinder({ d: 6, h: 5, base: [8, 10, 0] });
let part = cut(plate, hole, hole.translate([12, 0, 0]));

let top = part.faces().filter(f => f.normal?.isClose(Z)).maxBy(f => f.center.z);
let boss = sketch(XY).rect([28, 4], [36, 12]);
part = pad(top, boss, 3);

display(part);
`;
