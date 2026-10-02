// The wasm boundary round-trips: run a cuboid, query its faces, mesh it.
// Uses the nodejs-target build (npm run wasm:test) — same crate, node-callable.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — the nodejs pkg ships its own .d.ts but under a CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import type { Step } from "../src/api/steps";
import { executeScript } from "../src/app/runtime";

const cuboid: Step[] = [
  { Cuboid: { size: [4, 4, 2], at: { Corner: [0, 0, 0] } } },
];

describe("the wasm boundary", () => {
  it("runs a cuboid and reports the summary", () => {
    const out = wasm.run(cuboid, undefined);
    expect(out.ok).toBe(true);
    expect(out.rendered).toEqual([0]);
    expect(out.values).toEqual(["solid"]);
  });

  it("queries faces about the last run", () => {
    wasm.run(cuboid, undefined);
    const faces = wasm.faces_of(0);
    expect(faces).toHaveLength(6);
    const top = faces.find(
      (f: { normal: number[] | null }) =>
        f.normal && f.normal[0] === 0 && f.normal[1] === 0 && f.normal[2] === 1,
    );
    expect(top.center).toEqual([2, 2, 2]);
    expect(top.area).toBe(16);
    expect(wasm.vertices_of(0)).toHaveLength(8);
  });

  it("meshes a box into 12 flat-shaded triangles", () => {
    wasm.run(cuboid, undefined);
    const mesh = wasm.mesh_of(0);
    expect(mesh.ok).toBe(true);
    // 6 faces × 2 triangles × 3 corners × 3 components.
    expect(mesh.positions.length).toBe(108);
    expect(mesh.normals.length).toBe(108);
  });

  it("reports failures with the step index and the kit's words", () => {
    const bad: Step[] = [
      ...cuboid,
      { Sketch: { plane: { World: "XY" }, paths: [] } },
    ];
    const out = wasm.run(bad, undefined);
    expect(out.ok).toBe(false);
    expect(out.step).toBe(1);
    expect(out.message).toContain("empty sketch");
  });

  // A cylinder is the first thing a user types after a box, and a drilled plate is
  // what the cylinder is for. Both are asked through the app's own road —
  // the kernel's own tests mesh models directly, and `faces_of` is written so that a
  // single face the kernel refuses to describe turns the *whole* answer into null.
  const cylinder: Step[] = [
    { Cylinder: { radius: 1, height: 4, at: { Base: [0, 0, 0] } , axis: "Z" } },
  ];

  it("runs a lone cylinder, meshes it, and describes its three faces", () => {
    const out = wasm.run(cylinder, undefined);
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    expect(out.values).toEqual(["solid"]);
    const faces = wasm.faces_of(0);
    expect(faces).toHaveLength(3);
    // The lateral face has no single normal, and says so rather than guessing.
    expect(faces.filter((f: { normal: number[] | null }) => !f.normal)).toHaveLength(1);
    const mesh = wasm.mesh_of(0);
    expect(mesh.ok).toBe(true);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.positions.length % 9).toBe(0); // whole triangles
  });

  // The axis crosses the wire as a *name* (`"X"`), and nothing else in the suite sends
  // a non-Z one across: the recorder's own test stops at the recorded step, and the kit's
  // axis locks stop at the Rust side. So this is the only place that says the app's
  // spelling and the kit's `KitAxis` are the same three words — and it pins the caps
  // rather than `ok: true`, because "it built something" cannot tell X from Z.
  it("builds a cylinder along X, all the way across the wire", () => {
    const out = wasm.run(
      [{ Cylinder: { radius: 1, height: 4, at: { Center: [0, 0, 0] }, axis: "X" } }],
      undefined,
    );
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    const faces = wasm.faces_of(0);
    expect(faces).toHaveLength(3);
    const caps = faces
      .filter((f: { normal: number[] | null }) => f.normal)
      .map((f: { normal: number[]; center: number[] }) => [f.normal, f.center]);
    expect(caps).toHaveLength(2);
    // `+ 0` folds the negative zeros the cap normals come back with (`[-1, -0, -0]`):
    // the sign of a zero is not a claim about the geometry, and `toEqual` reads it as one.
    const flat = (v: number[]) => v.map((c) => c + 0);
    expect(caps.map(([n]: [number[]]) => flat(n)).sort()).toEqual([
      [-1, 0, 0],
      [1, 0, 0],
    ]);
    expect(caps.map(([, c]: [number[], number[]]) => flat(c)).sort()).toEqual([
      [-2, 0, 0],
      [2, 0, 0],
    ]);
  });

  // No other app or kit test states a non-zero mirror plane, so nothing else says the
  // app's `offset` and the kernel's `axis = offset` are the same number. Pinned by where
  // the faces land — a box on x ∈ [0, 10] reflected in x = 3 spans [−4, 6], where offset 0
  // would give [−10, 0].
  it("mirrors in an offset plane, all the way across the wire", () => {
    const out = wasm.run(
      [
        { Cuboid: { size: [10, 4, 4], at: { Corner: [0, 0, 0] } } },
        { Mirror: { src: 0, plane: { normal: "X", offset: 3 } } },
      ],
      undefined,
    );
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    const xs = wasm
      .faces_of(1)
      .filter((f: { normal: number[] | null }) => f.normal && Math.abs(f.normal[0]) === 1)
      .map((f: { center: number[] }) => f.center[0])
      .sort((a: number, b: number) => a - b);
    expect(xs).toEqual([-4, 6]);
  });

  it("drills a plate and still answers about it", () => {
    const drilled: Step[] = [
      { Cuboid: { size: [4, 4, 2], at: { Corner: [0, 0, 0] } } },
      { Cylinder: { radius: 0.5, height: 4, at: { Base: [2, 2, -1] } , axis: "Z" } },
      { Boolean: { kind: "Cut", args: [0, 1] } },
    ];
    const out = wasm.run(drilled, undefined);
    expect(out.ok, out.ok ? "" : out.message).toBe(true);
    expect(out.rendered).toEqual([2]);
    // Four walls, two drilled caps, one bore: seven faces and exactly one of them
    // curved. Pinned rather than bounded — a query that answers *something* is not
    // the claim; the claim is that it answers about this solid.
    const faces = wasm.faces_of(2);
    expect(faces).not.toBeNull();
    expect(faces).toHaveLength(7);
    expect(faces.filter((f: { normal: number[] | null }) => !f.normal)).toHaveLength(1);
    expect(wasm.vertices_of(2)).toHaveLength(10);
    const mesh = wasm.mesh_of(2);
    expect(mesh.ok).toBe(true);
    expect(mesh.positions.length % 9).toBe(0);
  });

  // The mesh carries the **surface's** normal at every corner, not the triangle's. A flat
  // facet normal is an approximation of a curved face; the kernel knows the exact one, so a
  // cylinder is lit as round without a single extra triangle. What this checks is the wiring —
  // that the app asks per corner and passes the answer through; the *convention* (which way a
  // bore faces) is measured in the kernel, where it is decided.
  it("lights a cylinder as a surface, not as 180 facets", () => {
    wasm.run(cylinder, undefined);
    const mesh = wasm.mesh_of(0);
    const tri = (t: number) =>
      [0, 1, 2].map((k) => ({
        p: [0, 1, 2].map((c) => mesh.positions[t * 9 + k * 3 + c]),
        n: [0, 1, 2].map((c) => mesh.normals[t * 9 + k * 3 + c]),
      }));
    let wall = 0;
    let cap = 0;
    for (let t = 0; t < mesh.positions.length / 9; t++) {
      const corners = tri(t);
      const flat = corners.every(
        (c) =>
          Math.abs(c.n[0] - corners[0].n[0]) < 1e-6 &&
          Math.abs(c.n[1] - corners[0].n[1]) < 1e-6 &&
          Math.abs(c.n[2] - corners[0].n[2]) < 1e-6,
      );
      if (Math.abs(corners[0].n[2]) > 0.5) {
        // A cap: still flat, and still ±Z — the crease with the wall must not be smoothed away.
        cap++;
        expect(flat, `cap triangle ${t}`).toBe(true);
        for (const c of corners) {
          expect(Math.abs(Math.abs(c.n[2]) - 1)).toBeLessThan(1e-6);
        }
      } else {
        // A wall triangle: each corner faces its own way, radially, and the normals are unit.
        wall++;
        expect(flat, `wall triangle ${t} is still flat-shaded`).toBe(false);
        for (const c of corners) {
          const len = Math.hypot(c.n[0], c.n[1], c.n[2]);
          expect(Math.abs(len - 1)).toBeLessThan(1e-6);
          expect(Math.abs(c.n[2])).toBeLessThan(1e-6); // perpendicular to the axis
          const radial = Math.hypot(c.p[0], c.p[1]);
          expect(Math.abs(c.n[0] * c.p[0] + c.n[1] * c.p[1] - radial)).toBeLessThan(1e-5);
        }
      }
    }
    expect(wall).toBeGreaterThan(100);
    expect(cap).toBeGreaterThan(100);
  });

  it("answers null for non-solids and missing values", () => {
    wasm.run(cuboid, undefined);
    expect(wasm.faces_of(7)).toBeNull();
    expect(wasm.mesh_of(7)).toBeNull();
  });
});

// A sketch exists as soon as it has a closed shape — and an unfinished one says so.
//
// The property most at risk here is the quiet one: a sketch nobody uses is *drawn*
// (an unused sketch is visible *because* it is unused), which only happens
// if the step was recorded.
// Move recording to the moment of use and every one of these still passes `extrude`
// while the lines vanish from the scene — so the four entrances are pinned by what the
// scene contains, not by whether a solid came out.
describe("a sketch is recorded when it is drawn", () => {
  const drawn = (code: string) => {
    const script = executeScript(code);
    if (!script.ok) throw new Error(script.message);
    return wasm.run(script.steps, undefined);
  };

  it("an unused sketch is still in the scene — all three entrances", () => {
    for (const [what, code] of [
      ["pen", `let s = sketch(XY).moveTo([0,0]).lineTo([4,0]).lineTo([4,4]).close();`],
      ["rect", `let s = sketch(XY).rect([0,0],[4,4]);`],
      ["circle", `let s = sketch(XY).circle({center:[0,0],r:2});`],
    ] as const) {
      const out = drawn(code);
      expect(out.ok, what).toBe(true);
      expect(out.values, what).toEqual(["sketch"]);
      expect(out.rendered, what).toEqual([0]);
    }
  });

  it("and each of them extrudes without a finishing verb", () => {
    for (const [what, code] of [
      ["rect", `extrude(sketch(XY).rect([0,0],[4,4]), 2);`],
      ["circle", `extrude(sketch(XY).circle({center:[0,0],r:2}), 2);`],
      ["hole", `extrude(sketch(XY).rect([0,0],[10,10]).circle({center:[5,5],r:2}), 2);`],
    ] as const) {
      const out = drawn(code);
      expect(out.ok, what).toBe(true);
      expect(out.values.at(-1), what).toBe("solid");
    }
  });
});

// A malformed step is named by its index.
//
// The wire reads the log one step at a time so that a value of the wrong shape can be
// pointed at — the app turns that index into the line the author wrote. The recorder
// checks these values at the call, so nothing a script can write reaches here malformed
// and the app's own poison corpus never comes this way. **That makes this the only
// measurement**, which is why it is written directly against the boundary.
describe("the wire names the step it could not read", () => {
  const good = { Cuboid: { size: [1, 1, 1], at: { Center: [0, 0, 0] } } };

  it("by index, wherever in the log it sits", () => {
    for (const [what, steps, at] of [
      ["a string where a number goes, first",
        [{ Cuboid: { size: ["1", 1, 1], at: { Center: [0, 0, 0] } } }], 0],
      ["…and third, so it is not just reporting zero",
        [good, good, { Translate: { src: 0, offset: ["1", 0, 0] } }], 2],
      ["an array of the wrong length",
        [good, { Translate: { src: 0, offset: [1, 2] } }], 1],
      ["something that is not an array at all",
        [good, { Translate: { src: 0, offset: 5 } }], 1],
    ] as const) {
      const out = wasm.run(steps as unknown as Step[], undefined);
      expect(out.ok, what).toBe(false);
      expect(out.step, what).toBe(at);
      // And no `step N:` prefix of its own: the step rides `out.step`, and the `Where`
      // row is the only place that says it.
      expect(out.message, what).not.toMatch(/^step \d+:/);
    }
  });

  it("and says so without an index when there is none to give", () => {
    const out = wasm.run("not a log" as unknown as Step[], undefined);
    expect(out.ok).toBe(false);
    expect(out.step).toBeUndefined();
    expect(out.message).toContain("malformed steps");
  });
});
