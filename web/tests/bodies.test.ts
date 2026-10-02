// A script can point at one body of a multi-body value.
//
// A boolean can answer with several solids — routinely, for two parts that only touch —
// and a script has to be able to count them and name one. These lock the shape of the
// answer: counting is free, taking copies, and the number a rejection quotes is the
// number `at` takes.

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { executeScript } from "../src/app/runtime";
import { drawQueries, queries } from "./queries";
import { collect } from "../src/app/draw";

/** Two unit cubes sharing exactly the vertical line x=1, y=1 — nothing joins there, so
 * the fuse is the two bodies it was handed. */
const touching = `
let a = cuboid({ size: [1, 1, 1], corner: [0, 0, 0] });
let b = cuboid({ size: [1, 1, 1], corner: [1, 1, 0] });
let both = fuse(a, b);
`;

const runScript = (code: string) => {
  const script = executeScript(code, queries);
  if (!script.ok) throw new Error(script.message);
  return { steps: script.steps, out: wasm.run(script.steps, undefined) };
};

describe("a value's bodies", () => {
  it("counts them", () => {
    const { out, steps } = runScript(`${touching}\nlet n = both.bodies().length;`);
    expect(out.ok, out.message).toBe(true);
    // The fuse is step 2 and it really did answer with two.
    expect(wasm.bodies_of(2)).toBe(2);
    expect(steps.length).toBe(3);
  });

  it("counting is free — asking the question records nothing", () => {
    const asked = runScript(`${touching}\nlet n = both.bodies().length;`).steps;
    const plain = runScript(touching).steps;
    // A kernel copy duplicates every cell of a body, so an implementation that records
    // a step per body up front would double the model just to answer "how many?".
    expect(asked.length).toBe(plain.length);
    expect(asked).toEqual(plain);
  });

  it("takes one as a value", () => {
    const { steps, out } = runScript(`${touching}\nlet first = both.bodies().at(0);`);
    expect(out.ok, out.message).toBe(true);
    expect(steps.length).toBe(4);
    expect(steps[3]).toEqual({ Body: { src: 2, index: 0 } });
    expect(wasm.bodies_of(3)).toBe(1);
  });

  it("each index is its own body", () => {
    const { out } = runScript(`
      let a = cuboid({ size: [1, 1, 1], corner: [0, 0, 0] });
      let b = cuboid({ size: [2, 2, 1], corner: [1, 1, 0] });
      let both = fuse(a, b);
      display(both.bodies().at(0));
      display(both.bodies().at(1));
    `);
    expect(out.ok, out.message).toBe(true);
    // Ask the run which values are drawn rather than counting steps: `bodies()` is called
    // twice here and a `display` lands between them, so the ids are not consecutive.
    expect(out.rendered.length).toBe(2);
    // Size tells them apart; a build that ignored the index would give the same twice.
    const size = (id: number) => {
      const m = wasm.mesh_of(id);
      expect(m, `value ${id} has a mesh`).toHaveProperty("positions");
      const box = (m as { positions: Float32Array }).positions;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < box.length; i += 3) {
        lo = Math.min(lo, box[i]);
        hi = Math.max(hi, box[i]);
      }
      return hi - lo;
    };
    const [p, q] = out.rendered;
    expect(size(p)).not.toBe(size(q));
  });

  it("asking twice for the same body is one body", () => {
    const { steps } = runScript(`
      ${touching}
      let list = both.bodies();
      let x = list.at(0);
      let y = list.at(0);
    `);
    expect(steps.filter((s) => "Body" in s).length).toBe(1);
  });

  it("…and a negative index is the same place, so it is the same body", () => {
    // `at(-1)` and `at(length - 1)` name one body; memoising on the raw argument instead
    // of the resolved index would copy it twice.
    //
    // **Both orders.** A memo that reads the raw argument but writes the resolved one
    // still answers correctly for `-1` then `1` — the second lookup happens to hit — and
    // only fails the other way round. Testing one order is a fixture that cannot see the
    // bug it is written for.
    for (const pair of ["list.at(-1); list.at(1);", "list.at(1); list.at(-1);"]) {
      const { steps } = runScript(`
        ${touching}
        let list = both.bodies();
        ${pair}
      `);
      expect(steps.filter((s) => "Body" in s).length, pair).toBe(1);
    }
  });

  it("a list outlives its source being consumed", () => {
    // The list is bound to the *value*, not the variable: `take` leaves that value
    // holding fresh copies in the same order, so body 0 is still body 0.
    const { out } = runScript(`
      ${touching}
      let list = both.bodies();
      let moved = both.translate([9, 0, 0]);
      display(list.at(0));
    `);
    expect(out.ok, out.message).toBe(true);
    const p = (wasm.mesh_of(out.rendered[0]) as { positions: Float32Array }).positions;
    let hi = -Infinity;
    for (let i = 0; i < p.length; i += 3) hi = Math.max(hi, p[i]);
    expect(hi, "the body that was asked for, not the moved one").toBeLessThan(2);
  });

  it("a value with no bodies counts zero and refuses at(0) by name", () => {
    const empty = `
      let a = cuboid({ size: [1,1,1], corner: [0,0,0] });
      let b = cuboid({ size: [1,1,1], corner: [5,5,5] });
      let none = common(a, b);
    `;
    const { out } = runScript(`${empty}\nlet n = none.bodies().length;`);
    expect(out.ok, out.message).toBe(true);
    expect(wasm.bodies_of(2)).toBe(0);
    const bad = executeScript(`${empty}\nlet x = none.bodies().at(0);`, queries);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("0 bodies");
  });

  it("`at` keeps the promise its name makes", () => {
    // Negative counts from the end, as Array.prototype.at does…
    const { steps } = runScript(`${touching}\nlet last = both.bodies().at(-1);`);
    expect(steps[3]).toEqual({ Body: { src: 2, index: 1 } });

    // …and out of range is refused where the mistake is, in the script's own terms —
    // not recorded and left to fail at build time.
    const bad = executeScript(`${touching}\nlet no = both.bodies().at(5);`, queries);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.message).toContain("2 bodies");
    expect(bad.message).toContain("5");
  });

  // **A range and a shape are different mistakes, and the sentence has to say which.**
  // `at` is typed `number`, but a script's types are stripped, never checked, so `at("0")`
  // arrives as a string and fails the integer test. Trusting the type would send it on to
  // the range arm above: `there is no body 0`, about a value whose body 0 exists — a false
  // sentence that the corpus poisoning every literal in the cheat sheet cannot see, since
  // it only reads the line the message blames.
  //
  // All five shapes, because for `at(0.5)` the range sentence is *accidentally* true —
  // pinning one would leave the others in the range arm and stay green.
  it("`at` tells a bad index from an absent body", () => {
    for (const arg of ['"0"', "null", "", "NaN", "0.5"]) {
      const bad = executeScript(`${touching}\nlet no = both.bodies().at(${arg});`, queries);
      expect(bad.ok, `at(${arg})`).toBe(false);
      if (bad.ok) continue;
      expect(bad.message, `at(${arg})`).toContain("at's index is a whole number");
      // And it does *not* claim anything about how many bodies there are.
      expect(bad.message, `at(${arg})`).not.toContain("bodies");
    }
  });

  it("…and a whole index still gets the range answer", () => {
    for (const [arg, quoted] of [
      ["5", "5"],
      ["-5", "-5"],
    ]) {
      const bad = executeScript(`${touching}\nlet no = both.bodies().at(${arg});`, queries);
      expect(bad.ok, `at(${arg})`).toBe(false);
      if (bad.ok) continue;
      expect(bad.message, `at(${arg})`).toContain("2 bodies");
      expect(bad.message, `at(${arg})`).toContain(quoted);
      expect(bad.message, `at(${arg})`).not.toContain("whole number");
    }
  });

  it("…and the indices that work still work", () => {
    const { out } = runScript(`${touching}\nlet x = both.bodies().at(0);\nlet y = both.bodies().at(-1);`);
    expect(out.ok, out.message).toBe(true);
  });

  it("destructuring and for..of read naturally", () => {
    const { steps, out } = runScript(`
      ${touching}
      let [x, y] = both.bodies();
      display(x);
      display(y);
    `);
    expect(out.ok, out.message).toBe(true);
    expect(steps.filter((s) => "Body" in s).length).toBe(2);
    expect(out.rendered).toEqual([3, 4]);
  });

  it("the bodies replace their source on screen, they do not double it", () => {
    // `render_set` skips `Copy` when marking a value used, so a copy and its source are
    // both leaves and draw on top of each other. `Body` builds *out of* its source, so
    // it must not be skipped — or `both` and its two bodies would all be drawn.
    const { out } = runScript(`
      ${touching}
      let x = both.bodies().at(0);
      let y = both.bodies().at(1);
    `);
    expect(out.ok, out.message).toBe(true);
    expect(out.rendered).not.toContain(2);
    expect(out.rendered.sort()).toEqual([3, 4]);
  });

  it("selectors work on a body — the whole point of it being a value", () => {
    const { out, steps } = runScript(`
      ${touching}
      let one = both.bodies().at(0);
      let top = one.faces().maxBy(f => f.center.z);
      pad(top, sketch(XY).rect([0.2, 0.2], [0.8, 0.8]), 1);
    `);
    expect(out.ok, out.message).toBe(true);
    // The face it padded is one of the *body's*, not the source's — a pick carries the
    // value it was taken from, so the two can never be crossed by accident. (There is
    // no test for crossing them: the API gives no way to say it.)
    const padStep = steps.find((s) => "Pad" in s) as { Pad: { face: { of: number } } };
    expect(padStep.Pad.face.of).toBe(3);
  });

  // **What the panel says is drawn, end to end.** Two cubes meeting along an edge fuse
  // into one value with two bodies, the viewport shows two, and a run table that counts
  // *values* says `1 solid`. So this walks the app's own drawing pass with the real
  // kernel behind it and reads the number the table will print. Counting values gives 1
  // here and 1 for the empty `common` below, so this is the one test that can tell the two
  // rules apart.
  describe("what the drawing pass reports", () => {
    const drawnBy = (code: string) => {
      const { steps, out } = runScript(code);
      expect(out.ok, out.message).toBe(true);
      const got = collect(drawQueries, out, out.rendered, {}, steps);
      if ("error" in got) throw new Error(got.error);
      return got.drawn;
    };

    it("counts bodies, not values", () => {
      expect(drawnBy(touching)).toEqual({ bodies: 2, sketches: 0 });
      expect(drawnBy(`cuboid({ size: [1, 1, 1] });`)).toEqual({ bodies: 1, sketches: 0 });
    });

    it("an empty value draws nothing and is counted as nothing", () => {
      // Measured, and it is why counting values is wrong twice over: an empty `common`
      // meshes to a mesh with **no triangles** — `ok`, and 0 positions long — so an arm
      // that counts values calls it `1 solid`.
      expect(
        drawnBy(`
          let a = cuboid({ size: [1,1,1], corner: [0,0,0] });
          let b = cuboid({ size: [1,1,1], corner: [5,5,5] });
          let none = common(a, b);
        `),
      ).toEqual({ bodies: 0, sketches: 0 });
    });

    it("a sketch is one drawn thing — it has no bodies to count", () => {
      expect(drawnBy(`sketch(XY).rect([0,0],[4,4]);`)).toEqual({ bodies: 0, sketches: 1 });
    });

    it("nothing is counted that did not reach the screen", () => {
      // The count is taken *inside* the arm that produced a mesh. Move it out — count
      // from the render list — and a value the kernel cannot mesh is reported as drawn
      // while the viewport stays empty. The door here says "five bodies" and hands over
      // no mesh at all; the honest answer is none.
      const blind = { ...drawQueries, meshOf: () => null, bodiesOf: () => 5 };
      const got = collect(blind, { rendered: [0], values: ["solid"] }, [0], {}, []);
      expect("error" in got ? got : got.drawn).toEqual({ bodies: 0, sketches: 0 });
    });
  });

  it("the same script records the same steps", () => {
    const a = runScript(`${touching}\nlet [x, y] = both.bodies();`).steps;
    const b = runScript(`${touching}\nlet [x, y] = both.bodies();`).steps;
    expect(a).toEqual(b);
  });
});
