// A failure names the line the value was written on.
//
// **The corpus is the cheat sheet.** `cheatScript()` is the whole vocabulary as
// running code, and `cheatsheet.test.ts` already fails when a global is missing from it.
// So instead of hand-listing the places a wrong value can be written — a list that
// undercounts in silence — this poisons the **numeric values in that script, one at a
// time** and asks the one question this file is about:
//
//   does the failure say the line the poisoned literal is on?
//
// That is stronger than "the app refuses". It is indifferent to *which* layer caught it,
// and it bites the case where a layer catches it and names the wrong line — which is how
// a sketch's pen strokes fail, since the step is recorded later, at `close()`.

import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { executeScript } from "../src/app/runtime";
import { runFacts, summarize } from "../src/app/summary";
import type { Ending } from "../src/app/summary";
import type { RunErr, RunOk } from "../src/api/bridge";
import { cheatScript } from "../src/app/cheatsheet";
import { queries } from "./queries";
import { DEFAULT_COLORS } from "../src/app/viewport";
import { BLAME } from "../src/app/draw";

/** Every numeric literal outside a string, as `[start, end, group)` — `group` being the
 * innermost `[` it sits in, or its own position when it sits in none.
 *
 * A leading `-` belongs to the literal: poisoning the `2` of `[-2, 6]` alone would
 * make `[-"2", 6]`, which is `NaN` — a different failure, and the test would be watching
 * the wrong thing.
 *
 * **One poison per group, not per digit.** The three numbers of `[0, 0, 0]` pass the
 * same door, so poisoning each is three runs' work for one answer — and the corpus is
 * dominated by the runs *after* the first selector, which rebuild the model for real
 * (measured: 159 poisons take 30.7 s, and the ~40 after that selector are nearly all of
 * it). Grouping keeps what distinguishes: `plane({ origin, xPoint, yHint })` is three
 * arrays and stays three. */
function literals(src: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  const open: number[] = [];
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "[") open.push(i);
    else if (c === "]") open.pop();
    if (!/[0-9]/.test(c)) continue;
    // Not the tail of an identifier or a decimal already being read.
    if (i > 0 && /[0-9.\w$]/.test(src[i - 1])) continue;
    let j = i;
    while (j < src.length && /[0-9.]/.test(src[j])) j++;
    // A unary minus, when what precedes it opens a value.
    let from = i;
    if (i > 0 && src[i - 1] === "-") {
      let k = i - 2;
      while (k >= 0 && (src[k] === " " || src[k] === "\n")) k--;
      if (k < 0 || "[(,:=".includes(src[k])) from = i - 1;
    }
    out.push([from, j, open.length ? open[open.length - 1] : from]);
    i = j - 1;
  }
  // One per group, the first of each — a stable choice, so a failure is reproducible.
  const seen = new Set<number>();
  return out.filter(([, , g]) => !seen.has(g) && (seen.add(g), true));
}

const lineOf = (src: string, pos: number) => src.slice(0, pos).split("\n").length;

/** The `Where` row's value, or null when the run said nothing about where.
 *
 * **The app's own gathering, not a copy of it.** Spelling the endings out a second time
 * here would let `main.ts` change its mind about which facts a failure carries while every
 * case below stays green — measuring a shape nobody runs. `runFacts` decides that in one
 * place, and this calls it.
 *
 * Still not end to end: it builds the two endings a poisoned script can reach and never
 * runs `doRun`, which needs a DOM.
 *
 * And it is worth knowing **which road these cases take**: every one of them is named
 * by the stamp a call left on its way past (`thrownAt`), not by a step's recorded line —
 * they refuse before a step is blamed. Measured by dropping `stepLines` from `runFacts`:
 * all of the cases below stay green, and the rotation test goes red. */
function whereOf(code: string): string | null {
  const script = executeScript(code, queries);
  const ending: Ending | null = !script.ok
    ? { script }
    : (() => {
        const out = wasm.run(script.steps, undefined) as RunErr | RunOk;
        return out.ok ? null : { script, out };
      })();
  if (!ending) return null; // the poisoned script ran without complaint
  const row = summarize(runFacts(ending)).header.find((r) => r.text.startsWith("Where"));
  return row ? row.text.slice(14) : null;
}

describe("a failure names the line the value was written on", () => {
  it("every numeric value in the cheat sheet, poisoned one at a time", () => {
    const script = cheatScript();
    const spots = literals(script);
    expect(spots.length).toBeGreaterThan(50); // the corpus is really being read

    const bad: string[] = [];
    for (const [from, to] of spots) {
      const text = script.slice(from, to);
      const want = lineOf(script, from);
      const poisoned = `${script.slice(0, from)}"${text}"${script.slice(to)}`;
      const where = whereOf(poisoned);
      const said = where === null ? "no complaint at all" : where;
      const m = /^line (\d+)\b/.exec(said);
      if (!m || Number(m[1]) !== want) {
        bad.push(`line ${want} (${text}) → ${said}`);
      }
    }
    expect(bad, `${bad.length} of ${spots.length}`).toEqual([]);
  });
});

// The cheat sheet runs most of the vocabulary but not all of it: its coverage test asks
// that a global be *mentioned* in the prose, not that it appear in the runnable rows.
// Measured — `rotateX`, `rotateY` and `pocket` are named there and never called. These
// are the same question by hand, in the shape `recorder.test.ts` already uses for typos.
describe("the calls the cheat sheet names but does not run", () => {
  const box = `let a = cuboid({ size: [4, 4, 2] });\n`;
  const plate = `let p = cuboid({ size: [8, 8, 2] });\nlet f = p.faces().maxBy(f => f.center.z);\n`;

  it("each says the line the value is on", () => {
    for (const [code, want] of [
      [`${box}rotateX(a, "30");`, "line 2 — rotateX"],
      [`${box}a.rotateY("30");`, "line 2 — rotateY"],
      [`${plate}pocket(f, sketch(XY).rect([2,2],[6,6]), "1");`, "line 3 — pocket"],
      [`${box}let b = cuboid({size:[4,4,2],corner:[1,1,0]});\nfuse(a,b).bodies().at("0");`, "line 3 — at"],
      [`${box}style({ opacity: "half" });`, "line 2 — style"],
      [`${box}a.vertices().nearest("origin");`, "line 2 — nearest"],
    ] as const) {
      expect(whereOf(code), code).toBe(want);
    }
  });
});

describe("the values that would otherwise say nothing at all", () => {
  const say = (code: string) => {
    const s = executeScript(code, queries);
    return s.ok ? "" : s.message;
  };

  // Unchecked, every one of these builds something, or draws something, and never says a
  // word — and no check at the wire could reach them: `rect` hands the wire perfectly good
  // numbers, and the other three never cross it at all.
  it("names the value and the call that took it", () => {
    for (const [code, said] of [
      // `Math.min("2", 1)` is 1: unchecked, the rectangle comes out (1,0)–(2,1), silently.
      [`sketch(XY).rect(["2",0],[1,1]);`, `rect's first corner is a point like [0, 0], got ["2", 0]`],
      [`style({ opacity: "abc" });`, `style's opacity is a number, got "abc"`],
      // A number, as far as TypeScript is concerned — and unchecked it takes the model off
      // screen.
      [`style({ opacity: NaN });`, `style's opacity is a number, got NaN`],
      [`cuboid({size:[1,1,1]}).vertices().nearest([0,0]);`, `nearest's point is a point like [0, 0, 0], got [0, 0]`],
      [`cuboid({size:[4,4,2]}).faces().filter(f => f.normal !== null && f.normal.isClose(Z, "close"));`,
        `isClose's tolerance is a number, got "close"`],
    ] as const) {
      expect(say(code), code).toContain(said);
    }
  });

  it("and the ranges nothing else would ever have read", () => {
    for (const [code, said] of [
      [`style({ opacity: 5 });`, "style's opacity runs from 0 (invisible) to 1 (solid), got 5"],
      [`style({ width: -3 });`, "style's width is a positive number of pixels, got -3"],
      [`cuboid({size:[1,1,1]});\ndisplay(cuboid({size:[1,1,1]}), { edges: { width: 0 } });`,
        "display's edges width is a positive number of pixels, got 0"],
      [`cuboid({size:[4,4,2]}).faces().filter(f => f.normal !== null && f.normal.isClose(Z, -1));`,
        "isClose's tolerance is not negative, got -1"],
    ] as const) {
      expect(say(code), code).toContain(said);
    }
  });
});

// The boundary the app's doors stop at. Range and geometry stay the kit's: it knows the model
// and says so far better than a guard here could. If the app ever starts answering these,
// this goes red — which is the point of writing it down.
describe("what the kernel answers, the app leaves alone", () => {
  it("range and fit still come back in the kit's own words", () => {
    for (const [code, said] of [
      [`cuboid({ size: [0, 1, 1] });`, "cuboid size must be positive"],
      [`extrude(sketch(XY).rect([0,0],[1,1]), 0);`, "extrude distance must be nonzero"],
      [`extrude(sketch(XY).rect([0,0],[4,4],{ fillet: 9 }), 1);`, "does not fit"],
      // Not `NaN`: the doors read finiteness ("finite is one rule everywhere"), so the app
      // answers that itself, deliberately. A value that is finite and still out of range
      // is the better control anyway: it shows a value going *through* the door to the kit.
      [`cuboid({ size: [1,1,1] }).rotateZ(1e300);`, "rotation angle"],
    ] as const) {
      const s = executeScript(code, queries);
      expect(s.ok, code).toBe(true); // the app let it through, on purpose
      const out = wasm.run(s.ok ? s.steps : [], undefined);
      expect(out.ok, code).toBe(false);
      expect(out.message, code).toContain(said);
    }
  });
});

// `isClose` takes two things the kit never sees, and unchecked both fail the same silent
// way — the filter simply selects nothing and the script runs on. The tolerance is checked
// with the values above; checking it alone would be a half-fix, so the *first* argument is
// pinned here beside it.
describe("isClose answers for both of its arguments", () => {
  it("a direction that is not one is named, not quietly unmatched", () => {
    const out = executeScript(
      `cuboid({size:[4,4,2]}).faces().filter(f => f.normal !== null && f.normal.isClose("up"));`,
      queries,
    );
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.message).toContain("isClose compares directions");
  });
});

// A colour is a value too, and nothing else looks at it.
//
// `style`'s fields never cross the wire, so the kit never sees them — and measured, the
// kit never looks at a colour anyway: it carries `Option<String>` and validates nothing.
// So for *format* there is no second reader on either path. Unchecked, `style({color: 5})`
// reaches the renderer as written and draws `#000005`; `"reddd"` draws white and warns to
// a browser console the author never opens.
describe("a colour is named when it is not one", () => {
  const say = (code: string) => {
    const out = executeScript(code, queries);
    return out.ok ? "" : out.message;
  };

  it("the shape — anything that is not a string", () => {
    for (const [code, said] of [
      [`style({ color: 5 });`, `style's color is a colour`],
      [`style({ color: [1,2,3] });`, `got [1, 2, 3]`],
      [`style({ color: true });`, `got true`],
      // The same function refuses `opacity: null`; ignoring `color: null` in silence
      // would be one function with two rules.
      [`style({ color: null });`, `got null`],
    ] as const) {
      expect(say(code), code).toContain(said);
    }
  });

  it("the format — a string the renderer would not understand", () => {
    for (const [code, said] of [
      [`style({ color: "reddd" });`, `got "reddd"`],
      [`style({ color: "#7fb2c" });`, `got "#7fb2c"`], // five digits: three takes 3 or 6
      [`style({ color: "" });`, `got ""`],
      // `"constructor" in Color.NAMES` is true — it comes off `Object.prototype` —
      // and three refuses it. Reading the table with `in` instead of a Set would let it
      // through. It has to be *this* name: `"toString"` is lowercased to `"tostring"`
      // before the lookup and so survives the hole by accident — a test of that name alone
      // stays green with the hole open, which planting the violation shows.
      [`style({ color: "constructor" });`, `got "constructor"`],
      [`style({ color: "toString" });`, `got "toString"`],
      // The narrowing chosen here, said out loud: three parses these, the app does
      // not, and the message says what it does take.
      [`style({ color: "rgb(1,2,3)" });`, `got "rgb(1,2,3)"`],
    ] as const) {
      expect(say(code), code).toContain(said);
    }
  });

  it("every place a colour can be written", () => {
    for (const code of [
      `cuboid({size:[1,1,1]});\nstyle({ color: "reddd" });`,
      `display(cuboid({size:[1,1,1]}), { color: "reddd" });`,
      `display(cuboid({size:[1,1,1]}), { edges: { color: "reddd" } });`,
      // The one that does not pass through `styleFields` — `edges` as a bare colour.
      `display(cuboid({size:[1,1,1]}), { edges: "reddd" });`,
    ]) {
      expect(say(code), code).toContain("is a colour");
    }
  });

  it("and what works keeps working", () => {
    for (const code of [
      `style({ color: "#7fb2c8" });`,
      `style({ color: "#f80" });`,
      `style({ color: "red" });`,
      // three lowercases before looking a name up, so this is a colour today.
      `style({ color: "RED" });`,
      `display(cuboid({size:[1,1,1]}), { edges: "#0b1015" });`,
      `display(cuboid({size:[1,1,1]}), { edges: { color: "gray", width: 2 } });`,
    ]) {
      expect(say(code), code).toBe("");
    }
  });
});

// The loop the door closes: with the app's own colours passing it too, **every colour
// the renderer receives is either one of these or one a script wrote and the recorder
// read**. (`editor.ts` also holds two — those are CodeMirror's theme, not the scene's.)
describe("the app's own colours are colours by its own rule", () => {
  it("the viewport's defaults and the refusal marker", () => {
    for (const c of [...Object.values(DEFAULT_COLORS), BLAME.color]) {
      const out = executeScript(`style({ color: ${JSON.stringify(c)} });`, queries);
      expect(out.ok, c).toBe(true);
    }
  });
});

// The kit's words, arriving. Everywhere else the app drives pad and pocket only down the
// success road (`bodies`, `selectors`, `docs`), so this is the one end-to-end check of
// what a person is told when one refuses — a sentence, not just `PocketNotBlind`, the
// Rust variant's name.
describe("an operation's refusal reaches the panel in words", () => {
  // Four thick, asked to pocket four deep: the obvious first try at a hole.
  const THROUGH = `let a = cuboid({ size: [10, 10, 4] });
let top = a.faces().maxBy((f) => f.center.z);
pocket(top, sketch(XY).circle({ center: [0, 0], r: 2 }), 4);
`;

  it("the message is a sentence, and still carries the handle to search with", () => {
    const script = executeScript(THROUGH, queries);
    expect(script.ok, script.ok ? "" : script.message).toBe(true);
    if (!script.ok) return;
    const out = wasm.run(script.steps, undefined) as RunErr | RunOk;
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const sum = summarize(runFacts({ script, out }));
    const message = sum.header.find((r) => r.text.startsWith("Message"))?.text.slice(14);
    expect(message).toContain("has to stop inside the material");
    expect(message).toContain("[PocketNotBlind]");
    // And the place is still named — the sentence is not standing in for the row.
    expect(sum.header.find((r) => r.text.startsWith("Where"))?.text.slice(14)).toBe(
      "line 3 — pocket",
    );
  });
});

// A key that does not answer with a number does not *fail* — it stops meaning
// anything, which is worse. `>` on two strings compares them; on `NaN` it is false every
// time, so the first face wins whatever was asked. Either way a face comes back and
// nothing is said.
describe("maxBy reads the answer its key gives", () => {
  const part = `let a = cuboid({ size: [10, 10, 2] });\n`;

  it("a key that answers with anything else is refused, not obeyed", () => {
    for (const key of ['f => "x"', "f => NaN", "f => undefined", "f => null", "f => ({})"]) {
      const out = executeScript(`${part}a.faces().maxBy(${key});\n`, queries);
      expect(out.ok, key).toBe(false);
      if (out.ok) continue;
      expect(out.message, key).toContain("maxBy's score is a number");
    }
  });

  // …and a key that does answer with one still picks, including a negative.
  it("a real key still chooses", () => {
    for (const key of ["f => f.center.z", "f => -f.center.z", "f => f.area"]) {
      const out = executeScript(`${part}a.faces().maxBy(${key});\n`, queries);
      expect(out.ok, key).toBe(true);
    }
  });
});

// What a door says a value *was*. The sentence names the value so the author can see
// which of theirs it is — and for a value of the API's own, pouring it out means the whole
// recording: `rotateZ(a, a)` would come back 229 characters for one cube and **1416 for
// thirteen**, growing with the model. A cyclic object is worse: composing the message
// would **throw**, so the author would get `Converting circular structure to JSON` and
// never see the door's own words at all. The door shares `print`'s renderer, which names
// every kind and catches the cycle.
describe("a door names a value, it does not pour it out", () => {
  /** The message a door gives for `rotateZ(a, <arg>)`, or null when it did not refuse. */
  function refusalFor(setup: string, arg: string): string | null {
    const out = executeScript(`${setup}\nrotateZ(a, ${arg});\n`, queries);
    return out.ok ? null : out.message;
  }

  const ONE = `let a = cuboid({ size: [1, 1, 1] });`;
  // Thirteen bodies: a sentence that pours the value out carries every one of them.
  const MANY =
    `let a = cuboid({ size: [1, 1, 1] });\n` +
    `for (let i = 1; i < 13; i++) a = fuse(a, cuboid({ size: [1, 1, 1], center: [i * 3, 0, 0] }));`;

  // **The claim is that it does not grow, not that it is short today.** A cap like
  // "under 120 characters" would be a lock on this week's number. Pinning the *whole*
  // sentence closed (`$`) says the same thing and more: nothing can ride along. Asking it
  // of a one-body value and a thirteen-body one is what a poured-out value fails.
  const NAMES_A_SOLID = /^rotateZ's angle is a number, got Solid value \d+$/;

  it("a value of the API's own is named, and the sentence does not grow with it", () => {
    for (const [what, setup] of [
      ["one body", ONE],
      ["thirteen bodies", MANY],
    ] as const) {
      const said = refusalFor(setup, "a");
      expect(said, `${what} — a solid where a number goes is refused`).not.toBeNull();
      expect(said, what).toMatch(NAMES_A_SOLID);
    }
  });

  // The instrument is not vacuous: it does recognise the shape it forbids.
  it("the pattern it forbids is a value poured out", () => {
    expect(`rotateZ's angle is a number, got {"rec":{"steps":[{"Cuboid":{}}]}}`).not.toMatch(
      NAMES_A_SOLID,
    );
    expect("rotateZ's angle is a number, got Solid value 7").toMatch(NAMES_A_SOLID);
  });

  // Composing the message must not be able to fail. `print` says `[object]` here.
  it("a cyclic object gets the door's words, not the engine's", () => {
    const said = refusalFor(`let a = cuboid({ size: [1, 1, 1] });\nlet o = {}; o.self = o;`, "o");
    expect(said).toContain("rotateZ's angle is a number");
    expect(said).toContain("[object]");
    expect(said).not.toContain("circular");
  });

  // The three arms that stay this sentence's own — a string is quoted (`got 30` and
  // `got "30"` are different mistakes), a non-finite is named, and an array is walked.
  it("a string is still quoted, a non-finite still named, an array still walked", () => {
    expect(refusalFor(ONE, '"30"')).toContain('got "30"');
    expect(refusalFor(ONE, "NaN")).toContain("got NaN");
    expect(refusalFor(ONE, "[1, NaN]")).toContain("got [1, NaN]");
    expect(refusalFor(ONE, "{ x: 1 }")).toContain('got {"x":1}');
  });
});

// Every wrong shape a script can write is named by the app, before the wire.
//
// The wire names the step, so the panel can name the line — but the wire's own message
// is serde's (`malformed step: invalid type: string "1", expected f64`, saying nothing
// about *which* argument) or a JavaScript exception's (`TypeError: Reflect.get called on
// non-object`, reachable from a plain typo, `{ pivot: "centre" }`). So the app has a door
// for each argument: measured over a sweep of 30 wrong shapes, **all 30 are named by the
// app**, none reaching the wire and none silent.
//
// That makes the poison corpus above an **app-only** measurement: nothing a script can
// write reaches the wire malformed. The wire's own behaviour is measured directly, in
// `boundary.test.ts`.
describe("every value the app answers for before the wire", () => {
  const say = (code: string) => {
    const out = executeScript(code, queries);
    return out.ok ? "" : out.message;
  };
  const box = `let a = cuboid({ size: [1, 1, 1] });\n`;
  const plate = `let p = cuboid({ size: [8, 8, 2] });\nlet f = p.faces().maxBy(f => f.center.z);\n`;

  it("names the argument and the call, in the kit's own words for the field", () => {
    for (const [code, said] of [
      // A size is not a point, so it does not claim to be one.
      [`cuboid({ size: ["1", 1, 1] });`, `cuboid's size is three numbers like [10, 20, 5], got ["1", 1, 1]`],
      [`cuboid({ size: [1, 1, 1], center: ["0", 0, 0] });`, `cuboid's center is a point like [0, 0, 0]`],
      [`cuboid({ size: [1, 1, 1], corner: [0, 0] });`, `cuboid's corner is a point like [0, 0, 0], got [0, 0]`],
      [`${box}translate(a, ["1", 0, 0]);`, `translate's offset is a point like [0, 0, 0]`],
      [`${box}a.translate(5);`, `translate's offset is a point like [0, 0, 0], got 5`],
      [`${box}rotateZ(a, "30");`, `rotateZ's angle is a number, got "30"`],
      [`${box}a.rotateX("30");`, `rotateX's angle is a number, got "30"`],
      // The typo that would otherwise die as a JavaScript exception.
      [`${box}rotateZ(a, 30, { pivot: "centre" });`, `rotateZ's pivot is a point like [0, 0, 0], got "centre"`],
      [`${box}mirror(a, YZ, { offset: "3" });`, `mirror's offset is a number, got "3"`],
      [`plane(XY, { offset: "3" });`, `plane's offset is a number, got "3"`],
      [`plane(XY, { origin: [0, 0] });`, `plane's origin is a point like [0, 0, 0], got [0, 0]`],
      [`plane({ origin: ["0",0,0], xPoint: [1,0,0], yHint: [0,1,0] });`, `plane's origin is a point like [0, 0, 0]`],
      [`extrude(sketch(XY).rect([0,0],[1,1]), "2");`, `extrude's distance is a number or a range like [-2, 6], got "2"`],
      [`${plate}pad(f, sketch(XY).rect([2,2],[6,6]), "1");`, `pad's depth is a number, got "1"`],
      [`${plate}pocket(f, sketch(XY).rect([2,2],[6,6]), "1");`, `pocket's depth is a number, got "1"`],
    ] as const) {
      expect(say(code), code).toContain(said);
    }
  });

  // `Dist::Both(f64, f64)` is a tuple variant, so serde reads two and **drops the
  // rest**: left to the wire, `[0, 1, 2]` builds z 0…1 and says nothing about the 2. Too
  // few is refused there, too many is not.
  it("a range of the wrong length is refused, in both directions", () => {
    for (const bad of [`[0, 1, 2]`, `[0, 1, 2, 3]`, `[3]`, `[]`, `["0", 2]`])
      expect(say(`extrude(sketch(XY).rect([0,0],[1,1]), ${bad});`), bad)
        .toContain("a number or a range like [-2, 6]");
    // …and the two shapes that are right still are.
    expect(say(`extrude(sketch(XY).rect([0,0],[1,1]), 2);`)).toBe("");
    expect(say(`extrude(sketch(XY).rect([0,0],[1,1]), [-2, 6]);`)).toBe("");
  });
});

// One step, three spellings — and the author gets back the one they wrote.
//
// `Rotate` carries its axis, so the step can name itself `rotateZ` the way `Boolean`
// already names itself `fuse`. Without that the two layers disagree about the same line:
// the app's door would say `rotateZ` and a kernel refusal on the same step `rotate`.
// A failure states where **once**, and the app is the one that says it.
//
// Neither the kit nor the app's selector door opens a sentence with `step N: ` — two such
// prefixes would make the panel read `Where line 2 — extrude` beside `Message step 1:
// step 1: …`. The index rides the error's own field; `summary.ts` turns it into the line
// the author wrote, and the sentence says only what is wrong.
describe("a refusal says where once, in the app's words", () => {
  /** The `Message` row's value, or null when there is none. */
  function messageOf(sum: ReturnType<typeof summarize>): string | null {
    const row = sum.header.find((r) => r.text.startsWith("Message"));
    return row ? row.text.slice(14) : null;
  }

  /** Everything the app was told, for a script that fails on one road or the other. */
  function ending(code: string) {
    const script = executeScript(code, queries);
    if (!script.ok) return summarize(runFacts({ script }));
    const out = wasm.run(script.steps, undefined) as RunErr | RunOk;
    if (out.ok) throw new Error("expected a refusal");
    return summarize(runFacts({ script, out }));
  }

  const STATES_A_STEP = /^step \d+: /;

  const ROADS: [string, string, string, string][] = [
    [
      "the kernel refuses the whole build",
      `let s = sketch(XY).rect([0, 0], [1, 1]);\nextrude(s, 0);\n`,
      "line 2 — extrude",
      "must be nonzero",
    ],
    [
      "a selector forces a build and it refuses",
      `let a = cuboid({ size: [0, 1, 1] });\na.faces();\n`,
      "line 1 — cuboid",
      "must be positive",
    ],
  ];

  // Three claims per case, together: it refused, it says its own words, and it does not
  // repeat the place. On its own the third passes for a run that never failed.
  it("neither road repeats the step in its sentence", () => {
    for (const [what, code, , owed] of ROADS) {
      const sum = ending(code);
      const said = messageOf(sum);
      expect(sum.failed, what).toBe(true);
      expect(said, what).toContain(owed);
      expect(said, `${what} — the message states the step: ${said}`).not.toMatch(STATES_A_STEP);
    }
  });

  // And the place is still named — the `Where` row is the only one saying it.
  it("…and both still say where, in the line the author wrote", () => {
    for (const [what, code, where] of ROADS) {
      const row = ending(code).header.find((r) => r.text.startsWith("Where"));
      expect(row?.text.slice(14), what).toBe(where);
    }
  });

  // The instrument is not vacuous: it does recognise the shape it forbids.
  it("the pattern it forbids is a sentence that states its step", () => {
    expect("step 1: extrude distance must be nonzero").toMatch(STATES_A_STEP);
    expect("stepwise refusal").not.toMatch(STATES_A_STEP);
  });
});

describe("a rotation is called what the script called it", () => {
  const box = `let a = cuboid({ size: [1, 1, 1] });\n`;

  it("the app's door", () => {
    expect(whereOf(`${box}rotateZ(a, "30");`)).toBe("line 2 — rotateZ");
    expect(whereOf(`${box}a.rotateY("30");`)).toBe("line 2 — rotateY");
  });

  // 1e300 is finite, so it passes the door and the kernel answers — which makes this
  // the negative control too: range stays the kit's.
  it("…and the kernel's refusal on the same step", () => {
    const s = executeScript(`${box}rotateZ(a, 1e300);`, queries);
    expect(s.ok).toBe(true);
    const out = wasm.run(s.ok ? s.steps : [], undefined);
    expect(out.ok).toBe(false);
    expect(out.message).toContain("rotation angle");
    expect(whereOf(`${box}rotateZ(a, 1e300);`)).toBe("line 2 — rotateZ");
  });
});
