// What the parentheses want: the signature of the call the cursor is inside, with the
// argument being typed marked.
//
// The content is a pure function of the document, and the tooltip only draws it. That
// keeps the part that can be quietly wrong — which call are we in, which argument is
// this — testable without a browser.

import { completionStatus } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { showTooltip } from "@codemirror/view";
import type { Tooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { GLOBALS, MEMBERS } from "../api/docs";
import type { Entry } from "../api/docs";
import { typeOf } from "./complete";

export interface SignatureHint {
  signature: string;
  /** Which argument the cursor is in, counting from zero. */
  active: number;
}

function entryFor(state: EditorState, callee: SyntaxNode | null): Entry | null {
  if (!callee) return null;
  if (callee.name === "VariableName") {
    return GLOBALS[state.doc.sliceString(callee.from, callee.to)] ?? null;
  }
  if (callee.name === "MemberExpression") {
    const object = callee.firstChild;
    const prop = callee.lastChild;
    if (!object || !prop || prop.name !== "PropertyName") return null;
    const owner = typeOf(state, object);
    return owner
      ? (MEMBERS[owner][state.doc.sliceString(prop.from, prop.to)] ?? null)
      : null;
  }
  return null;
}

/** The call the cursor is inside, if we have anything to say about it. */
export function signatureAt(state: EditorState, pos: number): SignatureHint | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name !== "ArgList") continue;
    // Only when the cursor is actually between the parentheses. Once the closing one
    // has been typed, being *after* it means the call is finished — but while it is
    // still missing, the end of the argument list is exactly where the cursor is.
    const close = node.lastChild?.name === ")" ? node.lastChild : null;
    if (pos <= node.from) continue;
    if (close ? pos > close.from : pos > node.to) continue;
    const call = node.parent;
    if (call?.name !== "CallExpression") continue;
    const entry = entryFor(state, call.firstChild);
    if (!entry?.signature) continue;
    // Commas at this level separate arguments; ones nested inside an array or an
    // object belong to that argument, and the tree already keeps them there.
    let active = 0;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name === "," && c.to <= pos) active++;
    }
    return { signature: entry.signature, active };
  }
  return null;
}

/** Draw it above the cursor — unless the completion list is up, which would put two
 * panels in the same place. */
function tooltipFor(state: EditorState): Tooltip | null {
  if (completionStatus(state) === "active") return null;
  const pos = state.selection.main.head;
  const hint = signatureAt(state, pos);
  if (!hint) return null;
  return {
    pos,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-nacre-signature";
      // The active argument is bolded rather than the whole thing rewritten, so the
      // shape of the call stays readable while it moves.
      const parts = hint.signature.split(/,\s*/);
      parts.forEach((part, i) => {
        const span = dom.appendChild(document.createElement("span"));
        span.textContent = i === 0 ? part : `, ${part}`;
        if (i === hint.active) span.style.fontWeight = "700";
        else span.style.opacity = "0.65";
      });
      return { dom };
    },
  };
}

export function signatureHelp(): Extension {
  const field = StateField.define<Tooltip | null>({
    create: tooltipFor,
    update: (value, tr) =>
      tr.docChanged || tr.selection || completionStatus(tr.state) !== completionStatus(tr.startState)
        ? tooltipFor(tr.state)
        : value,
    provide: (f) => showTooltip.from(f),
  });
  return [field];
}
