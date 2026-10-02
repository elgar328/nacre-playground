// The recorder produces the kit's wire shapes, and scripts round-trip through
// the wasm boundary end to end (nodejs-target build).

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { queries } from "./queries";
import { executeScript } from "../src/app/runtime";

function runScript(code: string) {
  const script = executeScript(code);
  if (!script.ok) throw new Error(script.message);
  return { steps: script.steps, out: wasm.run(script.steps, undefined) };
}

describe("the recorder's wire shapes", () => {
  it("records the pen as one PenPath with corners in place", () => {
    const script = executeScript(`
      sketch(XY).moveTo([0,0]).lineTo([4,0]).lineTo([4,3], { chamfer: 1 }).lineTo([0,3]).close();
    `);
    if (!script.ok) throw new Error(script.message);
    expect(script.steps).toEqual([
      {
        Sketch: {
          plane: { World: "XY" },
          paths: [
            {
              Pen: {
                start: [0, 0],
                segs: [
                  { LineTo: { to: [4, 0], corner: null } },
                  { LineTo: { to: [4, 3], corner: { Chamfer: 1 } } },
                  { LineTo: { to: [0, 3], corner: null } },
                ],
                close_corner: null,
              },
            },
          ],
        },
      },
    ]);
  });

  it("records circles as written (r or d) and the pen's arcs as centre and sweep", () => {
    const { steps, out } = runScript(`
      let holes = sketch(XY).rect([0, 0], [40, 20]).circle({ center: [10, 10], r: 3 }).circle({ center: [30, 10], d: 6 });
      extrude(holes, 2);
      let slot = sketch(XY).moveTo([0, -5]).lineTo([30, -5]).arc({ center: [30, 0], sweep: 180 })
        .lineTo([0, 5]).arc({ center: [0, 0], sweep: 180 }).close();
      extrude(slot, 2);
    `);
    const holes = steps[0] as { Sketch: { paths: unknown[] } };
    expect(holes.Sketch.paths.slice(1)).toEqual([
      { Circle: { center: [10, 10], size: { Radius: 3 } } },
      { Circle: { center: [30, 10], size: { Diameter: 6 } } },
    ]);
    const slot = steps[2] as { Sketch: { paths: { Pen: { segs: unknown[] } }[] } };
    expect(slot.Sketch.paths[0].Pen.segs[1]).toEqual({ Arc: { center: [30, 0], sweep: 180 } });
    expect(out.ok, out.message).toBe(true);
  });

  it("rect takes a corner treatment for all four corners", () => {
    const { steps, out } = runScript(`
      let r = sketch(XY).rect([0, 0], [30, 10], { fillet: 5 });
      extrude(r, 2);
    `);
    const sk = steps[0] as {
      Sketch: { paths: { Pen: { segs: { LineTo: { corner: unknown } }[]; close_corner: unknown } }[] };
    };
    const path = sk.Sketch.paths[0].Pen;
    expect(path.segs.map((s) => s.LineTo.corner)).toEqual([{ Fillet: 5 }, { Fillet: 5 }, { Fillet: 5 }]);
    expect(path.close_corner).toEqual({ Fillet: 5 });
    expect(out.ok, out.message).toBe(true);
  });

  it("close() finishes the path, not the sketch — drawing continues until the sketch is used", () => {
    const { steps, out } = runScript(`
      let s1 = sketch(XY)
        .moveTo([-4, -3.5]).lineTo([4, -3.5], { fillet: 2 }).lineTo([4, 3.5]).lineTo([-4, 3.5]).close({ fillet: 2 })
        .circle({ center: [0, 0], r: 1.5 });
      extrude(s1, 2);
    `);
    const sk = steps[0] as { Sketch: { paths: unknown[] } };
    expect(sk.Sketch.paths.length).toBe(2);
    expect(sk.Sketch.paths[1]).toEqual({ Circle: { center: [0, 0], size: { Radius: 1.5 } } });
    expect(steps.length).toBe(2);
    expect(out.ok, out.message).toBe(true);

    const frozen = executeScript(
      `let s = sketch(XY).rect([0, 0], [2, 2]); extrude(s, 1); s.circle({ center: [1, 1], r: 0.5 });`,
    );
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.message).toContain("already been used");

    const open = executeScript(
      `let s = sketch(XY).rect([0, 0], [2, 2]).moveTo([5, 5]).lineTo([6, 5]); extrude(s, 1);`,
    );
    expect(open.ok).toBe(false);
    if (!open.ok) expect(open.message).toContain("open pen path");
  });

  it("maps two-sided extrudes and value reuse", () => {
    const { steps, out } = runScript(`
      let s = sketch(XY).rect([0,0],[2,2]);
      let both = extrude(s, [-1, 2]);
      let a = cuboid({ size: [1,1,1] });
      let b = a.translate([5,0,0]);   // a stays usable
      fuse(both, a, b);
    `);
    expect(steps[1]).toEqual({
      Extrude: { sketch: 0, dist: { Both: [-1, 2] } },
    });
    expect(out.ok).toBe(true);
  });

  it("speaks the core vocabulary end to end", () => {
    const { out } = runScript(`
      let box = cuboid({ size: [10, 20, 5], corner: [0, 0, 0] });
      let d = box.rotateY(90, { pivot: "center" });
      let e = rotateZ(d, 30, { pivot: [10, 10, 0] });
      let m = mirror(e, YZ);
      display(m, { color: "#ff0000", opacity: 0.5 });
    `);
    expect(out.ok).toBe(true);
    expect(out.rendered).toEqual([3]);
  });
});

describe("rejections arrive with the kit's words", () => {
  it("an arc off the quarter grid is refused in the kit's words", () => {
    const { out } = runScript(
      `sketch(XY).moveTo([0,0]).lineTo([4,0]).arc({ center: [4, 3], sweep: 45 }).lineTo([0,3]).close();`,
    );
    expect(out.ok).toBe(false);
    expect(out.message).toContain("multiple of 90");
  });

  it("a fillet off a right angle is refused in the kit's words", () => {
    const { out } = runScript(
      `sketch(XY).moveTo([0,0]).lineTo([4,0], { fillet: 1 }).lineTo([0,3]).close();`,
    );
    expect(out.ok).toBe(false);
    expect(out.message).toContain("right angle");
  });

  it("script-level misuse is caught before the kernel", () => {
    const script = executeScript(`extrude(cuboid(), 5);`);
    expect(script.ok).toBe(false);
    if (!script.ok) expect(script.message).toContain("takes a sketch");
  });
});

describe("the cylinder's own arguments", () => {
  const say = (code: string) => executeScript(code);

  it("records r/d/h and both anchors as the kit spells them", () => {
    const s = say(`cylinder({ d: 6, h: 30, base: [0, 0, -5] });`);
    if (!s.ok) throw new Error(s.message);
    expect(s.steps).toEqual([
      { Cylinder: { radius: 3, height: 30, at: { Base: [0, 0, -5] } , axis: "Z" } },
    ]);
    const c = say(`cylinder({ r: 2, h: 4, center: [1, 1, 1] });`);
    if (!c.ok) throw new Error(c.message);
    expect(c.steps).toEqual([
      { Cylinder: { radius: 2, height: 4, at: { Center: [1, 1, 1] } , axis: "Z" } },
    ]);
    // The bare call anchors at the *centre*, like `cuboid()` — so the unit cylinder
    // really does fit inside the unit cube, which the comment beside them claims.
    const bare = say(`cylinder();`);
    if (!bare.ok) throw new Error(bare.message);
    expect(bare.steps).toEqual([
      { Cylinder: { radius: 0.5, height: 1, at: { Center: [0, 0, 0] } , axis: "Z" } },
    ]);
  });

  // Every field has a default, so a name the API does not know would otherwise be
  // *swallowed*: `cylinder({ radius: 3 })` would build the unit cylinder and say
  // nothing. This is the one place in the API where a typo could change the part.
  it("names a field it does not know instead of building something else", () => {
    const out = say(`cylinder({ radius: 3, h: 10 });`);
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.message).toContain("does not take 'radius'");
  });

  it("refuses two spellings of one thing, and a point that is not one", () => {
    for (const [code, said] of [
      [`cylinder({ r: 1, d: 2, h: 3 });`, "r or d, not both"],
      [`cylinder({ r: 1, h: 3, base: [0,0,0], center: [0,0,0] });`, "base or center, not both"],
      [`cylinder({ r: 1, h: 3, base: [0, 0] });`, "point like"],
      [`cylinder({ r: 0, h: 3 });`, "cylinder's r must be positive, got 0"],
      [`cylinder({ r: 1, h: -3 });`, "cylinder's h must be positive, got -3"],
      // `d: "30"` must not come back as `got 30`, which reads as though 30 were not a
      // positive number. Interpolated raw, the value loses its quotes — every sibling
      // quotes it, and so does `cylinder`.
      [`cylinder({ d: "30", h: 5 });`, `cylinder's d must be positive, got "30"`],
      [`cylinder({ r: 1, h: 3, base: ["0", 0, 0] });`, `got ["0", 0, 0]`],
    ] as const) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain(said);
    }
  });

  // The axis is *stated*, so it is spelled with a name — not a string and not an
  // arbitrary direction. The last one is the one that matters: `face.normal` is a
  // tilted axis, and a tilted cylinder is refused by the kernel at its first boolean.
  // Letting the script say it would put a shape into the API that the kernel cannot
  // carry, and the failure would surface an operation later, far from its cause.
  it("the axis takes a name, not a string and not a direction off a face", () => {
    for (const code of [
      `cylinder({ r: 1, h: 3, axis: "X" });`,
      `cylinder({ r: 1, h: 3, axis: XY });`,
      `cylinder({ r: 1, h: 3, axis: 0 });`,
      `let p = cuboid({ size: [2, 2, 2] });
       cylinder({ r: 1, h: 3, axis: p.faces().maxBy(f => f.area).normal });`,
    ]) {
      // the last one selects, so it needs the build door the app hands scripts.
      const out = executeScript(code, queries);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain("axis takes X, Y or Z");
    }
    // …and the three names themselves go through.
    for (const name of ["X", "Y", "Z"]) {
      const out = say(`cylinder({ r: 1, h: 3, axis: ${name} });`);
      expect(out.ok, name).toBe(true);
      expect(out.ok ? out.steps : [], name).toEqual([
        { Cylinder: { radius: 1, height: 3, at: { Center: [0, 0, 0] }, axis: name } },
      ]);
    }
  });

  // A bare array does not say *what* it is, and `{ corner, size }` sits right beside
  // it — so the reader has to remember which one an unlabelled `[40, 20, 5]` was.
  it("cuboid says what a bare array is missing instead of guessing", () => {
    const out = say(`cuboid([40, 20, 5]);`);
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.message).toContain("cuboid takes { size: [x, y, z] }");
    // …and an object without a size, which would otherwise reach the wasm boundary and
    // come back in its words ("malformed steps: missing field `size`") rather than the API's.
    for (const code of [`cuboid({});`, `cuboid({ corner: [0, 0, 0] });`]) {
      const o = say(code);
      expect(o.ok, code).toBe(false);
      expect(o.ok ? "" : o.message, code).toContain("say a size");
    }
    // The unit box keeps its bare call.
    const unit = say(`cuboid();`);
    expect(unit.ok).toBe(true);
    expect(unit.ok ? unit.steps : []).toEqual([
      { Cuboid: { size: [1, 1, 1], at: { Center: [0, 0, 0] } } },
    ]);
  });
});

// A reflection is *in a plane*, so the argument names one — and since the plane carries
// its own offset, a spelling that names the plane's *normal* in the same argument
// position (`{ normal: "X", offset: 3 }`) is refused rather than translated.
describe("mirror names the plane it reflects in", () => {
  const say = (code: string) => executeScript(code);
  const box = `let b = cuboid({ size: [2, 2, 2] });\n`;

  // Nothing else measures this mapping. Get it backwards and the result is still a
  // plausible mirrored solid, so it fails silently — which is why it is pinned by value
  // rather than by "it built something".
  it("each world plane reflects across the axis it leaves out", () => {
    for (const [plane, normal] of [
      ["XY", "Z"],
      ["YZ", "X"],
      ["ZX", "Y"],
    ]) {
      const out = say(`${box}mirror(b, ${plane});`);
      expect(out.ok, plane).toBe(true);
      expect(out.ok ? out.steps[1] : null, plane).toEqual({
        Mirror: { src: 0, plane: { normal, offset: 0 } },
      });
    }
  });

  it("the offset moves the plane along its own normal, in either form", () => {
    const g = say(`${box}mirror(b, YZ, { offset: 3 });`);
    expect(g.ok ? g.steps[1] : null).toEqual({
      Mirror: { src: 0, plane: { normal: "X", offset: 3 } },
    });
    const m = say(`${box}b.mirror(ZX, { offset: -1.5 });`);
    expect(m.ok ? m.steps[1] : null).toEqual({
      Mirror: { src: 0, plane: { normal: "Y", offset: -1.5 } },
    });
  });

  // The two wrong guesses. A plane *value* is the natural one to try, and unchecked it
  // would be recorded as `{ offset: 0 }` with no normal at all — the script would say ok,
  // and the wasm boundary would answer in its own words ("missing field `normal`").
  it("says what it takes, for both ways of guessing wrong", () => {
    for (const [code, said] of [
      [`${box}mirror(b, plane(YZ, { offset: 3 }));`, "a plane value is not one of them yet"],
      [`${box}mirror(b, { normal: "X", offset: 3 });`, "names the plane, not its normal"],
      [`${box}mirror(b, X);`, "takes XY, YZ or ZX"],
      [`${box}mirror(b, YZ, { ofset: 3 });`, "does not take 'ofset'"],
    ] as const) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain(said);
    }
  });
});

// One rule, one place: every options object in the API is read through `onlyKeys`, so a
// typo is named instead of swallowed. Where every field has a default, a swallowed typo
// does not fail, it builds the wrong part.
describe("an options typo is named, not swallowed", () => {
  const say = (code: string) => executeScript(code);

  it("names the stray key and the call it was given to", () => {
    for (const [code, said] of [
      [`cuboid({ size: [1,1,1], centre: [0,0,0] });`, "cuboid does not take 'centre'"],
      [`cuboid({ size: [1,1,1] }).rotateZ(30, { pivo: "center" });`, "rotateZ does not take 'pivo'"],
      [`sketch(XY).moveTo([0,0]).lineTo([1,0], { filet: 2 }).close();`, "lineTo does not take 'filet'"],
      [`sketch(XY).rect([0,0],[1,1], { filet: 2 });`, "rect does not take 'filet'"],
      [`sketch(XY).moveTo([0,0]).lineTo([1,0]).close({ chamfr: 1 });`, "close does not take 'chamfr'"],
      [`plane(XY, { ofset: 5 });`, "plane does not take 'ofset'"],
      // `docs.test.ts` also drives the next four from the reference table; `edges` has
      // nowhere to be listed there — `docs.ts` keys options by *argument*, and these are
      // the fields of a field — so it is spelled out here.
      [`cuboid({size:[1,1,1]});\nstyle({ colur: "red" });`, "style does not take 'colur'"],
      [`display(cuboid({size:[1,1,1]}), { colour: "red" });`, "display does not take 'colour'"],
      [`cuboid({size:[1,1,1]});\nview({ frm: "top" });`, "view does not take 'frm'"],
      [`plane({ origin:[0,0,0], xPont:[1,0,0], yHint:[0,1,0] });`, "plane does not take 'xPont'"],
      [`display(cuboid({size:[1,1,1]}), { edges: { colour: "red" } });`,
        "display's edges does not take 'colour'"],
      [`cuboid({size:[1,1,1]});\nstyle({ edges: { widht: 2 } });`,
        "style's edges does not take 'widht'"],
    ] as const) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain(said);
    }
  });

  // The rotation's message has to name the function that was *called*: the three
  // spellings share one private `rotate`, and "rotate does not take…" points at nothing
  // the script can see.
  it("the rotation names the spelling the script used", () => {
    for (const axis of ["X", "Y", "Z"]) {
      const out = say(`cuboid({ size: [1,1,1] }).rotate${axis}(30, { pivo: 1 });`);
      expect(out.ok ? "" : out.message, axis).toContain(`rotate${axis} does not take 'pivo'`);
    }
  });

  // And a non-object says so, rather than reading a string's indices as field names —
  // read field by field, `circle([0, 0])` would answer "circle does not take '0'".
  it("a value that is not an options object is told so", () => {
    const out = say(`sketch(XY).circle([0, 0]);`);
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.message).toContain("circle takes an object like { center, r, d }");
  });
});

// The sketch's own refusals: a sketch that was never drawn on, and a loose argument
// that is not a drawing. Both are named here rather than left to the wire or the kernel.
describe("a sketch says what is missing before the wire does", () => {
  const say = (code: string) => executeScript(code);

  it("an empty sketch is named here, in the kernel's own words", () => {
    for (const code of [`extrude(sketch(XY), 2);`, `display(sketch(XY));`]) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain("an empty sketch — draw at least one closed path");
    }
  });

  // `sketch` takes the plane alone, so a second argument is refused by name rather than
  // passed on — at wasm, one that is not a drawing would surface as `TypeError: Reflect.get
  // called on non-object`.
  it("a second argument is named, not ignored — sketch takes the plane alone", () => {
    for (const code of [`sketch(XY, "abc");`, `sketch(XY, [1, 2, 3]);`, `sketch(XY, 5);`, `sketch(XY, []);`]) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain("takes the plane alone");
    }
  });

  it("an open pen path is still the first thing said", () => {
    const out = say(`extrude(sketch(XY).moveTo([0,0]).lineTo([1,0]), 2);`);
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.message).toContain("open pen path — close() it first");
  });
});

// Where a call was written, end to end — the marker, the recorder and the throw.
//
// The number these produce is the one in the editor's gutter, which is the only number
// a reader can act on. `mark.test.ts` pins the transform; this pins that the runtime
// actually wires it up.
describe("a failure says which line it was written on", () => {
  it("a step remembers the line of the call that recorded it", () => {
    const out = executeScript(
      `let plate = cuboid({ size: [40, 20, 5] });\nlet hole = cylinder({ d: 6, h: 9 });\nlet part = cut(\n  plate,\n  hole);\n`,
    );
    if (!out.ok) throw new Error(out.message);
    // `cut(` is on line 3 and its arguments are on 4 and 5 — the call answers for the
    // line the word is on.
    expect(out.stepLines).toEqual([1, 2, 3]);
  });

  it("every call in a chain answers for its own line", () => {
    const out = executeScript(
      `let s = sketch(XY)\n  .moveTo([0, 0])\n  .lineTo([1, 0])\n  .lineTo([1, 1], { filet: 2 })\n  .close();\n`,
    );
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.thrownAt).toEqual({ line: 4, name: "lineTo" });
  });

  // The biggest population: a name that does not exist. Without the marker it has no
  // location at all — the engine's own message is all there is.
  it("a method that does not exist says where it was called", () => {
    const out = executeScript(`let s = sketch(XY)\n  .polygon([[0, 0]]);\n`);
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.thrownAt).toEqual({ line: 2, name: "polygon" });
  });

  // **An error that already carries a `line` is not ours to read.** WebKit puts
  // `line`, `column` and `sourceURL` on every error it makes, so a marker that stamps
  // `e.line` — and skips when one is there — writes nothing in Safari, and the reader
  // sees the engine's line for a *generated function*: a one-line script says line 4. V8
  // sets none of that, so such a marker is green in the test runner and wrong in the browser.
  // The script below carries its own `line` to stand in for that engine.
  it("a line the engine already wrote does not become the answer", () => {
    const out = executeScript(
      `let a = cuboid({ size: [1, 1, 1] });
` +
        `print(
  (() => { throw Object.assign(new Error("boom"), { line: 999 }); })());
`,
    );
    expect(out.ok).toBe(false);
    // The arrow is called on line 3, and 999 is nobody's line.
    expect(out.ok ? null : out.thrownAt?.line).toBe(3);
  });

  // The marker is the app's business. A message that names it is a message about code
  // the author never wrote.
  it("the marker never appears in what the author reads", () => {
    for (const code of [`sketch(XY).polygon([[0,0]]);`, `cuboid({ size: [1,1,1] }).scale(2);`]) {
      const out = executeScript(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).not.toContain("__at");
    }
  });

  // The **position** is the claim, not the word "syntax". Mark before validating and
  // the message still reads like a syntax error — it just points at a column in text the
  // author never typed (measured: 1:30 instead of 1:32). Pinning the number is what makes
  // that visible.
  it("a syntax error is reported against what the author wrote, column and all", () => {
    const out = executeScript(`let a = cuboid({ size: [1,1,1] );\n`);
    expect(out.ok).toBe(false);
    const msg = out.ok ? "" : out.message;
    expect(msg).toContain("syntax:");
    expect(msg).toContain("(1:32)"); // where the `)` actually is in the author's line
    expect(msg).not.toContain("__at");
  });
});

// Which trailing argument is a *style* and which is a *value*.
//
// Naming the classes a style is not (`!(x instanceof SolidVal) && !(x instanceof
// SketchBuilder)`) is a list, and a list goes stale in silence: measured, with that list
// `display(a, planeVal)` reads the plane as a style, draws nothing and says nothing. So
// the answer is a rule — a style is an object *literal*, because every value this API
// hands out is a class instance — and `plane`'s spec argument asks the same question.
describe("a style is an object literal; anything else is a value", () => {
  const say = (code: string) => executeScript(code, queries);
  const box = `let a = cuboid({ size: [1, 1, 1] });\nlet b = cuboid({ size: [2, 2, 2] });\n`;

  it("a value where a style could go says what it is", () => {
    for (const [code, said] of [
      // A plane has no extent, and says so in the last position as well as alone.
      [`${box}display(a, plane(XY));`, "a plane has no extent to draw"],
      // One door, so both positions answer: as the last argument (where a list of
      // classes would read it as a style) and as the only one.
      [`${box}display(a, [a, b]);`, "display takes values one at a time"],
      [`${box}display([a, b]);`, "display takes values one at a time"],
    ] as const) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain(said);
    }
  });

  // `plane` takes four shapes, and the sentence that lists them is the right answer
  // for anything that is none of them. Reading a stray key out of an array instead would
  // be a worse message than that one.
  it("plane's other shapes still get the sentence that lists them", () => {
    for (const code of [`plane([1,2,3]);`, `plane(5);`, `plane();`, `plane({});`]) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain("takes XY/YZ/ZX");
    }
  });

  it("and a real style, a real sketch and an empty style are untouched", () => {
    for (const code of [
      `${box}display(a, { color: "#f00" });`,
      `${box}display(a, {});`,
      `${box}let s = sketch(XY).rect([0,0],[1,1]);\ndisplay(a, s);`,
      `${box}style({ edges: { width: 2 } });`,
      `${box}view({ from: "top", zoom: 2 });`,
    ]) {
      expect(say(code).ok, code).toBe(true);
    }
  });

  // `onlyKeys` lets `undefined` through as `{}` so optional options can be omitted.
  // `style` and `view` *require* theirs — without the check above them, `style()` would
  // become a silent no-op, which is exactly the silence these refusals exist to end.
  it("style() and view() still ask for their argument", () => {
    for (const code of [`style();`, `view();`]) {
      const out = say(code);
      expect(out.ok, code).toBe(false);
      expect(out.ok ? "" : out.message, code).toContain("takes an object");
    }
  });
});
