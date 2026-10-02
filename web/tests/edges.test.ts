// **A drawn edge that closes must be drawn closed.**
//
// The kernel's rings are closed *implicitly*: `nacre_tess::sample_edge`'s full-rim arm
// samples a circle at `0 .. (n−1)τ/n` and stops, and `boundary_ring` drops the
// wrap-around duplicate for the same reason. A consumer that stitches such a polyline
// with `windows(2)` therefore leaves exactly one segment undrawn — which shows in the
// viewport as a small gap in a cylinder's rim.
//
// These lock the shape of the answer rather than a segment count, because the count
// moves with the tessellation tolerance. The signature of the bug is a **dangling end**:
// a point that only one segment touches.

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { executeScript } from "../src/app/runtime";
import { queries } from "./queries";

const run = (code: string) => {
  const script = executeScript(code, queries);
  if (!script.ok) throw new Error(script.message);
  const out = wasm.run(script.steps, undefined) as { ok: boolean; message?: string };
  expect(out.ok, out.message).toBe(true);
};

/** How many segments touch each drawn point, keyed on quantised coordinates.
 *
 * Quantised on purpose: two segments meeting at one mesh vertex do come back
 * bit-identical today, and a test that leans on that is measuring the float and not
 * the topology. */
const degrees = (id: number, which: "edges" | "sketch"): Map<string, number> => {
  const e = (which === "edges" ? wasm.edges_of(id) : wasm.sketch_of(id)) as {
    positions: Float32Array;
  } | null;
  if (!e || !("positions" in e)) throw new Error("no lines");
  const key = (i: number) =>
    [0, 1, 2].map((k) => Math.round(e.positions[i + k] * 1e4) / 1e4).join(",");
  const d = new Map<string, number>();
  for (let i = 0; i + 5 < e.positions.length; i += 6)
    for (const p of [key(i), key(i + 3)]) d.set(p, (d.get(p) ?? 0) + 1);
  return d;
};

const histogram = (d: Map<string, number>) => {
  const h = new Map<number, number>();
  for (const v of d.values()) h.set(v, (h.get(v) ?? 0) + 1);
  return [...h.entries()].sort((a, b) => a[0] - b[0]);
};

describe("drawn edges close", () => {
  it("a plain cylinder's rims are cycles, not chains", () => {
    run(`let c = cylinder({ d: 10, h: 20 });`);
    // Two rims and nothing else: the seam is self-adjacent and deliberately not drawn.
    // Every point of a cycle is touched by exactly two segments; without the closing
    // segment this reads `[[1, 4], [2, 356]]` — one dangling end per rim end.
    expect(histogram(degrees(0, "edges"))).toEqual([[2, 360]]);
  });

  it("a box is untouched — the negative control", () => {
    run(`let b = cuboid({ size: [2, 3, 4], corner: [0, 0, 0] });`);
    // Eight corners of degree three. Nothing here closes, so a fix that closed *every*
    // polyline would show up as a fourth segment at each corner.
    expect(histogram(degrees(0, "edges"))).toEqual([[3, 8]]);
  });

  it("a bored plate too — an ordinary bore leaves two uncut rims", () => {
    run(`
      let p = cuboid({ size: [20, 20, 4], corner: [0, 0, 0] });
      let d = cylinder({ d: 6, h: 10, base: [10, 10, -3] });
      let out = cut(p, d);
    `);
    // **Measured, not predicted.** A cut rim does arrive as arcs that close
    // themselves — but a bore through a plate leaves its two circular mouths *uncut*, so
    // this shape is exposed to the gap too. The population is every uncut rim, which is to say
    // nearly every part with a hole in it, not just a bare `cylinder()`.
    //
    // The histogram is pinned rather than asked "nothing dangles", because that weaker
    // form is blind in the other direction: adding a **spurious** closing chord can only
    // raise degrees, never leave a 1. `TessConfig::default()` fixes the counts; a
    // tolerance change is meant to be loud here.
    expect(histogram(degrees(2, "edges"))).toEqual([
      [2, 360], // the two bore mouths, 180 points each
      [3, 8], // the plate's own corners
    ]);
  });

  it("a filleted prism — the fixture that has arcs, and so an *over*-closing shows", () => {
    run(`
      let s = sketch(XY).rect([0, 0], [30, 10], { fillet: 3 });
      let p = extrude(s, 5);
    `);
    // The corner fillets make cylinder patches whose cap edges are **arcs**: several
    // points, distinct endpoints. They are the only edges in this suite for which
    // "closed" and "long" differ — so a fix that closed every long polyline instead of
    // every closed one draws a chord across each arc, and these numbers move. Without a
    // fixture like this the `vertices[0] == vertices[1]` test is untested.
    expect(histogram(degrees(1, "edges"))).toEqual([
      [2, 352], // the two cap rings and the four vertical fillet seams' ends
      [3, 16], // where a fillet arc meets a straight wall: four corners, two caps, two ends
    ]);
  });

  it("a sketch's circle closes too — the other line road", () => {
    run(`let s = sketch(XY).circle({ center: [0, 0], d: 8 });`);
    // `nacre-kit`'s sampler emits pairs directly and walks an arc `1..=n`, so the last
    // point *is* the first — a different convention from the kernel's rings, and this
    // says so rather than assuming the two roads agree.
    expect(histogram(degrees(0, "sketch"))).toEqual([[2, 32]]);
  });
});
