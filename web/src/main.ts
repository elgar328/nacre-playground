// The app: editor text → recorded steps (runtime.ts) → wasm build → viewport.

import {
  bodiesOf,
  edgesOf,
  exportObj,
  exportStep,
  facesOf,
  initWasm,
  meshOf,
  run,
  sketchOf,
  verticesOf,
  vertexDecimal,
} from "./api/bridge";
import { exampleSource, requestedExample } from "./app/examples";
import { BLAME, collect } from "./app/draw";
import { exportWords, runFacts, showingWords, summarize } from "./app/summary";
import type { Ending, Summary } from "./app/summary";
import { makeCheatPanel } from "./app/cheat";
import { exportable, makeExportMenu, stepStamp } from "./app/export";
import { makeOutputPanel } from "./app/output";
import type { OutputPanel } from "./app/output";
import { makeEditor, runHint } from "./app/editor";
import { makeResizer } from "./app/pane";
import {
  executeScript,
  failureView,
  markerLines,
  markerSize,
} from "./app/runtime";
import { resolveView } from "./api/view";
import { Sheet } from "./app/sheet";
import { Viewport } from "./app/viewport";
import type { SceneStyle } from "./api/recorder";
import type { SceneView } from "./api/view";
import type { Step } from "./api/steps";
import type { Blame, Mark } from "./api/bridge";

const SCRIPT_KEY = "nacre-playground.script";

/** The wasm boundary as the drawing pass sees it. Named once here so the two call
 * sites cannot hand over different doors. */
const DRAW = { meshOf, edgesOf, sketchOf, bodiesOf };

/** **A failed run still shows what it built.** Everything before the failing step did
 * build — so build that prefix again and draw it, rather than leaving the author with an
 * empty viewport and one line of text.
 *
 * The rebuild cannot fail: those steps just succeeded and `build` is documented
 * deterministic ("the same slice builds the same model, bit for bit"). If it does, that
 * is news about determinism and is said out loud rather than swallowed.
 *
 * Returns what it drew, in words — `summarize()` puts that in the failure's `Showing`
 * row. The sentence itself is `showingWords`'s; this counts what there is to say and
 * hands the count over, because wording is decided in one place — a sentence assembled
 * here would have no test around it. */
function showPrefix(
  viewport: Viewport,
  steps: Step[],
  upto: number | undefined,
  sceneStyle: SceneStyle,
  sceneView: SceneView,
  blame?: Blame,
  mark?: Mark,
): string {
  // `upto` absent means the script threw for its own reasons: every recorded step is
  // good. `0` means it fell over before building anything, and there is nothing to see.
  const n = upto ?? steps.length;
  if (n === 0) return "";
  const partial = run(steps.slice(0, n));
  if (!partial.ok) {
    // **This one names its own step.** The sentence lands in the `Showing` row while
    // `Where` is naming the *outer* failure, so nothing else here would say which of the
    // prefix's steps gave way — and a slice that just built failing on a rerun is news
    // about determinism, which deserves to arrive complete.
    const at = partial.step === undefined ? "" : ` at step ${partial.step}`;
    return `the prefix would not rebuild${at} (${partial.message})`;
  }
  const { ids, blamed } = failureView(partial.rendered, blame);
  const drawn = collect(DRAW, partial, ids, sceneStyle, steps, blamed);
  if ("error" in drawn) return drawn.error;
  // The kernel's witness location joins the same show() call — show() replaces the
  // whole scene, so a second call would erase the prefix it just drew.
  if (mark) {
    drawn.meshes.push({
      lines: markerLines(mark, markerSize(drawn.meshes)),
      style: { color: BLAME.color, width: 3 },
      kind: "marker",
    });
  }
  viewport.show(drawn.meshes, resolveView(sceneView));
  return showingWords({ steps: n, blamed: blamed.size, marked: !!mark, colour: BLAME.word });
}

/** The output panel, once `main()` has built it.
 *
 * `sayPlain` lives out here and is reachable before that — `main().catch(…)` runs when the
 * wasm never loads, and there is no panel then. Hence the handle and the `?.`. */
let outputPanel: OutputPanel | null = null;

const statusEl = document.getElementById("status")!;

/** The last run's own account — kept so a file written afterwards can add its row to the same
 * table rather than replace it. */
let lastSummary: Summary | null = null;

/** Draw a run's own account of itself. **Nothing is composed here** — `summarize()` owns
 * every word, so the status line and the panel cannot come to disagree about the same run
 * (`output.ts` makes that argument for its own content; this would be the other place). */
const show = (s: Summary) => {
  statusEl.replaceChildren();
  if (s.status.chip) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = s.status.chip;
    statusEl.appendChild(chip);
  }
  // A flex row, so the words are their own child rather than a bare text node
  // sharing the box with the chip.
  const words = document.createElement("span");
  words.textContent = s.status.text;
  statusEl.appendChild(words);
  statusEl.className = `status ${s.failed ? "error" : "dim"}`;
  outputPanel?.setHeader(s.header, s.failed);
  lastSummary = s;
};

/** The one thing that is not a run: wasm would not load, or the page could not be built.
 * There is no time to report and no operation to name, so it does not go through
 * `summarize()` — a `Time` row here would be a made-up number. */
const sayPlain = (text: string, kind: "dim" | "error" | "" = "") => {
  statusEl.replaceChildren();
  const words = document.createElement("span");
  words.textContent = text;
  statusEl.appendChild(words);
  statusEl.className = `status ${kind}`.trim();
  outputPanel?.setHeader(kind === "error" ? [{ text, kind: "err" }] : [], kind === "error");
};

/** localStorage throws in private mode — losing persistence is not losing the app. */
const store = {
  read(): string | null {
    try {
      return localStorage.getItem(SCRIPT_KEY);
    } catch {
      return null;
    }
  },
  write(text: string): void {
    try {
      localStorage.setItem(SCRIPT_KEY, text);
    } catch {
      /* ignore */
    }
  },
};

async function main() {
  const viewportEl = document.getElementById("viewport")!;
  const viewport = new Viewport(viewportEl);
  makeResizer(document.getElementById("edge")!);
  const grip = document.getElementById("grip")!;
  let editor: ReturnType<typeof makeEditor>;
  const sheet = new Sheet(
    { sheet: document.getElementById("sheet")!, grip, header: grip },
    // The editor's container just changed height; CodeMirror measures lazily and
    // renders nothing if it missed the change.
    () => editor?.requestMeasure(),
  );
  const helpEl = document.getElementById("help")!;
  const cheat = makeCheatPanel(viewportEl, helpEl, {
    onChange: (open) => {
      // Reading needs room and costs no frames: on a phone the sheet steps down so
      // there is something to read into, and the renderer rests while it is covered.
      viewport.setPaused(open);
      if (open) sheet.goTo("peek");
    },
  });
  const outEl = document.getElementById("out")!;
  outputPanel = makeOutputPanel(viewportEl, outEl, {
    // The renderer is **not** rested — seeing the model through the blur is what the
    // panel is for. On a phone the sheet steps down, as it does for the cheat sheet, so
    // there is something to read into.
    onChange: (open) => {
      if (open) sheet.goTo("peek");
    },
  });
  // Both cover the same view, so one at a time. Which one is the app's policy, not
  // something either panel should know about the other.
  outEl.addEventListener("click", () => {
    cheat.close();
    outputPanel!.toggle();
  });
  helpEl.addEventListener("click", () => {
    outputPanel!.close();
    cheat.toggle();
  });

  // Files of what the viewport shows. The words about a write are `summary.ts`'s; they join
  // the run's table, and a refusal turns the output button red like any failure does.
  const exportMenu = makeExportMenu(
    viewportEl,
    [
      {
        label: "STEP",
        file: "nacre-playground.step",
        write: () => exportStep(stepStamp(new Date())),
      },
      { label: "OBJ", file: "nacre-playground.obj", write: exportObj },
    ],
    (label, result) => {
      const words = exportWords(label, result);
      if (!words || !lastSummary) return;
      outputPanel!.setHeader(
        [...lastSummary.header, words],
        lastSummary.failed || words.kind === "err",
      );
    },
  );

  await initWasm();

  const doRun = () => {
    const source = editor.state.doc.toString();
    // An example opened from a link is not the author's script: it is not saved over
    // theirs until they change it, and once they do, the link's `?example=` goes, so a
    // reload brings back their own work rather than the example.
    if (source !== example) {
      store.write(source);
      if (example !== null) {
        example = null;
        history.replaceState(null, "", location.pathname);
      }
    }
    // After the write: a localStorage round-trip is not part of building anything, and
    // `built in …` is the sentence this number ends up in.
    const t0 = performance.now();
    const script = executeScript(source, {
      run,
      bodiesOf,
      verticesOf,
      vertexDecimal,
      facesOf,
    });
    // Once, before the branches: the lines are the same whichever way the run ends, and
    // the failure text that follows is `show`'s business.
    outputPanel!.setLines(script.output ?? [], script.printed ?? 0);
    // **One exit.** Each way a run can end returns *what happened*; putting that into
    // words, drawing it and leaving the sheet where it belongs happens once, below. A
    // branch that finishes itself — assembles the facts, hands them to `show`, moves the
    // sheet — is one more spelling of an ending to keep in step by hand.
    const ending = ((): Ending => {
      if (!script.ok) {
        // A syntax error records nothing; anything else stopped part-way through a log.
        const showing = script.steps
          ? showPrefix(
              viewport,
              script.steps,
              script.step,
              script.sceneStyle ?? {},
              script.sceneView ?? {},
            )
          : "";
        return { script, showing };
      }
      const out = run(script.steps);
      if (!out.ok) {
        // Draw what did build, and keep the sentence it hands back — `summarize()` puts it
        // in a `Showing` row. Where the failure was written is `summary.ts`'s to say: it
        // holds both answers (the blamed step's line, and the line a throw was stamped
        // with) and the rule for which one wins.
        const showing =
          out.step === undefined
            ? ""
            : showPrefix(
                viewport,
                script.steps,
                out.step,
                script.sceneStyle,
                script.sceneView,
                out.blame,
                out.mark,
              );
        return { script, out, showing };
      }
      const drawn = collect(DRAW, out, out.rendered, script.sceneStyle, script.steps);
      if ("error" in drawn) return { script, out, drawn };
      // Read before the paint: `built in …` is about building, and the upload to the GPU
      // is not that. The meshing above *is* left in — it is computation, and hiding it
      // would make a slow model look fast.
      const ms = performance.now() - t0;
      viewport.show(drawn.meshes, resolveView(script.sceneView));
      // The result is what Run was for; a failure leaves the sheet open, since looking the
      // syntax up is probably how the failure gets fixed.
      cheat.close();
      return { script, out, drawn, ms };
    })();
    const facts = runFacts(ending);
    const sum = summarize(facts);
    show(sum);
    exportMenu.setAvailable(exportable(facts));
    // The result is what you pressed Run to see; a failure sends you back to the code
    // that needs fixing.
    sheet.goTo(sum.failed ? "half" : "peek");
  };

  const asked = requestedExample(location.search);
  let example = asked === null ? null : await exampleSource(asked);
  // A number with no example behind it opens the author's own script, so the link goes.
  if (asked !== null && example === null) history.replaceState(null, "", location.pathname);
  editor = makeEditor(document.getElementById("editor")!, example ?? store.read() ?? "", doRun);
  // Typing is the whole task while it lasts: give the editor every pixel the phone
  // has left once the keyboard is up (a no-op on the desktop).
  // The keyboard does not move the sheet. Wherever you left it — half, full — is
  // where you type; the stops are fractions of what is *visible*, so they shrink with
  // the keyboard on their own and the layout never jumps under your thumb. The class
  // only sheds the toolbar's spare rows, buying a couple of lines at any stop.
  const editing = (on: boolean) =>
    document.documentElement.classList.toggle("editing", on);
  editor.contentDOM.addEventListener("focus", () => editing(true));
  editor.contentDOM.addEventListener("blur", () => editing(false));
  const runBtn = document.getElementById("run")!;
  // The hint is written here rather than in the markup: it is the platform's answer, and
  // markup would ship ⌘ to everyone. `editor.ts` owns it because that is where the binding
  // it describes lives.
  runBtn.querySelector(".hint")!.textContent = runHint(navigator.platform);
  runBtn.addEventListener("click", doRun);
  doRun();
}

main().catch((e) => sayPlain(String(e), "error"));
