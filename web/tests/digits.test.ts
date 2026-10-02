// **A vertex prints its coordinate to as many places as it is asked for.**
//
// The whole point of `digits` is the digits past the seventeen an f64 can carry: below that it
// is only a slower way to read `v.x`. So these run the door end to end — script text through
// wasm to a printed line — and ask for places no cache could supply.

import { describe, it, expect } from "vitest";
import { executeScript } from "../src/app/runtime";
import { queries } from "./queries";

function printed(code: string): string[] {
  const out = executeScript(code, queries);
  if (!out.ok) throw new Error(`script failed: ${out.message}`);
  return out.output;
}

describe("a vertex answers for its own coordinate", () => {
  it("prints exactly the places it was asked for, past what an f64 holds", () => {
    const [line] = printed(`
      let part = cuboid({ size: [4, 3, 2], corner: [0, 0, 0] });
      print(part.vertices().nearest([0, 0, 0]).digits(40));
    `);
    // Three coordinates, each with 40 decimal places.
    const parts = line.replace(/[()]/g, "").split(", ");
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.split(".")[1]).toHaveLength(40);
  });

  it("a box corner's digits are the coordinate's own, not a rounding of it", () => {
    // A 7-bit rational is exactly representable, so past the significant digits every place is
    // a zero. A realization that had approached the point instead would show noise here — which
    // is the difference this door exists to make.
    const [line] = printed(`
      let part = cuboid({ size: [4, 3, 2], corner: [0, 0, 0] });
      print(part.vertices().nearest([4, 3, 2]).digits(40));
    `);
    expect(line).toBe(
      "(4.0000000000000000000000000000000000000000, " +
        "3.0000000000000000000000000000000000000000, " +
        "2.0000000000000000000000000000000000000000)",
    );
  });

  it("a tenth is a tenth — the cache's own digits are visibly not the point's", () => {
    // **The test that makes this feature mean anything.** `0.1` has no exact `f64`, so the
    // cached coordinate is `0.1000000000000000055511151231257827…` and printing *it* to 30
    // places shows that tail. The kernel keeps the written decimal as the exact rational 1/10,
    // so realizing from the definition prints a tenth.
    //
    // Replace the kernel call with `toFixed` on the cache and every other test here stays
    // green — a box corner is `4` either way.
    const [line] = printed(`
      let part = cuboid({ size: [0.2, 0.2, 0.2], corner: [0, 0, 0] });
      print(part.vertices().nearest([0.2, 0.2, 0.2]).digits(30));
    `);
    expect(line).toBe(
      "(0.200000000000000000000000000000, " +
        "0.200000000000000000000000000000, " +
        "0.200000000000000000000000000000)",
    );
    // And the control: this is exactly what reading the cache would have printed instead.
    expect((0.2).toFixed(30)).toBe("0.200000000000000011102230246252");
  });

  it("a curved model's seam vertex answers too — the arm a box cannot reach", () => {
    const [line] = printed(`
      let part = cylinder({ r: 3, h: 4, base: [0, 0, 0] });
      let v = part.vertices().nearest([3, 0, 0]);
      print(v.digits(30));
    `);
    const parts = line.replace(/[()]/g, "").split(", ");
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.split(".")[1]).toHaveLength(30);
    // On the rim at radius 3 — read back from the printed digits, so this checks the text.
    const [x, y] = parts.map(Number);
    expect(Math.hypot(x, y)).toBeCloseTo(3, 12);
  });

  it("the door refuses a non-number and an out-of-range count in the author's words", () => {
    for (const [arg, word] of [
      ['"lots"', "whole number"],
      ["2.5", "whole number"],
      ["500", "0 to 200"],
    ] as const) {
      const out = executeScript(
        `let part = cuboid({ size: [1, 1, 1] });
         print(part.vertices().nearest([0, 0, 0]).digits(${arg}));`,
        queries,
      );
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.message).toContain(word);
    }
  });
});

describe("a pick keeps meaning the same point", () => {
  it("a pick taken before later steps is refused, and told why", () => {
    // A vertex index is model-global and every `ensureBuilt` rebuilds: measured, the same
    // solid's corners are 0–7 before a `fuse` and 24–31 after. So a pick captured earlier names
    // nothing in the rebuilt value, and the kit's membership check is what stops this handing
    // back **some other corner's** coordinate.
    //
    // The sibling queries (`vertices()`, `faces()`, `bodies()`) are untouched by this because
    // they re-read; `digits` is the only one that takes an index the caller captured.
    const out = executeScript(
      `let part = cuboid({ size: [4, 3, 2], corner: [0, 0, 0] });
       let v = part.vertices().nearest([4, 3, 2]);
       print(v.digits(20));
       let other = cuboid({ size: [1, 1, 1], corner: [9, 9, 9] });
       let joined = fuse(part, other);
       print(v.digits(20));`,
      queries,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      // The words have to name the reference going stale, not the kernel failing — it did not.
      expect(out.message).toContain("picked before later steps");
      // And the first ask, before any of that, answered.
      expect(out.output?.[0]).toContain("4.000");
    }
  });

  it("a vertex of one value is not readable through another", () => {
    // The index only names a vertex *within its own value* — the kit checks membership for the
    // same reason a `through` statement does.
    const out = executeScript(
      `let a = cuboid({ size: [2, 2, 2], corner: [0, 0, 0] });
       let b = cuboid({ size: [2, 2, 2], corner: [50, 50, 50] });
       let va = a.vertices().nearest([0, 0, 0]);
       let vb = b.vertices().nearest([50, 50, 50]);
       print(va.digits(10));
       print(vb.digits(10));`,
      queries,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.output[0]).toContain("0.000");
      expect(out.output[1]).toContain("50.000");
    }
  });
});
