// **The export menu writes what the viewport shows, and it runs inside wasm.**
//
// Run through the nodejs build of the same wasm, because "it links" is not "it runs": STEP export
// asked the system clock for its header's time, and that call traps in wasm32 — an empty model's
// export came back `RuntimeError: unreachable`. The stamp is now the caller's.
//
// The OBJ is checked against the viewport itself: the file's triangles are the drawn triangles,
// counted from `mesh_of`. Writing the model's whole mesh instead would add the solids a script
// keeps but does not show — the fixture below keeps one.

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { executeScript } from "../src/app/runtime";
import { exportable, stepStamp } from "../src/app/export";
import { exportWords } from "../src/app/summary";
import type { RunFacts } from "../src/app/summary";
import { EXAMPLES } from "./examples";
import { queries } from "./queries";

const STAMP = "2026-10-05T00:00:00Z";

/** Build a script; hand back the ids of the solid values the viewport would draw. */
const build = (code: string): number[] => {
  const script = executeScript(code, queries);
  if (!script.ok) throw new Error(script.message);
  const out = wasm.run(script.steps, undefined) as {
    ok: boolean;
    message?: string;
    rendered: number[];
    values: (string | null)[];
  };
  expect(out.ok, out.message).toBe(true);
  return out.rendered.filter((id) => out.values[id] === "solid");
};

/** How many triangles the viewport draws for these values. */
const drawnTriangles = (ids: number[]): number =>
  ids
    .map((id) => (wasm.mesh_of(id) as { positions: Float32Array }).positions.length / 9)
    .reduce((a, b) => a + b, 0);

const file = (r: unknown): { text: string; left: number } => {
  const f = r as { ok: boolean; text?: string; left?: number; message?: string };
  expect(f.ok, f.message).toBe(true);
  return { text: f.text!, left: f.left! };
};

const checkBoth = (ids: number[]) => {
  const step = file(wasm.export_step(STAMP));
  expect(step.text.startsWith("ISO-10303-21;")).toBe(true);
  expect(step.text).toContain(`'${STAMP}'`);
  expect(step.left).toBe(0);

  const obj = file(wasm.export_obj());
  const faces = obj.text.split("\n").filter((l) => l.startsWith("f "));
  expect(faces.length).toBe(drawnTriangles(ids));
  // Every corner carries a normal (`v//vn`) — a cylinder shades round and its rims stay sharp.
  expect(faces.every((f) => f.split(" ").slice(1).every((c) => /^\d+\/\/\d+$/.test(c)))).toBe(
    true,
  );
};

describe("export", () => {
  for (const [label, source] of EXAMPLES) {
    it(`${label} writes both files`, () => {
      const ids = build(source);
      if (ids.length) checkBoth(ids);
    });
  }

  it("a solid the script keeps but does not show is not written", () => {
    const ids = build(`
      let shown = cylinder({ d: 10, h: 20 });
      let kept = cuboid({ size: [4, 4, 4], corner: [30, 0, 0] });
      display(shown);
    `);
    expect(ids.length).toBe(1);
    checkBoth(ids);
    // The kept box's corner is nowhere in the OBJ.
    const obj = file(wasm.export_obj()).text;
    expect(obj.split("\n").some((l) => l.startsWith("v 30 "))).toBe(false);
  });
});

describe("export menu rules", () => {
  const facts = (outcome: RunFacts["outcome"], bodies: number, sketches = 0): RunFacts => ({
    outcome,
    steps: [],
    drawn: { bodies, sketches },
    autoCopies: 0,
    printed: 0,
  });

  it("offers a file only after a run that worked and drew a body", () => {
    expect(exportable(facts("ok", 1))).toBe(true);
    expect(exportable(facts("ok", 0, 2))).toBe(false);
    expect(exportable(facts("kernel", 1))).toBe(false);
    expect(exportable(facts("script", 1))).toBe(false);
    expect(exportable(facts("drawing", 1))).toBe(false);
  });

  it("stamps a header to the second", () => {
    expect(stepStamp(new Date(Date.UTC(2026, 9, 5, 12, 34, 56, 789)))).toBe(
      "2026-10-05T12:34:56Z",
    );
  });

  it("says nothing about a clean write, and says the rest", () => {
    expect(exportWords("STEP", { ok: true, left: 0 })).toBeNull();
    expect(exportWords("STEP", { ok: true, left: 2 })?.kind).toBe("dim");
    expect(exportWords("STEP", { ok: false, message: "no" })?.kind).toBe("err");
    expect(exportWords("OBJ", null)?.kind).toBe("err");
  });

  it("names the format and says what happened to it", () => {
    const words = (...a: Parameters<typeof exportWords>) => exportWords(...a)?.text;
    expect(words("STEP", { ok: false, message: "no" })).toMatch(/^Export +STEP not written: no$/);
    const opened = "opened in step-loupe";
    expect(words("STEP", { ok: false, message: "no" }, opened)).toMatch(
      /^Export +STEP not opened in step-loupe: no$/,
    );
    expect(words("STEP", { ok: true, left: 1 }, opened)).toMatch(
      /^Export +STEP opened in step-loupe; 1 value stands /,
    );
    expect(words("STEP", { ok: true, left: 0 }, opened)).toBeUndefined();
  });
});
