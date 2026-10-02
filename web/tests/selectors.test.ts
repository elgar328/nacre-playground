// Picking by appearance, end to end through the app runtime and the wasm
// boundary: selectors build the prefix, record resolved references, and the full
// build honors them (the kit's prefix-stability underneath).

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { executeScript } from "../src/app/runtime";
import { queries } from "./queries";
import { EXAMPLES } from "./examples";

function runScript(code: string) {
  const script = executeScript(code, queries);
  if (!script.ok) throw new Error(script.message);
  return { steps: script.steps, out: wasm.run(script.steps, undefined) };
}

describe("selectors pick by appearance, statements use names", () => {
  it("pads the face faces() picked — the pad flow", () => {
    const { steps, out } = runScript(`
      let part = cuboid({ size: [4, 4, 2], corner: [0, 0, 0] });
      let top = part.faces().filter(f => f.normal.isClose(Z)).maxBy(f => f.center.z);
      let boss = sketch(XY).rect([1, 1], [2, 2]);
      pad(top, boss, 1);
    `);
    expect(out.ok).toBe(true);
    // The recorded reference is resolved — a model face index, not a promise.
    const pad = steps.find((s) => "Pad" in s)! as { Pad: { face: { of: number } } };
    expect(pad.Pad.face.of).toBe(0);
    expect(wasm.faces_of(2).length).toBeGreaterThan(6);
  });

  it("states a through-plane from picked vertices — the through-plane flow", () => {
    const { out } = runScript(`
      let part = cuboid({ size: [4, 4, 4], corner: [0, 0, 0] });
      let p = plane({ through: [
        part.vertices().nearest([4, 0, 0]),
        part.vertices().nearest([0, 4, 0]),
        part.vertices().nearest([0, 0, 4]),
      ]});
      extrude(sketch(p).rect([0, 0], [1, 1]), 1);
    `);
    expect(out.ok).toBe(true);
  });

  it("re-picks deterministically: two runs, identical resolved references", () => {
    const code = `
      let part = cuboid({ size: [4, 4, 2], corner: [0, 0, 0] });
      let top = part.faces().filter(f => f.normal.isClose(Z)).maxBy(f => f.center.z);
      pad(top, sketch(XY).rect([1, 1], [2, 2]), 1);
    `;
    const a = executeScript(code, queries);
    const b = executeScript(code, queries);
    if (!a.ok || !b.ok) throw new Error("script failed");
    expect(a.steps).toEqual(b.steps);
  });

  it("a query after later reuse still resolves (prefix-stability, app side)", () => {
    const { out } = runScript(`
      let a = cuboid({ size: [4, 4, 2], corner: [0, 0, 0] });
      let b = a.translate([0, 0, 5]);
      let top = b.faces().filter(f => f.normal.isClose(Z)).maxBy(f => f.center.z);
      pad(top, sketch(XY).rect([1, 1], [2, 2]), 1);
      let c = a.translate([10, 0, 0]);   // the second consumption of a
      display(c);
    `);
    expect(out.ok).toBe(true);
  });
});

describe("plane forms and their honest limits", () => {
  it("offset planes carry sketches at the offset", () => {
    const { out } = runScript(`
      let p = plane(XY, { offset: 2 });
      extrude(sketch(p).rect([0, 0], [1, 1]), 1);
    `);
    expect(out.ok).toBe(true);
  });

  it("a tilted plane extrudes either way; a range off it is told where to start", () => {
    const back = runScript(`
      let p = plane({ origin: [0,0,0], xPoint: [1,0,1], yHint: [0,1,0] });
      extrude(sketch(p).rect([0, 0], [1, 1]), -1);
    `);
    expect(back.out.ok).toBe(true);
    const { out } = runScript(`
      let p = plane({ origin: [0,0,0], xPoint: [1,0,1], yHint: [0,1,0] });
      extrude(sketch(p).rect([0, 0], [1, 1]), [-1, 1]);
    `);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("where the range starts");
  });
});

describe("selector misuse fails in the script, with words", () => {
  it("nearest on an empty list", () => {
    const script = executeScript(
      `cuboid().vertices().filter(v => v.z > 99);
       plane({ through: [] });`,
      queries,
    );
    expect(script.ok).toBe(false);
    if (!script.ok) expect(script.message).toContain("exactly three");
  });

  it("a failing prefix surfaces at the query, in the kit's words", () => {
    const script = executeScript(
      `let s = extrude(sketch(XY).moveTo([0, 0]).lineTo([4, 4]).lineTo([4, 0]).lineTo([0, 4]).close(), 2);  // a bowtie
       cuboid().faces();            // the query builds the prefix and meets it`,
      queries,
    );
    expect(script.ok).toBe(false);
    if (!script.ok) expect(script.message).toContain("crosses itself");
  });
});

describe("the examples", () => {
  it("every example the gallery shows runs clean", () => {
    expect(EXAMPLES.length).toBeGreaterThan(0);
    for (const [what, src] of EXAMPLES) {
      const { out } = runScript(src);
      expect(out.ok, `${what}: ${out.ok ? "" : out.message}`).toBe(true);
    }
  });
});
