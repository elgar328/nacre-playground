// The cheat sheet cannot quietly go stale.
//
// Documentation rots by default: the API grows, the summary does not, and nobody
// finds out until a reader is misled. These three tests make the build find out.

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { Recorder, makeApi } from "../src/api/recorder";
import { executeScript } from "../src/app/runtime";
import { cheatScript, cheatText } from "../src/app/cheatsheet";
import { queries } from "./queries";

const text = cheatText();

/** Whole-word search. A plain `includes` would let `X`, `Y` and `Z` match any prose
 * that happens to contain the letter — a check that always passes is a rubber stamp,
 * not a test. */
function mentions(name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(text);
}

describe("the cheat sheet covers what a script can say", () => {
  it("names every global the runtime injects", () => {
    const globals = Object.keys(makeApi(new Recorder()));
    expect(globals.length).toBeGreaterThan(15); // the list is really being read
    const missing = globals.filter((g) => !mentions(g));
    expect(missing).toEqual([]);
  });

  it("names the methods values carry", () => {
    const methods = [
      "vertices", "faces", "nearest", "filter", "maxBy", "isClose",
      "moveTo", "lineTo", "arc", "circle", "close", "rect", "translate", "copy",
      "bodies", "at",
    ];
    expect(methods.filter((m) => !mentions(m))).toEqual([]);
  });

  it("the check bites: a name that does not exist is not found", () => {
    expect(mentions("sphere")).toBe(false);
    expect(mentions("revolve")).toBe(false);
  });
});

describe("the cheat sheet is true", () => {
  it("runs, top to bottom, exactly as shown", () => {
    const script = cheatScript();
    const out = executeScript(script, queries);
    if (!out.ok) throw new Error(`the cheat sheet does not run: ${out.message}`);
    const built = wasm.run(out.steps, undefined);
    expect(built.ok, built.message).toBe(true);
  });

  it("holds nothing back: circles and arcs run with the rest", () => {
    expect(cheatScript()).toContain("circle(");
    expect(cheatScript()).toContain(".arc(");
    expect(cheatScript()).toContain("fillet");
  });
});
