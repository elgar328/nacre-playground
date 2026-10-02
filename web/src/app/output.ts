// The output panel — what a run had to say in words, in a place built for reading it.
//
// **It owns its content and its button.** What is drawn is a function of two pieces of
// state, `lines` and `error`, and so is the button's label and colour. The alternative —
// the app holding the lines and assembling the panel at each of the places a run can end
// — is the same rule written in several spots, which is how two of them come to disagree.
//
// It does **not** rest the renderer the way the cheat sheet does. Seeing the model
// through it is the point of the blur, and `paused` only skips the render call: whether
// the last frame survives being left alone is the browser's business, not a promise
// (`preserveDrawingBuffer` is false).

import { makeOverlay } from "./overlay";
import type { OverlayHooks } from "./overlay";
import type { Row } from "./summary";

export interface OutputPanel {
  toggle(): void;
  close(): void;
  isOpen(): boolean;
  /** What `print(...)` said this run, and how many calls said it — `lines` carries the
   * cap's own closing note, so its length is not the count. */
  setLines(lines: string[], printed: number): void;
  /** What the run itself has to say: the header table from `summarize()`, and whether it
   * failed (the button wears that). The status line is one line; this is everything. */
  setHeader(rows: Row[], failed: boolean): void;
}

/** Build the panel inside `host` (the viewport) and let `button` speak for it. */
export function makeOutputPanel(
  host: HTMLElement,
  button: HTMLElement,
  hooks: OverlayHooks,
): OutputPanel {
  let lines: string[] = [];
  let printed = 0;
  let header: Row[] = [];
  let failed = false;

  // The count is the panel's to write, so it makes it: the button's markup is an icon
  // and nothing else, and there is no empty span in the page waiting to be filled by
  // whoever remembers to.
  const count = document.createElement("span");
  count.className = "count";
  button.appendChild(count);

  // The run's own words are the first thing in the panel, so the frame's plain rule
  // (open at the top) holds here with no exception.
  const overlay = makeOverlay(host, "output", button, { onChange: hooks.onChange });
  const body = overlay.body;

  const row = (text: string, cls: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    return el;
  };

  const draw = () => {
    body.replaceChildren();
    // The machine's words, then the rule, then the author's. A run that has not happened
    // yet has neither — and then there is no rule either, since a line under nothing is
    // just a line.
    for (const r of header) body.appendChild(row(r.text, `row${r.kind ? ` ${r.kind}` : ""}`));
    if (header.length) body.appendChild(row("", "rule"));
    for (const line of lines) body.appendChild(row(line, "line"));
    if (!lines.length) body.appendChild(row("nothing printed", "line dim"));
    // Empty rather than absent: the stylesheet takes an empty one out of the layout
    // (`:empty`), so there is no slot held open for a number that is not there.
    count.textContent = printed ? String(printed) : "";
    button.classList.toggle("error", failed);
  };

  draw();

  return {
    toggle: () => overlay.toggle(),
    close: () => overlay.close(),
    isOpen: () => overlay.isOpen(),
    setLines: (l, n) => {
      lines = l;
      printed = n;
      draw();
    },
    setHeader: (rows, didFail) => {
      header = rows;
      failed = didFail;
      draw();
    },
  };
}
