// The run pipeline's first half: editor text → sucrase (type stripping only — the
// script is a single import-free file, the API is injected) → Function → a recorded
// step log. The second half (wasm run + viewport) lives in main.ts.

import { transform } from "sucrase";
import { MARKER, markCalls } from "./mark";
import { Recorder, ScriptError, makeApi, printLine } from "../api/recorder";
import type { Queries, SceneStyle } from "../api/recorder";
import type { SceneView } from "../api/view";
import type { Edges, Step, Style } from "../api/steps";

export interface ScriptOk {
  ok: true;
  steps: Step[];
  /** What `style(...)` said — it is not in the steps, so it rides out here. */
  sceneStyle: SceneStyle;
  /** …and the same for `view(...)`. */
  sceneView: SceneView;
  /** …and what `print(...)` said, in call order. */
  output: string[];
  /** How many `print(...)` calls there were — `output`'s length counts the cap's note. */
  printed: number;
  /** Per step: the source line it was recorded from, or `null` when marking was off. */
  stepLines: (number | null)[];
}

export interface ScriptFail {
  ok: false;
  message: string;
  /** **What had been recorded when it stopped.** A script can fail in two places —
   * here, while it is being *recorded* (a selector's mid-script build declines, an
   * argument is wrong), or later when the whole log is built. The author cannot tell
   * those apart, so both have to be able to show what they did get; throwing the log
   * away made half the failures blind. Absent for a syntax error, where nothing ran. */
  steps?: Step[];
  /** The failing step, when the failure came from a build. `undefined` when the script
   * threw for its own reasons — then every recorded step is good and all of them build. */
  step?: number;
  /** The scene as the author had described it when it stopped. A failed run draws
   * their scene, not a default one — and it must draw it the *same* way whichever of
   * the two failures happened, or the feature is two features wearing one name. */
  sceneStyle?: SceneStyle;
  sceneView?: SceneView;
  /** **And what it printed before it stopped.** The lines a script wrote on its way to
   * failing are exactly the ones the author was watching. Recording them on success only
   * would make the feature half a feature, silently — the same both-sides edit the kit's
   * `consumes()`/`reads()` pair needs. */
  output?: string[];
  /** As above — absent only when the script never got to run at all. */
  printed?: number;
  stepLines?: (number | null)[];
  /** Where the throw came from, when a marker stamped it. */
  thrownAt?: { line: number; name: string };
}

/** The `console` a script sees.
 *
 * **Because the reflex is `console.log`.** The real one writes to the browser's
 * console — which a phone does not have — so the line an author typed to find out what
 * was happening would do nothing and say nothing. Silence is the worst of the
 * available answers.
 *
 * Built on the real console rather than as a fresh object, so `console.table`,
 * `console.time` and the rest still work. A plain `{ log, warn, error }` would make that
 * one call **kill the script**, which is a bad trade for a debugging aid. Everything also
 * goes on to the real console: on a desktop that is where it was expected. */
function consoleFor(rec: Recorder): Console {
  const shim = Object.create(console) as Console;
  const tee =
    (real: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      rec.print(printLine(args));
      real.apply(console, args);
    };
  shim.log = tee(console.log);
  shim.info = tee(console.info);
  shim.debug = tee(console.debug);
  shim.warn = tee(console.warn);
  shim.error = tee(console.error);
  return shim;
}

/** Where the line marker writes what it saw, on the error going past.
 *
 * **A Symbol, because `line` is not ours.** WebKit sets `line`, `column` and `sourceURL`
 * on every error it makes, so a marker that stamped `e.line` and skipped when it was
 * already set would never write anything in Safari, and the reader would see the
 * *engine's* line for a generated function: a one-line script reports line 4. V8 sets
 * none of that, so the tests cannot see it. A key nothing else can own removes the
 * question. */
const AT = Symbol("nacre.at");

/** **Keep the marker out of the sentence.** The engine writes its own messages from the
 * code it is running, which is the *marked* code — so a missing method comes back as
 * "__at(...).polygon is not a function", naming something the author never wrote. The
 * marker is an implementation detail and has no business in a message about a script.
 *
 * Only the wrapper's own shape is rewritten; a script that genuinely mentions `__at` (it
 * would have to try) keeps its words. */
function scrub(message: string): string {
  // Built from `MARKER`, not spelled again — two spellings of one name is how the second
  // one comes to be wrong.
  return message.replace(new RegExp(`${MARKER}\\([^)]*\\)`, "g"), "…");
}

/** What a marker wrote on an error as it went past, if anything did. */
function thrownAt(e: unknown): { line: number; name: string } | undefined {
  if (!e || typeof e !== "object") return undefined;
  return (e as { [AT]?: { line: number; name: string } })[AT];
}

export function executeScript(code: string, queries?: Queries): ScriptOk | ScriptFail {
  // **The author's own source is what a syntax error is reported against.** The marker
  // below rewrites the text, and CodeMirror's parser does not refuse broken input — it
  // makes error nodes and carries on — so marking first would have the failure point at
  // text nobody wrote.
  let js: string;
  try {
    js = transform(code, { transforms: ["typescript"] }).code;
  } catch (e) {
    return { ok: false, message: `syntax: ${(e as Error).message}` };
  }
  // **And if marking goes wrong, the script still runs.** Two things could: the marker
  // itself, or the marked text failing to compile. The second is the dangerous one — it
  // would surface as "syntax: …" and blame the author for a bug in here. The source above
  // already compiled, so falling back to it cannot lie.
  let marked: string | null = null;
  try {
    marked = transform(markCalls(code), { transforms: ["typescript"] }).code;
  } catch {
    marked = null;
  }
  const rec = new Recorder(queries);
  const api = makeApi(rec);
  const names = Object.keys(api) as (keyof typeof api)[];
  try {
    // `console` is passed **beside** the vocabulary, not inside it. `docs.test.ts` and
    // `cheatsheet.test.ts` take `Object.keys(makeApi(…))` as the definition of what a
    // script can say, and every name there has to be documented and taught. `print` is
    // the name; this is a courtesy, and it should not become a word to learn.
    // The marker rides beside the vocabulary, like `console` — a script is not taught it.
    const at = (line: number, called: string, thunk: () => unknown) => {
      const prev = rec.at;
      rec.at = { line, name: called };
      try {
        return thunk();
      } catch (e) {
        // The stack unwinds on the way out, so by the time this reaches the catch below
        // there is nothing left to read. Stamp it as it passes: the innermost marker gets
        // here first, and the ones outside leave what it wrote alone.
        if (e && typeof e === "object") {
          const err = e as { [AT]?: { line: number; name: string } };
          if (err[AT] === undefined) err[AT] = { line, name: called };
        }
        throw e;
      } finally {
        rec.at = prev;
      }
    };
    const fn = new Function(...names, "console", MARKER, `"use strict";\n${marked ?? js}`);
    fn(...names.map((n) => api[n]), consoleFor(rec), at);
  } catch (e) {
    const prefix = e instanceof ScriptError ? "" : "script: ";
    return {
      ok: false,
      message: `${prefix}${scrub((e as Error).message)}`,
      // Everything pushed before the throw. A script error stops the recording; it does
      // not un-record what already ran, and that prefix is what the author can look at.
      steps: rec.steps,
      stepLines: rec.stepLines,
      thrownAt: thrownAt(e),
      step: e instanceof ScriptError ? e.step : undefined,
      sceneStyle: rec.sceneStyle,
      sceneView: rec.sceneView,
      output: rec.lines(),
      printed: rec.printedCount,
    };
  }
  return {
    ok: true,
    steps: rec.steps,
    stepLines: rec.stepLines,
    sceneStyle: rec.sceneStyle,
    sceneView: rec.sceneView,
    output: rec.lines(),
    printed: rec.printedCount,
  };
}

/** **What the author called, in their own vocabulary** — `fuse`, `extrude`, `cuboid`.
 *
 * Not the *only* thing a failure can say: `app/mark.ts` records a line number as each
 * call goes past, rather than asking an engine that would answer differently per
 * browser. This is the name in `line 4 — cut`, and the answer when marking is off. */
export function stepName(step: Step | undefined): string | null {
  if (!step) return null;
  const tag = Object.keys(step)[0];
  if (!tag) return null;
  // A rotation's own word carries its axis — the script says `rotateZ`, not `rotate`.
  // Without this the two layers disagree about one line: the recorder's door names the
  // call the author wrote, and a kernel refusal on the same step named the step.
  if (tag === "Rotate") {
    const axis = (step as { Rotate: { axis: string } }).Rotate.axis;
    return typeof axis === "string" ? `rotate${axis}` : "rotate";
  }
  // A boolean's own word is its kind — the script says `fuse`, not `boolean`.
  if (tag === "Boolean") {
    const kind = (step as { Boolean: { kind: string } }).Boolean.kind;
    return typeof kind === "string" ? kind.toLowerCase() : "boolean";
  }
  return tag.charAt(0).toLowerCase() + tag.slice(1);
}

/** **What a failed run should put on screen, and which of it the kernel blamed.**
 *
 * The union, not one or the other. Measured on the 45° rotation fold: the prefix's own
 * render set is `[5]` alone, because `unit` (value 4) is *read* by value 5 and the leaf
 * rule hides anything a later step consumes — so the two bodies that would not join are
 * never both in it. Blame alone has the opposite hole: it drops every other part the
 * author had already built. And a script that called `display(...)` before the failure
 * makes the render set the displayed targets instead of the leaves, which need not
 * contain the blamed pair either. The union covers all three.
 *
 * The blamed pair is always *in* the prefix: `build` refuses a forward reference
 * ("value N is not defined before this step"), so both operands of the failing step were
 * built before it. That is a guarantee, not luck.
 */
export function failureView(
  rendered: number[],
  blame?: { a: number; b: number },
): { ids: number[]; blamed: Set<number> } {
  const blamed = new Set(blame ? [blame.a, blame.b] : []);
  const ids = [...rendered];
  for (const id of blamed) if (!ids.includes(id)) ids.push(id);
  return { ids, blamed };
}

/** What a value is drawn with. Styles never cross the wasm boundary; they are read
 * back from the app's own recording.
 *
 * Three layers, ranked rather than sequenced: the viewer's defaults, then the scene's
 * `style(...)`, then the last `display(...)` that named this value. The edge settings
 * of each layer **merge field by field** — a scene that sets a width and a display
 * that sets a colour give you both — except `false`, which is a statement about what
 * the picture contains and so replaces whatever was underneath.
 */
export interface ResolvedStyle {
  color?: string;
  opacity?: number;
  /** Line width in screen pixels. It describes a **sketch's** own lines; a solid's
   * face has no width, and the width of its edges lives in `edges`. */
  width?: number;
  edges: false | { color?: string; opacity?: number; width?: number };
}

export function resolveStyle(
  scene: SceneStyle,
  steps: Step[],
  id: number,
): ResolvedStyle {
  let display: Style | undefined;
  for (const s of steps) {
    if ("Display" in s && s.Display.targets.includes(id) && s.Display.style) {
      display = s.Display.style;
    }
  }
  const out: ResolvedStyle = { edges: {} };
  const layer = (
    color?: string | null,
    opacity?: number | null,
    width?: number | null,
    edges?: Edges | null,
  ) => {
    if (color != null) out.color = color;
    if (opacity != null) out.opacity = opacity;
    if (width != null) out.width = width;
    if (edges === "Off") out.edges = false;
    else if (edges && typeof edges === "object") {
      const on = edges.On;
      const base = out.edges === false ? {} : out.edges;
      out.edges = {
        color: on.color ?? base.color,
        opacity: on.opacity ?? base.opacity,
        width: on.width ?? base.width,
      };
    }
  };
  layer(scene.color, scene.opacity, scene.width ?? null, scene.edges ?? null);
  layer(display?.color, display?.opacity, display?.width ?? null, display?.edges ?? null);
  return out;
}

/** The line segments that mark a failure location — a pure function so the shape is
 * testable without a scene. A point becomes a three-axis cross of half-length `size`;
 * a segment is drawn as itself (the kernel already chose its extent). */
export function markerLines(
  mark: { kind: "point" | "segment"; coords: [number, number, number][] },
  size: number,
): Float32Array {
  if (mark.kind === "segment" && mark.coords.length === 2) {
    return new Float32Array([...mark.coords[0], ...mark.coords[1]]);
  }
  const [x, y, z] = mark.coords[0];
  return new Float32Array([
    x - size, y, z, x + size, y, z,
    x, y - size, z, x, y + size, z,
    x, y, z - size, x, y, z + size,
  ]);
}

/** A marker's cross size, from what is on screen: a fixed fraction of the drawn
 * geometry's bounding-diagonal, so the cross reads at any model scale. `fallback` when
 * nothing else is drawn (a failure at the very first step). Vertex arrays are sampled,
 * not exhausted — framing precision is not the point here. */
export function markerSize(
  drawn: { data?: { positions: Float32Array }; lines?: Float32Array }[],
): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let seen = false;
  for (const d of drawn) {
    const arr = d.data?.positions ?? d.lines;
    if (!arr) continue;
    const stride = Math.max(3, Math.floor(arr.length / 300 / 3) * 3);
    for (let i = 0; i + 2 < arr.length; i += stride) {
      seen = true;
      for (let k = 0; k < 3; k++) {
        const v = arr[i + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
  }
  if (!seen) return 1.0;
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return diag > 0 ? diag * 0.03 : 1.0;
}
