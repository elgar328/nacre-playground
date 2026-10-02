// The script editor: CodeMirror 6, TypeScript syntax, Mod-Enter to run.
//
// The mobile settings are not cosmetic: a phone keyboard's autocapitalise and
// autocorrect rewrite code as you type it.
//
// Lines do **not** wrap. Wrapping measures worse to read on the phone than a horizontal
// scroll — a wrapped line loses its indentation, which is most of how code is scanned.
// (The argument for it, "a touch screen hides horizontal scroll", is speculation; use
// refutes it.)

import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { nacreCompletions } from "./complete";
import { signatureHelp } from "./signature";

/** How to write the modifier `Mod-` resolves to, for the platform string given.
 *
 * **The label has to agree with the binding, and the binding is CodeMirror's.** The
 * keymap below says `Mod-Enter`; CodeMirror reads that as ⌘ or Ctrl by its own rule
 * (`@codemirror/view`: `mac: ios || /Mac/.test(nav.platform)`), and it does not export the
 * answer. So this mirrors it — and mirrors it off `navigator.platform` **deliberately**,
 * deprecated though that is: agreeing with the binding matters more than using the newer
 * API, since a browser where the two disagreed would print a key that does nothing.
 *
 * CodeMirror's `ios` half walks `vendor`, the user agent and `maxTouchPoints`; it only
 * changes the answer where `platform` does not already contain `Mac`, which is an iPhone
 * (an iPad reports `MacIntel`). Naming those directly reaches the same verdict on every
 * real device without a second copy of that chain — and the table beside this in the tests
 * is what keeps the list honest.
 *
 * Takes the string rather than reading it, so it can be asked about a platform this
 * machine is not. */
export function modLabel(platform: string): string {
  return /Mac|iPhone|iPad|iPod/.test(platform) ? "⌘" : "Ctrl";
}

/** What the Run button says about how to run without reaching for it. */
export const runHint = (platform: string): string =>
  `${modLabel(platform)}${modLabel(platform) === "⌘" ? "" : " "}⏎`;

export function makeEditor(
  parent: HTMLElement,
  initial: string,
  onRun: () => void,
): EditorView {
  return new EditorView({
    parent,
    doc: initial,
    extensions: [
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onRun();
            return true;
          },
        },
      ]),
      basicSetup,
      javascript({ typescript: true }),
      // Our vocabulary joins the keyword and local-variable sources already there —
      // language data collects every `autocomplete` and runs them all. (Registered on
      // `javascriptLanguage`, which `typescriptLanguage` shares its data with.)
      javascriptLanguage.data.of({ autocomplete: nacreCompletions }),
      signatureHelp(),
      oneDark,
      EditorView.contentAttributes.of({
        autocapitalize: "off",
        autocorrect: "off",
        autocomplete: "off",
        spellcheck: "false",
      }),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-nacre-signature": {
          // It draws above the caret, so it sits over the line before — and being
          // selectable there made it part of whatever you dragged across: copying a
          // line of code came back with the API hint glued to it. It answers no taps
          // either; the content is a pure function of the document, so there is nothing
          // to click and swallowing a touch on a phone only costs a caret placement.
          userSelect: "none",
          WebkitUserSelect: "none",
          pointerEvents: "none",
          padding: "3px 8px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12px",
          background: "#1b1f27",
          border: "1px solid #2b323d",
          borderRadius: "5px",
          color: "#cfd6e0",
          whiteSpace: "nowrap",
        },
        // **The gutter is on everywhere, and on a phone it is not decoration.** A
        // failure says `line 16`, and the two tests that pin that number say why — "the
        // number these produce is the one in the editor's gutter, **which is the only
        // number a reader can act on**" (`recorder.test.ts`). No test can see a media
        // query, so a stylesheet rule hiding the gutter on narrow screens would
        // contradict them unnoticed.
        //
        // The phone's font size lives in index.html beside the other mobile rules —
        // it is a hard iOS constraint (16px or the page auto-zooms), not a taste. The
        // gutter inherits it and costs a couple of characters of width; trimming that by
        // giving the gutter a font or a line height of its own is what makes the numbers
        // drift out of line with the code, so the width is paid rather than shaved.
      }),
    ],
  });
}
