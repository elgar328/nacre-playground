// What a run says, in words — the wording is decided in one place, so it is checked in
// one place.
//
// These are string comparisons on purpose. The table is a table because a monospace
// column lines up; an alignment regression is invisible in a screenshot and obvious in a
// character count.

import { describe, expect, it } from "vitest";
import { duration, runFacts, showingWords, summarize } from "../src/app/summary";
import type { Ending, Outcome, RunFacts } from "../src/app/summary";
import type { RunErr, RunOk } from "../src/api/bridge";
import type { ScriptFail, ScriptOk } from "../src/app/runtime";
import type { Step } from "../src/api/steps";

const box: Step = { Cuboid: { size: [1, 1, 1], at: { Center: [0, 0, 0] } } };
const cut: Step = { Boolean: { kind: "Cut", args: [0, 1] } };
const cyl: Step = {
  Cylinder: { radius: 1, height: 2, at: { Center: [0, 0, 0] }, axis: "Z" },
};

/** **Written out, not built by `runFacts`.** This is what `summarize()` is measured
 * against, and a fixture derived from the other half of the file would leave both halves
 * comparing one derivation with itself — the shape of a silent wrong answer. The endings
 * below exercise `runFacts`; this does not. */
const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  outcome: "ok",
  ms: 234,
  steps: [box],
  drawn: { bodies: 1, sketches: 0 },
  autoCopies: 0,
  printed: 0,
  ...over,
});

/** The label column, mirrored from `summary.ts` on purpose: the number is the claim, so
 * a test that read it from the source could not disagree with it. */
const LABEL = 14;

// ───────────────────────────────────────────────────────────────────────────────────────
// Gathering the facts, before any of them are put into words.

const ranScript: ScriptOk = {
  ok: true,
  steps: [box, cut, cyl],
  sceneStyle: {},
  sceneView: {},
  output: ["one", "two"],
  printed: 2,
  stepLines: [7, 8, 9],
};

/** A script that stopped partway: it still knows what it had recorded. */
const brokeScript: ScriptFail = {
  ok: false,
  message: "cut needs two solids",
  steps: [box, cut],
  step: 1,
  printed: 2,
  stepLines: [7, 8],
  thrownAt: { line: 4, name: "cut" },
};

/** …and one that never ran at all — the three fields are simply absent. */
const noScript: ScriptFail = { ok: false, message: "syntax: unexpected }" };

const built: RunOk = {
  ok: true,
  rendered: [0],
  autoCopies: [1, 2],
  reports: [null],
  values: ["solid"],
};
const refused: RunErr = { ok: false, step: 1, message: "the kernel would not cut those" };

const ENDINGS: [string, Ending, Outcome][] = [
  ["a script that stopped", { script: brokeScript, showing: "2 of 3 steps" }, "script"],
  ["a build the kernel refused", { script: ranScript, out: refused, showing: "2 of 3 steps" }, "kernel"],
  ["a result that could not be drawn", { script: ranScript, out: built, drawn: { error: "no mesh" } }, "drawing"],
  [
    "a run that worked",
    { script: ranScript, out: built, drawn: { drawn: { bodies: 2, sketches: 1 } }, ms: 12 },
    "ok",
  ],
];

describe("an ending says what kind of ending it was", () => {
  it("each of the four names its own outcome", () => {
    for (const [what, ending, outcome] of ENDINGS)
      expect(runFacts(ending).outcome, what).toBe(outcome);
  });

  // **The claim this block is for.** These three are gathered once, not spelled at every
  // place a run can end, defaults and all — where a branch that dropped one would report
  // the wrong line in silence, because nothing downstream can tell a missing line from a
  // script that never had one.
  it("no ending can drop the steps, their lines, or what was printed", () => {
    for (const [what, ending] of ENDINGS) {
      const f = runFacts(ending);
      expect(f.steps, what).toEqual(ending.script.steps);
      expect(f.stepLines, what).toEqual(ending.script.stepLines);
      expect(f.printed, what).toBe(ending.script.printed);
    }
  });

  it("…and a script that never ran says so in the same three fields", () => {
    const f = runFacts({ script: noScript });
    expect([f.steps, f.stepLines, f.printed]).toEqual([[], undefined, 0]);
  });

  // The type already forbids a time on the other three arms; this watches the value, so
  // that adding one to a failure has to fail somewhere even if the type is widened.
  it("only the ending that worked carries a time", () => {
    for (const [what, ending] of ENDINGS)
      expect(runFacts(ending).ms, what).toBe(ending === ENDINGS[3][1] ? 12 : undefined);
  });

  // **Planted, it does not type-error.** An ending assembled as a variable is not checked
  // for stray fields, so a branch that read `ms` would let one riding along on a drawing
  // failure flip the outcome to `ok` — and `summarize` would then throw on a `drawn` that
  // is not there. The branch reads what the drawing pass returned instead.
  it("a drawing failure stays one even with a time riding along", () => {
    const [, drawing] = ENDINGS[2];
    const stray: Ending = { ...drawing, ms: 5 } as Ending;
    expect(runFacts(stray).outcome).toBe("drawing");
    expect(() => summarize(runFacts(stray))).not.toThrow();
  });

  // Nothing was drawn, so there is nothing to say about what is on screen.
  it("a drawing failure says nothing about what is showing", () => {
    expect(ENDINGS.map(([, e]) => runFacts(e).showing)).toEqual([
      "2 of 3 steps",
      "2 of 3 steps",
      undefined,
      undefined,
    ]);
  });

  it("each failure carries its own words, and a run that worked carries none", () => {
    expect(ENDINGS.map(([, e]) => runFacts(e).message)).toEqual([
      "cut needs two solids",
      "the kernel would not cut those",
      "no mesh",
      undefined,
    ]);
  });

  it("what was drawn, and what was copied, are counted only where they exist", () => {
    const [, ok] = ENDINGS[3];
    expect(runFacts(ok).drawn).toEqual({ bodies: 2, sketches: 1 });
    expect(runFacts(ok).autoCopies).toBe(2);
    for (const [what, ending] of ENDINGS.slice(0, 3)) {
      expect(runFacts(ending).drawn, what).toEqual({ bodies: 0, sketches: 0 });
      expect(runFacts(ending).autoCopies, what).toBe(0);
    }
  });

  // The blamed step travels: a script that stopped at a build knows which one, and so
  // does the kernel's own refusal.
  it("the failing step comes through from whichever half knew it", () => {
    expect(ENDINGS.map(([, e]) => runFacts(e).step)).toEqual([1, 1, undefined, undefined]);
  });
});

describe("the status line", () => {
  it("a run that worked says how long it took, and nothing else", () => {
    expect(summarize(facts()).status).toEqual({ chip: null, text: "built in 234 ms" });
  });

  it("…and says the rest only when there is something to say", () => {
    expect(summarize(facts({ printed: 4 })).status.text).toBe("built in 234 ms · 4 printed");
    expect(summarize(facts({ drawn: { bodies: 0, sketches: 0 } })).status.text).toBe(
      "built in 234 ms · nothing drawn",
    );
    // Both at once, in that order.
    expect(
      summarize(facts({ printed: 1, drawn: { bodies: 0, sketches: 0 } })).status.text,
    ).toBe("built in 234 ms · 1 printed · nothing drawn");
  });

  // `nothing drawn` is about the **screen**, so it has to read both halves. Dropping
  // the sketch half leaves every other test green — and a sketch-only run is not a corner
  // case here: it is what `display(a_sketch)` does, and what an unused sketch does by
  // itself. It would be told its viewport is empty while it is looking at lines.
  it("…and a run that drew only a sketch is not told it drew nothing", () => {
    expect(summarize(facts({ drawn: { bodies: 0, sketches: 1 } })).status.text).toBe(
      "built in 234 ms",
    );
    expect(summarize(facts({ drawn: { bodies: 2, sketches: 0 } })).status.text).toBe(
      "built in 234 ms",
    );
  });

  it("a failure raises a chip, names the operation, and keeps the message out", () => {
    const s = summarize(
      facts({
        outcome: "kernel",
        ms: undefined,
        step: 2,
        steps: [box, cyl, cut],
        message: "the kernel does not build this — a very long sentence",
      }),
    );
    expect(s.status.chip).toBe("FAILED");
    expect(s.status.text).toBe("in cut");
    expect(s.failed).toBe(true);
    // The message is the panel's, not the status line's.
    expect(s.status.text).not.toContain("kernel does not build");
  });

  it("the three failures are told apart", () => {
    const script = summarize(facts({ outcome: "script", ms: undefined, message: "bad call" }));
    const drawing = summarize(facts({ outcome: "drawing", ms: undefined, message: "no mesh" }));
    expect(script.status).toEqual({ chip: "FAILED", text: "" });
    // `drawing` is the one that built and could not be shown — the author needs that
    // apart from a build that failed.
    expect(drawing.status).toEqual({ chip: "FAILED", text: "while drawing" });
  });

  it("a failure carries no time — not in the line, not in the table", () => {
    const s = summarize(
      facts({ outcome: "kernel", ms: undefined, step: 0, message: "no" }),
    );
    expect(s.status.text).not.toMatch(/ms|\bs\b/);
    expect(s.header.map((r) => r.text).join("\n")).not.toContain("Time");
    // …and a run that worked does carry it.
    expect(summarize(facts()).header[0].text).toContain("Time");
  });
});

describe("the panel's header", () => {
  it("every value starts in the same column", () => {
    const s = summarize(facts({ autoCopies: 6, steps: [box, cyl, cut] }));
    expect(s.header.length).toBe(4);
    for (const r of s.header) {
      // The label owns the first 14 characters and is padded with spaces to fill them…
      const head = r.text.slice(0, LABEL);
      expect(head, r.text).toBe(head.trimEnd().padEnd(LABEL));
      // …so the last of those is blank and the value begins right after it. Narrow the
      // column and the 14th character stops being a space.
      expect(r.text[LABEL - 1], r.text).toBe(" ");
      expect(r.text[LABEL], r.text).not.toBe(" ");
    }
  });

  it("reads as a table", () => {
    const s = summarize(facts({ autoCopies: 6, steps: [box, cyl, cut, cut] }));
    expect(s.header.map((r) => r.text)).toEqual([
      "Time          234 ms",
      "Drawn         1 body",
      "Operations    4 — cuboid, cylinder, cut ×2",
      "Auto copies   6 — a value is copied before it is consumed, so the original stays usable",
    ]);
  });

  it("a row is there only when it has something to say", () => {
    // No automatic copies, so no row about them.
    expect(summarize(facts()).header.map((r) => r.text.slice(0, 11))).toEqual([
      "Time       ",
      "Drawn      ",
      "Operations ",
    ]);
    // A script refused before any operation: one row, and no `Where` to invent.
    const early = summarize(facts({ outcome: "script", ms: undefined, message: "bad call" }));
    expect(early.header.map((r) => r.text)).toEqual(["Message       bad call"]);
  });

  it("the failure's own words are the red row, and a good run has none", () => {
    const bad = summarize(
      facts({ outcome: "kernel", ms: undefined, step: 0, steps: [box], message: "no" }),
    );
    expect(bad.header).toEqual([
      { text: "Where         step 0 — cuboid" },
      { text: "Message       no", kind: "err" },
    ]);
    expect(summarize(facts()).header.some((r) => r.kind === "err")).toBe(false);
  });

  // The unit is the **body**, not the value. One `Solid` value holds zero or more
  // disjoint bodies, so a `fuse` of two cubes that only touch along an edge is one value
  // and two bodies — and the author is looking at two. `tests/bodies.test.ts` holds the
  // end-to-end half of this: that the number really comes from the kernel.
  it("names what is on screen, by kind", () => {
    const of = (drawn: RunFacts["drawn"]) =>
      summarize(facts({ drawn })).header[1].text.slice(14);
    expect(of({ bodies: 1, sketches: 0 })).toBe("1 body");
    expect(of({ bodies: 2, sketches: 1 })).toBe("2 bodies, 1 sketch");
    expect(of({ bodies: 0, sketches: 3 })).toBe("3 sketches");
    expect(of({ bodies: 7, sketches: 2 })).toBe("7 bodies, 2 sketches");
    // `display(sketch)` on a script that also built solids: the row follows the
    // screen, so the bodies are not in it.
    expect(of({ bodies: 0, sketches: 0 })).toBe("nothing");
  });
});

describe("where a failure was written", () => {
  it("a kernel refusal names the line the step was recorded from", () => {
    const s = summarize(
      facts({
        outcome: "kernel",
        ms: undefined,
        step: 2,
        steps: [box, cyl, cut],
        stepLines: [1, 2, 7],
        message: "no",
      }),
    );
    expect(s.header[0].text).toBe("Where         line 7 — cut");
    expect(s.status.text).toBe("line 7 in cut");
  });

  it("a script refusal names the call it was thrown from", () => {
    const s = summarize(
      facts({
        outcome: "script",
        ms: undefined,
        message: "lineTo does not take 'filet'",
        thrownAt: { line: 4, name: "lineTo" },
      }),
    );
    expect(s.header[0].text).toBe("Where         line 4 — lineTo");
    expect(s.status.text).toBe("line 4 in lineTo");
  });

  // A selector forces a build in the middle of a script, so a kernel refusal can be
  // *thrown* from the line that merely asked — `part.faces()`. The stamp would name that
  // line and be confidently wrong; the blamed step's own line is the answer.
  it("a step's line beats the line the throw came from", () => {
    const s = summarize(
      facts({
        outcome: "kernel",
        ms: undefined,
        step: 1,
        steps: [box, cut],
        stepLines: [1, 2],
        thrownAt: { line: 9, name: "faces" }, // where the build was forced
        message: "no",
      }),
    );
    expect(s.header[0].text).toBe("Where         line 2 — cut");
    expect(s.status.text).not.toContain("faces");
  });

  // A selector forces a build in the middle of a script, and the refusal comes back by
  // being *thrown* — so it arrives as a `script` outcome that nevertheless knows the step.
  // Applied only to `kernel`, the rule above misses exactly this: measured, that way
  // `cuboid({size:[0,1,1]}).faces()` says `line 3 — faces` for a value written on line 1.
  it("…and it wins on the script path too, which is where the selector lands", () => {
    const s = summarize(
      facts({
        outcome: "script",
        ms: undefined,
        step: 0,
        steps: [box, cut],
        stepLines: [1, 2],
        thrownAt: { line: 3, name: "faces" }, // the selector that forced the build
        message: "cuboid size must be positive",
      }),
    );
    expect(s.header[0].text).toBe("Where         line 1 — cuboid");
    expect(s.status.text).toBe("line 1 in cuboid");
    expect(s.header[0].text).not.toContain("faces");
  });

  it("with no line known, it names the step — and invents nothing", () => {
    const s = summarize(
      facts({ outcome: "kernel", ms: undefined, step: 1, steps: [box, cut], message: "no" }),
    );
    expect(s.header[0].text).toBe("Where         step 1 — cut");
    const bare = summarize(facts({ outcome: "script", ms: undefined, message: "bad call" }));
    expect(bare.header.map((r) => r.text)).toEqual(["Message       bad call"]);
    expect(bare.status.text).toBe("");
  });
});

describe("what a failure is showing, in words", () => {
  const words = (steps: number, blamed = 0, marked = false) =>
    showingWords({ steps, blamed, marked, colour: "red" });

  // `the 1 step` is not English: handling the plural is not enough, the article has to
  // follow it. One step is *the* step.
  it("one step is the step, and more are counted", () => {
    expect(words(1)).toBe("the step before it");
    expect(words(2)).toBe("the 2 steps before it");
    expect(words(11)).toBe("the 11 steps before it");
  });

  // A value can be blamed against itself — `fuse(a, a)` comes back `between value 0
  // and value 0`, and exactly one thing turns red. The clause must not say "the two".
  it("the clause counts what is actually red", () => {
    expect(words(3, 1)).toBe("the 3 steps before it and the one it would not combine in red");
    expect(words(3, 2)).toBe("the 3 steps before it and the two it would not combine in red");
  });

  // The join: two clauses take `and`, three
  // take commas *and* `and`. Run together they read `… in red and a red cross …`.
  it("the clauses are joined as a list, not glued", () => {
    expect(words(5, 2)).toBe("the 5 steps before it and the two it would not combine in red");
    expect(words(5, 0, true)).toBe("the 5 steps before it and a red cross where it failed");
    expect(words(5, 2, true)).toBe(
      "the 5 steps before it, the two it would not combine in red, and a red cross where it failed",
    );
  });

  // The colour is the caller's to say — it is a fact about what was drawn, and an
  // article written ahead of the colour word reads wrong for any other word.
  it("the colour word comes from whoever drew it", () => {
    expect(showingWords({ steps: 1, blamed: 1, marked: false, colour: "amber" })).toContain(
      "in amber",
    );
  });
});

describe("duration — one rule, both readers", () => {
  it("has one boundary, and never says a run took no time", () => {
    expect(duration(0)).toBe("<1 ms");
    expect(duration(0.4)).toBe("<1 ms");
    expect(duration(1)).toBe("1 ms");
    expect(duration(234.6)).toBe("235 ms");
    expect(duration(999)).toBe("999 ms");
    expect(duration(1000)).toBe("1.0 s"); // the boundary is `>=`, not `>`
    expect(duration(20000)).toBe("20.0 s");
  });

  it("the status line and the table print the same string", () => {
    for (const ms of [0.4, 999, 1000, 20000]) {
      const s = summarize(facts({ ms }));
      const inTable = s.header[0].text.slice(14);
      expect(s.status.text, String(ms)).toBe(`built in ${inTable}`);
    }
  });
});
