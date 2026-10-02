// A script can say something in words.
//
// Without `print`, all the app can show an author is geometry and one clamped line of
// status. `print` is the other half: a number the model does not show, and —
// the part that is easy to get half-right — whatever a run said *before* it fell over.

import { describe, expect, it } from "vitest";
import { executeScript } from "../src/app/runtime";
import { queries } from "./queries";

const box = `let a = cuboid({ size: [1, 1, 1], corner: [0, 0, 0] });`;

/** The lines, or a thrown message — every test here wants one of the two. */
const runScript = (code: string) => {
  const out = executeScript(code, queries);
  return { out, lines: out.output ?? [] };
};

describe("print", () => {
  it("hands its lines out in call order", () => {
    const { out, lines } = runScript(`print("one");\nprint("two");\n${box}`);
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    expect(lines).toEqual(["one", "two"]);
  });

  it("…and they survive the script failing", () => {
    // The lines a script wrote on the way to failing are exactly the ones the author was
    // watching. Recording them on success only would be half a feature, silently — the
    // `ScriptOk`/`ScriptFail` pair has to be edited on both sides, and this is the test
    // that notices when only one of them was.
    const { out, lines } = runScript(`
      print("before");
      let s = sketch(XY).moveTo([0, 0]).lineTo([1, 1]);
      extrude(s, "not a number");
    `);
    expect(out.ok).toBe(false);
    expect(lines).toEqual(["before"]);
  });

  it("does not tidy a number", () => {
    // 0.30000000000000004 is the number the script has. Showing a rounder one would be
    // showing a different value, which is the opposite of what this kernel is for.
    const { lines } = runScript(`print(0.1 + 0.2);`);
    expect(lines).toEqual(["0.30000000000000004"]);
  });

  it("records no steps — saying something builds nothing", () => {
    const spoke = runScript(`${box}\nprint("hello", 1, true);`).out;
    const silent = runScript(box).out;
    expect(spoke.ok && silent.ok).toBe(true);
    if (!spoke.ok || !silent.ok) return;
    expect(spoke.steps).toEqual(silent.steps);
  });

  it("joins its arguments, and names values the way the errors do", () => {
    const { lines } = runScript(`
      ${box}
      let b = cuboid({ size: [1, 1, 1], corner: [1, 1, 0] });
      let both = fuse(a, b);
      print("solid:", both);
      print(both.bodies());
      print(XY, [1, 2], { k: 3 }, null, undefined, false);
    `);
    // `fuse` is step 2, and the kit refuses with "value 2 has …" — one vocabulary.
    expect(lines[0]).toBe("solid: Solid value 2");
    expect(lines[1]).toBe("BodyList(2)");
    expect(lines[2]).toBe("XY plane [1,2] {\"k\":3} null undefined false");
  });

  it("a cycle does not kill the script it was added to debug", () => {
    const { out, lines } = runScript(`
      ${box}
      let o = { name: "loop" };
      o.self = o;
      print(o);
    `);
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    expect(lines).toEqual(["[object]"]);
  });

  it("console.log lands here too, without breaking the real console", () => {
    // The reflex is `console.log`, and its usual destination is a place a phone does not
    // have.
    // The second half is the point of building the shim on the real console: a plain
    // `{ log, warn, error }` object would make `console.table(…)` kill the script.
    const { out, lines } = runScript(`
      console.log("from console", 2);
      console.warn("careful");
      console.table([{ a: 1 }]);
      print("and print");
    `);
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    expect(lines).toEqual(["from console 2", "careful", "and print"]);
  });

  it("the cap says how much it dropped", () => {
    // A cap that says nothing reads as "this is all of it". Counting the kept lines
    // alone would pass just as well against a silent truncation, so the last line is
    // what this actually measures.
    const { lines } = runScript(`for (let i = 0; i < 600; i++) print(i);`);
    expect(lines.length).toBe(501);
    expect(lines[499]).toBe("499");
    expect(lines[500]).toBe("… 100 more lines (not kept)");
  });
});
