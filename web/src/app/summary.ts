// What a run has to say — gathered in one place, and put into words in one place.
//
// **Two readers, one author.** The status line answers "did it work, and how long
// did it take"; the output panel answers "what happened". Both are the same run, so both
// come from here — `output.ts` already argues the case for its own content ("the same
// rule written in several spots … is how two of them come to disagree"), and a status
// line assembled inline at each of the places a run can end would be that other spot.
//
// Nothing here knows the DOM. The chip is a string or nothing, a row is text plus the
// voice it should be read in, and drawing them is `main.ts`'s and `output.ts`'s job —
// which is what makes every shape below testable.
//
// **Both directions of `RunFacts` live here** — `runFacts()` gathers them from what a
// run actually did, and `summarize()` turns them into words. Gathering them at each of the
// four endings in `main.ts` — through a helper of eight positional arguments, or written
// out inline — is a shape which goes wrong quietly: a branch forgetting `stepLines`
// reports the wrong line, and nothing fails.

import type { RunErr, RunOk } from "../api/bridge";
import type { Step } from "../api/steps";
import { stepName } from "./runtime";
import type { ScriptFail, ScriptOk } from "./runtime";

/** How a run ended. `drawing` is the one worth telling apart: the geometry *built*, and
 * turning it into something to look at is what failed. */
export type Outcome = "ok" | "script" | "kernel" | "drawing";

/** What every ending knows. No `Recorder`, no `Viewport`, no wasm handles. */
export interface RunFacts {
  outcome: Outcome;
  /** Milliseconds — the build, not the paint. Absent on a failure: how long a run took
   * to fail is not a useful fact, and measuring it at four endings to say so is worse. */
  ms?: number;
  message?: string;
  /** The failing step's index, when a step failed. */
  step?: number;
  steps: Step[];
  /** Per step: the line it was recorded from. Parallel to `steps`. */
  stepLines?: (number | null)[];
  /** Where the throw came from, when a marker stamped it.
   *
   * Both of these arrive raw and **the choosing happens here** — a rule kept in
   * `main.ts` would be a rule with no test around it. */
  thrownAt?: { line: number; name: string };
  /** What ended up on screen, counted by kind — from the drawing pass, not from the
   * kit's render list: a value can be in that list and still produce no mesh.
   *
   * **Bodies, not values.** One `Solid` value holds zero or more disjoint bodies, and a
   * `fuse` of two cubes that only touch along an
   * edge is one value showing **two** — which the author can see. Counting values would
   * say `1` there, and `1` for an empty `common` as well. */
  drawn: { bodies: number; sketches: number };
  autoCopies: number;
  /** `print(...)` calls, which is not `lines().length` — that one carries the cap's own
   * closing note. */
  printed: number;
  /** What the viewport is showing after a failure, in words — the prefix that did build,
   * and what the kernel pointed at. Absent when there was nothing to show.
   *
   * A row, not the status line's `title`, which a phone never sees. */
  showing?: string;
}

export interface Row {
  text: string;
  /** The voice: `err` for the failure's own words, `dim` for an aside. */
  kind?: "err" | "dim";
}

export interface Summary {
  status: { chip: string | null; text: string };
  header: Row[];
  failed: boolean;
}

/** The label column. Monospace plus a hanging indent makes a table out of plain text. */
const LABEL = 14;

const row = (label: string, value: string, kind?: Row["kind"]): Row => ({
  text: `${label.padEnd(LABEL)}${value}`,
  ...(kind ? { kind } : {}),
});

/** **One rule, both readers.** The status line and the table's `Time` row say the same
 * thing about the same run; two spellings of a duration is exactly the disagreement this
 * file exists to prevent.
 *
 * `0 ms` would read as "it took no time", so anything under a millisecond says so
 * instead. The one boundary is a second. */
export function duration(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** `cuboid ×2, sketch, extrude` — the operations in the order they first appear.
 *
 * A count alone ("10 steps") is the thing this cell set out to remove: it is the step
 * log's length, and a reader cannot turn it back into anything they wrote. The names can
 * be read without counting. */
function operations(steps: Step[]): string {
  const seen = new Map<string, number>();
  for (const s of steps) {
    const name = stepName(s) ?? "?";
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  const parts = [...seen].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
  return `${steps.length} — ${parts.join(", ")}`;
}

/** `1 body` · `2 bodies, 1 sketch` · `nothing`. */
function drawnAs({ bodies, sketches }: RunFacts["drawn"]): string {
  const parts: string[] = [];
  if (bodies) parts.push(`${bodies} ${bodies === 1 ? "body" : "bodies"}`);
  if (sketches) parts.push(`${sketches} ${sketches === 1 ? "sketch" : "sketches"}`);
  return parts.length ? parts.join(", ") : "nothing";
}

/** The blamed step's own line and word, when a step is blamed at all.
 *
 * **A step's line wins over a stamped one — whichever way the run ended.** A selector
 * forces a build mid-script (`part.faces()`), so a kernel refusal can be *thrown* from a
 * line that merely asked; the stamp would name `faces()` and be confidently wrong.
 *
 * The rule is not confined to `outcome: "kernel"`: a selector's refusal comes back
 * through `Recorder.ensureBuilt`, which *throws*, so it arrives as `"script"` **carrying
 * a step**. Measured: read on the kernel arm alone, `cuboid({size:[0,1,1]}).faces()`
 * says `line 3 — faces` for a value written on line 1.
 *
 * Widening is safe because `step` has one producer: `ensureBuilt` is the only place
 * that throws a `ScriptError` with one, so "a step is known" means "the kit refused at
 * that step" and nothing else. */
function blamed(run: RunFacts): { line: number | null; name: string | null } | null {
  if (run.step === undefined) return null;
  return {
    line: run.stepLines?.[run.step] ?? null,
    name: stepName(run.steps[run.step]),
  };
}

/** Where a failure happened, in the line and the word the author wrote.
 *
 * **The line is the app's own record, not the engine's.** Asking an engine would mean
 * a stack trace, and no engine gives a position for a generated function in every browser
 * (Safari gives none) — a feature that works in some browsers is worse than none, because
 * the author cannot tell which behaviour is correct. So the runtime marks every call as it
 * goes past. `app/mark.ts` says how.
 *
 * When no line is known — marking was off, or nothing recorded one — this falls back to
 * the step, which is what it said before. Nothing is invented. */
function where(run: RunFacts): string | null {
  if (run.outcome === "drawing") return "while drawing the result";

  const b = blamed(run);
  if (b) {
    if (b.line !== null) return b.name ? `line ${b.line} — ${b.name}` : `line ${b.line}`;
    return b.name ? `step ${run.step} — ${b.name}` : `step ${run.step}`;
  }
  // A script that refused before any operation still knows the call it refused in.
  if (run.thrownAt) {
    const { line, name } = run.thrownAt;
    return name ? `line ${line} — ${name}` : `line ${line}`;
  }
  return null;
}

/** The status line's half-sentence: where, in as few words as fit on one line. Same rule
 * as `where()`, and it reads the same answer rather than re-deciding it. */
function chipWords(run: RunFacts): string {
  const b = blamed(run);
  const line = b ? b.line : (run.thrownAt?.line ?? null);
  const name = b ? b.name : (run.thrownAt?.name ?? null);
  const parts: string[] = [];
  if (line !== null) parts.push(`line ${line}`);
  if (name) parts.push(`in ${name}`);
  return parts.join(" ");
}

/** What a failed run's viewport is showing, in words — the `Showing` row's value.
 *
 * **Wording, so it is decided here.** Assembled beside the drawing, it would be the one
 * sentence in the app with no test around it — and it goes wrong in ways a reader only
 * notices late: `an red`, for a colour word that never arrives, and `the 1 step`, which
 * is not English.
 *
 * The pieces are optional and the join is not `+`. With all three, running them
 * together reads `… in red and a red cross …`, one list wearing two conjunctions. The kit
 * has a refusal that carries a blamed pair and a witness location at once
 * (`nacre-kit/src/build.rs` builds it), so the three-clause form is not hypothetical —
 * though no script tried here has produced one.
 *
 * `colour` comes from the caller because it is a fact about what was *drawn*. */
export function showingWords(what: {
  /** How many steps built — at least one; nothing to show is said by not showing a row. */
  steps: number;
  /** How many values the kernel blamed, and so how many are drawn in `colour`.
   *
   * **Two, or one.** A value can be blamed against itself: `fuse(a, a)` comes back
   * `between value 0 and value 0`, and one thing turns red. Saying "the two" regardless
   * would be wrong where the reader can count. */
  blamed: number;
  /** Whether a cross marks where the kernel was looking. */
  marked: boolean;
  colour: string;
}): string {
  const parts = [`the ${what.steps === 1 ? "step" : `${what.steps} steps`} before it`];
  if (what.blamed)
    parts.push(`the ${what.blamed === 1 ? "one" : "two"} it would not combine in ${what.colour}`);
  if (what.marked) parts.push(`a ${what.colour} cross where it failed`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** How a run ended, as data — one of exactly four shapes.
 *
 * **The shape is the outcome.** A script that never finished recording, a build the
 * kernel refused, a build that could not be drawn, and one that worked: nothing else can
 * be constructed, so no caller can describe an ending that did not happen. The two
 * failures that draw a prefix carry the sentence it handed back; the drawing failure
 * cannot (there was nothing to show), and a run that worked is the only one with a time.
 *
 * **How far that goes, measured.** An ending *written out* at the call site is checked
 * for stray fields, and `main.ts` writes all four out. One built as a variable is not —
 * TypeScript only rejects excess properties on a literal — so the branches below read
 * what an ending *holds* rather than trusting that nothing extra rode along.
 *
 * `showing` is passed in rather than derived because producing it *draws* — `main.ts`
 * rebuilds the prefix into the viewport and keeps the sentence. Effects do not belong in
 * here, so the caller hands over what it learned. */
export type Ending =
  | { script: ScriptFail; showing?: string }
  | { script: ScriptOk; out: RunErr; showing?: string }
  | { script: ScriptOk; out: RunOk; drawn: { error: string } }
  | { script: ScriptOk; out: RunOk; drawn: { drawn: RunFacts["drawn"] }; ms: number };

/** What a run has to say about itself, gathered from what it did.
 *
 * **Everything a caller could forget is read here instead.** `steps`, `stepLines` and
 * `printed` are optional on a failed script — they are absent only when nothing ran — so
 * they come off `script` here, defaults and all. Repeating the defaults in every branch
 * lets a branch that drops one report a wrong line in silence.
 *
 * `stepLines` and `thrownAt` are handed over **raw**: which of the two answers for
 * "where" wins is `summarize()`'s to decide, and a rule kept outside it would be a rule
 * with no test around it. */
export function runFacts(e: Ending): RunFacts {
  const s = e.script;
  const common = {
    steps: s.steps ?? [],
    stepLines: s.stepLines,
    printed: s.printed ?? 0,
    drawn: { bodies: 0, sketches: 0 },
    autoCopies: 0,
  };
  // The branches are told apart by **what the ending has**, not by a tag handed in with
  // it: an ending with no `out` is one whose script never finished, one with no `drawn` is
  // a build the kernel refused. There is nothing extra to keep in step, and TypeScript
  // narrows on exactly this — so reading a field a branch cannot have does not compile.
  if (!("out" in e))
    return {
      ...common,
      outcome: "script",
      message: e.script.message,
      step: e.script.step,
      thrownAt: e.script.thrownAt,
      showing: e.showing,
    };
  if (!("drawn" in e))
    return {
      ...common,
      outcome: "kernel",
      message: e.out.message,
      step: e.out.step,
      showing: e.showing,
    };
  // …and the last two by what the drawing pass came back with.
  //
  // **The fact, not a proxy for it.** Splitting these on `ms` instead reads as well —
  // only a run that worked has a time — and it is wrong for a reason worth keeping: an
  // ending that carries a stray `ms` type-checks, and the outcome would flip to `ok` on
  // a drawing that never happened. Measured: `drawn` came out `undefined` and the
  // wording below threw. What went wrong with the drawing is the thing being asked about.
  const { drawn } = e;
  if ("error" in drawn) return { ...common, outcome: "drawing", message: drawn.error };
  return {
    ...common,
    outcome: "ok",
    // `in` for the reading only — the outcome is already decided above.
    ms: "ms" in e ? e.ms : 0,
    drawn: drawn.drawn,
    autoCopies: e.out.autoCopies.length,
  };
}

export function summarize(run: RunFacts): Summary {
  const header: Row[] = [];
  const w = where(run);

  if (run.outcome === "ok") {
    // The order is the rule: how long, then what came of it, then the detail.
    header.push(row("Time", duration(run.ms ?? 0)));
    header.push(row("Drawn", drawnAs(run.drawn)));
    if (run.steps.length) header.push(row("Operations", operations(run.steps)));
    if (run.autoCopies)
      header.push(
        row(
          "Auto copies",
          `${run.autoCopies} — a value is copied before it is consumed, so the original stays usable`,
        ),
      );
    const tail: string[] = [];
    // Said only when there is something to say: the panel is worth opening for printed
    // lines, and an empty viewport after a run that worked needs explaining.
    if (run.printed) tail.push(`${run.printed} printed`);
    if (!run.drawn.bodies && !run.drawn.sketches) tail.push("nothing drawn");
    return {
      status: { chip: null, text: [`built in ${duration(run.ms ?? 0)}`, ...tail].join(" · ") },
      header,
      failed: false,
    };
  }

  if (w) header.push(row("Where", w));
  if (run.showing) header.push(row("Showing", run.showing, "dim"));
  if (run.message) header.push(row("Message", run.message, "err"));
  return {
    status: {
      chip: "FAILED",
      // The operation's own word, when there is one. The message itself stays in the
      // panel: a status line is one line, and the kernel's sentences are not.
      // The same facts, said shorter. `line 4 in lineTo` is the one thing worth a glance
      // before the panel is open.
      text: run.outcome === "drawing" ? "while drawing" : chipWords(run),
    },
    header,
    failed: true,
  };
}

/** **What a file write leaves in the panel** — `null` when there is nothing to say: the file
 * was written and every value in it is the nearest `f64` of the exact geometry.
 *
 * Said in the panel as one more row of the run's table, because the file is of that run. A
 * refusal is in the error voice; a file whose export door left values at their construction
 * figure is an aside — the file is fine to use, only not exact to the last bit there. */
export function exportWords(
  label: string,
  result: { ok: true; left: number } | { ok: false; message: string } | null,
): Row | null {
  if (result === null) return row("Export", `${label}: there is no run to write`, "err");
  if (!result.ok) return row("Export", `${label} not written: ${result.message}`, "err");
  if (result.left === 0) return null;
  const values = result.left === 1 ? "1 value stands" : `${result.left} values stand`;
  return row(
    "Export",
    `${label} written; ${values} at the figure its construction gave — the kernel could not settle the exact one`,
    "dim",
  );
}
