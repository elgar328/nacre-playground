// The export menu — the run the viewport shows, written to a file.
//
// One icon at the viewport's top right; it opens a small menu with one button per door, and a
// button hands that file over — a download, or another app — and closes the menu. **The files are the kernel's**: wasm hands back
// text (`exportStep`, `exportObj`) and this module only turns text into a download — the app
// never touches geometry, so a better writer in the kernel reaches the file with no change here.
//
// What is written is what is shown: the kit picks the shown bodies (`rendered_bodies`), not the
// model's live set, which also holds copies and values the display leaves out.

import type { FileOk, RunErr } from "../api/bridge";
import type { RunFacts } from "./summary";

/** **Whether there is anything to write**: the last run worked and drew at least one body.
 *
 * A failed run draws the prefix that did build, but the session behind it is that prefix's, not
 * the script's — a file of it would be a file of something the author did not finish. A run
 * that drew only sketches has no solid to write. A run whose mesh was refused (`drawing`) shows
 * nothing either, so the icon hides there too — although a STEP file needs no mesh. */
export function exportable(facts: RunFacts): boolean {
  return facts.outcome === "ok" && facts.drawn.bodies > 0;
}

/** **The STEP header's time stamp for `at`** — ISO 8601 to the second, `2026-10-05T12:34:56Z`,
 * the shape step-io writes its own in. The kernel reads no clock (wasm has none), so the app
 * gives it; the header has never carried milliseconds. */
export function stepStamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** What a format's door answered: text, a refusal, or no run to write. */
export type FileResult = FileOk | RunErr | null;

export interface ExportFormat {
  /** The button's words: what it does, and to what — `Download STEP`. */
  label: string;
  /** The format's name in any sentence about it — `STEP`. */
  name: string;
  /** What happened to the file, in those sentences; `written` when left out. */
  done?: string;
  /** The file's name. */
  file: string;
  write: () => FileResult;
  /** Where the text goes; a download when left out. Answers why it could not, or `null`. */
  deliver?: (file: string, text: string) => string | null;
}

export interface ExportMenu {
  /** Show the icon or hide it — after every run. Hiding closes the menu. */
  setAvailable(on: boolean): void;
  close(): void;
}

/** Build the icon and its menu inside `host` (the viewport). `onResult` hears every write —
 * the words about it are `summary.ts`'s (`exportWords`), not this module's. A door that could
 * not take the text reaches it as a refusal. */
export function makeExportMenu(
  host: HTMLElement,
  formats: ExportFormat[],
  onResult: (format: ExportFormat, result: FileResult) => void,
): ExportMenu {
  const root = document.createElement("div");
  root.id = "export";
  root.hidden = true;

  const button = document.createElement("button");
  button.className = "btn ghost";
  button.title = "export";
  button.setAttribute("aria-label", "export");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  // A tray with an arrow leaving it — drawn, like the toolbar's icons, so no font decides it.
  button.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 10V2.6" /><path d="M5.2 5.3 8 2.5l2.8 2.8" />' +
    '<path d="M3 8.6v3.9c0 .6.4 1 1 1h8c.6 0 1-.4 1-1V8.6" /></svg>';

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const open = (on: boolean) => {
    menu.hidden = !on;
    button.setAttribute("aria-expanded", String(on));
  };
  const close = () => open(false);

  for (const f of formats) {
    const item = document.createElement("button");
    item.className = "btn ghost";
    item.setAttribute("role", "menuitem");
    item.textContent = f.label;
    item.addEventListener("click", () => {
      let result = f.write();
      if (result?.ok) {
        const refused = (f.deliver ?? download)(f.file, result.text);
        if (refused !== null) result = { ok: false, step: undefined, message: refused };
      }
      close();
      onResult(f, result);
    });
    menu.appendChild(item);
  }

  button.addEventListener("click", () => open(menu.hidden));
  // Ways out: a press anywhere else, or Escape.
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !root.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  root.append(button, menu);
  host.appendChild(root);

  return {
    setAvailable: (on) => {
      root.hidden = !on;
      close();
    },
    close,
  };
}

/** Hand `text` to the browser as a file called `name`. The object URL is revoked a moment
 * later rather than at once: Safari starts the download after the click returns. */
function download(name: string, text: string): null {
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}
