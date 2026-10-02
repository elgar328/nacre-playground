// A failed run is not a blank screen — what the author *did* build is still there.
//
// A script that stops part-way must not show one line of text and an empty viewport,
// where "it failed" and "it did nothing" look the same. These lock the two
// facts the app needs to draw the prefix: the steps before the failure rebuild, and
// **both** failure paths hand them over.

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { executeScript, failureView, markerLines, markerSize, stepName } from "../src/app/runtime";
import { queries } from "./queries";

/** The part the kernel's rotation sweep is measured on, folded by `STEP` degrees. 45° is the one
 * angle of that fold the kernel still declines, which makes it the honest fixture: a
 * real script a user would write, failing for a real reason. */
const rotationFold = (step: number) => `
let s1 = sketch(XY).moveTo([0,0]).lineTo([50,0]).lineTo([50,25]).lineTo([38,25])
  .lineTo([38,50]).lineTo([50,50]).lineTo([50,75]).lineTo([0,75]).close();
let p1 = extrude(s1, 12);
let s2 = sketch(YZ).moveTo([20,12]).lineTo([75,12]).lineTo([75,37]).lineTo([55,37]).close();
let p2 = extrude(s2, 25);
let unit = fuse(p1, p2);
let part = unit;
for (let a = ${step}; a < 360; a += ${step}) { part = fuse(part, unit.rotateZ(a)); }
display(part);
`;

describe("a failed run can still be drawn", () => {
  it("the steps before the failing one rebuild, and have something to show", () => {
    const script = executeScript(rotationFold(45), queries);
    if (!script.ok) throw new Error(`the script should record: ${script.message}`);

    const full = wasm.run(script.steps, undefined);
    expect(full.ok, "45° is the fixture because it fails").toBe(false);
    expect(full.step).toBeGreaterThan(0);

    const prefix = wasm.run(script.steps.slice(0, full.step), undefined);
    // Not "probably ok" — those steps just ran, and `build` is documented
    // deterministic. A failure here would be news about determinism, not about this app.
    expect(prefix.ok, `the prefix must rebuild: ${prefix.message}`).toBe(true);
    expect(prefix.rendered.length).toBeGreaterThan(0);
    for (const id of prefix.rendered) {
      expect(wasm.mesh_of(id)).toHaveProperty("positions");
    }
  });

  it("the other failure path hands its steps over too — a script that throws mid-record", () => {
    // `display` refuses a plane, from inside the recorder: the log stops here rather
    // than at a build. Both stops have to be able to show their prefix, because the
    // author cannot tell them apart.
    const script = executeScript(
      `let a = cuboid({ size: [1,1,1], corner: [0,0,0] });\ndisplay(XY);`,
      queries,
    );
    expect(script.ok).toBe(false);
    if (script.ok) return;
    expect(script.steps, "the recorded prefix is not thrown away").toBeDefined();
    expect(script.steps!.length).toBe(1);
    // Nothing failed to *build*, so every recorded step is good and all of them draw.
    expect(script.step).toBeUndefined();
    const built = wasm.run(script.steps!, undefined);
    expect(built.ok, built.message).toBe(true);
    expect(built.rendered.length).toBeGreaterThan(0);
  });

  it("…and when a selector's own build declines, the failing step comes with it", () => {
    // A pinch that cannot part: A and B meet along one line while a bridge takes the
    // material around the contact. `faces()` forces the build, so the stop happens
    // while the script is still being recorded.
    const script = executeScript(
      `
      let a = cuboid({ size: [2, 2, 1], corner: [0, 0, 0] });
      let g = cuboid({ size: [2, 2.7, 0.6], corner: [1, 0.3, 0.2] });
      let b = cuboid({ size: [2, 2, 1], corner: [2, 2, 0] });
      let ab = fuse(a, g);
      let bad = fuse(ab, b);
      bad.faces();
      `,
      queries,
    );
    expect(script.ok).toBe(false);
    if (script.ok) return;
    expect(script.steps).toBeDefined();
    expect(script.step, "the build's failing step rides out, not just its text").toBe(
      script.steps!.length - 1,
    );
    const prefix = wasm.run(script.steps!.slice(0, script.step!), undefined);
    expect(prefix.ok, prefix.message).toBe(true);
    expect(prefix.rendered.length).toBeGreaterThan(0);
  });

  it("the error names the two values the kernel would not combine", () => {
    const script = executeScript(rotationFold(45), queries);
    if (!script.ok) throw new Error(script.message);
    const full = wasm.run(script.steps, undefined);
    expect(full.ok).toBe(false);
    expect(full.blame, "the pair rides out structurally, not only in the text").toBeDefined();
    const { a, b } = full.blame;
    expect(a).not.toBe(b);
    // Both are always *in* the prefix: `build` refuses a forward reference, so the
    // failing step's operands were built before it. Guarantee, not luck.
    expect(Math.max(a, b)).toBeLessThan(full.step);
    wasm.run(script.steps.slice(0, full.step), undefined);
    for (const id of [a, b]) expect(wasm.mesh_of(id)).toHaveProperty("positions");
  });

  it("what gets drawn is the prefix's leaves UNION the blamed pair", () => {
    const script = executeScript(rotationFold(45), queries);
    if (!script.ok) throw new Error(script.message);
    const full = wasm.run(script.steps, undefined);
    const prefix = wasm.run(script.steps.slice(0, full.step), undefined);

    // The hole this lock exists for: the leaf rule alone hides one of the two, because
    // `unit` is read by the rotated copy. Measured, not assumed.
    expect(
      prefix.rendered,
      "if this ever contains both, the union has stopped being the thing under test",
    ).not.toContain(Math.min(full.blame.a, full.blame.b));

    const { ids, blamed } = failureView(prefix.rendered, full.blame);
    expect(ids).toContain(full.blame.a);
    expect(ids).toContain(full.blame.b);
    for (const id of prefix.rendered) expect(ids).toContain(id);
    expect([...blamed].sort()).toEqual([full.blame.a, full.blame.b].sort());
    // No duplicates: a blamed value that is already a leaf is drawn once.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("with no blame — a malformed program — the leaves are all there is", () => {
    const { ids, blamed } = failureView([1, 2], undefined);
    expect(ids).toEqual([1, 2]);
    expect(blamed.size).toBe(0);
  });

  it("the failing call is named in the author's own word", () => {
    const script = executeScript(rotationFold(45), queries);
    if (!script.ok) throw new Error(script.message);
    const full = wasm.run(script.steps, undefined);
    expect(stepName(script.steps[full.step])).toBe("fuse");

    // Not just booleans, and not just this one — a name that only works for `fuse`
    // would pass the line above and be wrong everywhere else.
    const other = executeScript(`
      let a = cuboid({ size: [1, 1, 1], corner: [0, 0, 0] });
      let s = sketch(XY).rect([0, 0], [1, 1]);
      let e = extrude(s, 2);
      let c = cut(a, e);
      let m = common(a.copy(), e.copy());
      let t = a.copy().translate([5, 0, 0]);
    `);
    if (!other.ok) throw new Error(other.message);
    const names = other.steps.map(stepName);
    expect(names).toContain("cuboid");
    expect(names).toContain("extrude");
    expect(names).toContain("cut");
    expect(names).toContain("common");
    expect(names).toContain("translate");
    expect(stepName(undefined)).toBeNull();
  });

  it("a syntax error records nothing, and says so by having no steps", () => {
    const script = executeScript(`let a = ;`, queries);
    expect(script.ok).toBe(false);
    if (script.ok) return;
    expect(script.steps).toBeUndefined();
  });
});

describe("the error carries where the kernel was looking", () => {
  it("the 45° fold's self-touch arrives as the touching segment", () => {
    // The fold says its truth: a self-touching result (Impossible), marked by the
    // touching edge itself rather than a point — the merge abstains and the kernel's
    // whole-result judgement speaks.
    const script = executeScript(rotationFold(45), queries);
    if (!script.ok) throw new Error(script.message);
    const full = wasm.run(script.steps, undefined);
    expect(full.ok).toBe(false);
    expect(full.mark, "the location rides out structurally").toBeDefined();
    expect(full.mark.kind).toBe("segment");
    const [a, b] = full.mark.coords;
    for (const c of [...a, ...b]) expect(Number.isFinite(c)).toBe(true);
    // The fold only rotates about Z, so the touch is a vertical segment spanning the
    // prism's own horizontal planes — z = 0 to z = 12. The full geometric lock is the
    // kernel's (`rotation_sweep.rs`); this is the pipe end of it.
    const [lo, hi] = a[2] <= b[2] ? [a[2], b[2]] : [b[2], a[2]];
    expect(Math.abs(lo)).toBeLessThan(1e-9);
    expect(Math.abs(hi - 12)).toBeLessThan(1e-9);
  });

  it("a vertex pinch marks the corner itself", () => {
    // The kernel's pinched-fuse fixture, spoken as a script: the last fuse meets the
    // rest at exactly (2, 2, 1).
    const script = executeScript(
      `
      let a = cuboid({ size: [2, 2, 1], corner: [0, 0, 0] });
      let g1 = cuboid({ size: [3.5, 1, 0.6], corner: [1, 0.3, 0.2] });
      let g2 = cuboid({ size: [1, 3.5, 1.4], corner: [3.5, 0.3, 0.2] });
      let b = cuboid({ size: [2, 2, 1], corner: [2, 2, 1] });
      display(fuse(a, g1, g2, b));
      `,
      queries,
    );
    if (!script.ok) throw new Error(script.message);
    const full = wasm.run(script.steps, undefined);
    expect(full.ok).toBe(false);
    expect(full.mark).toBeDefined();
    expect(full.mark.kind).toBe("point");
    const [p] = full.mark.coords;
    const d = Math.hypot(p[0] - 2, p[1] - 2, p[2] - 1);
    expect(d, `mark off the pinch corner: ${p}`).toBeLessThan(1e-9);
  });

  it("markerLines: a point becomes a three-axis cross, a segment stays itself", () => {
    const cross = markerLines({ kind: "point", coords: [[1, 2, 3]] }, 0.5);
    expect(cross.length).toBe(18);
    expect([...cross.slice(0, 6)]).toEqual([0.5, 2, 3, 1.5, 2, 3]);
    const seg = markerLines(
      { kind: "segment", coords: [[0, 0, 0], [1, 1, 1]] },
      0.5,
    );
    expect([...seg]).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("markerSize: a fraction of the drawn extent, with a floor when nothing is drawn", () => {
    expect(markerSize([])).toBe(1.0);
    const cube = new Float32Array([0, 0, 0, 10, 10, 10]);
    const s = markerSize([{ lines: cube }]);
    expect(s).toBeCloseTo(Math.hypot(10, 10, 10) * 0.03, 6);
  });
});
