// Which line a call is on — recorded by the app, not asked of the engine.
//
// **Why the app keeps this itself.** A source line would come free from a stack trace,
// except that no engine gives one for a generated function in every browser (Safari gives
// no position at all), and a feature that works in some browsers is worse than none. So
// the position is *instrumented*: every call is wrapped so that it says where it is on
// its way in. That is what coverage tools and debuggers do, and it answers the same in
// every engine because nothing is being asked of the engine.
//
// ```
// f(a, b)      →  __at(3, "f", () => f(a, b))
// X.lineTo(a)  →  __at(3, "lineTo", () => X.lineTo(a))
// ```
//
// **The whole call is wrapped, not its receiver.** JavaScript evaluates the receiver,
// then the arguments, then calls — so a marker on the receiver is overwritten by any call
// *inside the arguments*, and `cut(cuboid({…}), b)` reports `cuboid`'s line for `cut`.
// Measured, and it is the commonest shape in this API. Wrapping the call puts the marker
// after the arguments and before the call, where it belongs.
//
// The wrapper keeps meaning: the member expression goes inside the arrow whole, so `this`
// binds as it always did; the argument list is untouched, so arity is; and `a?.b()` still
// short-circuits.

import { typescriptLanguage } from "@codemirror/lang-javascript";

/** The name a marker is given beside the vocabulary — `console`'s neighbour, not a word
 * the script is taught. A script that shadows it (`let __at = 5`) breaks its own
 * instrumentation; the name is awkward on purpose. */
export const MARKER = "__at";

/** Wrap every call so it says where it is. Returns the source unchanged if the tree has
 * nothing to wrap.
 *
 * **The dialect is TypeScript, not JavaScript.** The app transforms TypeScript, and the
 * two parsers disagree where it counts: the plain one reads `f<number>(1)` as a pair of
 * comparisons and **finds no call at all**, and it puts error nodes through `interface`,
 * `type`, `enum` and `satisfies`. A call that is quietly not wrapped is a line quietly
 * lost, which is the kind of regression no one sees. */
export function markCalls(src: string): string {
  const tree = typescriptLanguage.parser.parse(src);
  const lineOf = (pos: number) => src.slice(0, pos).split("\n").length;

  const wraps: { from: number; to: number; line: number; name: string }[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name !== "CallExpression") continue;
    let callee = cursor.node.firstChild;
    if (!callee) continue;
    // A generic call wears one more layer: `f<number>(1)` is
    // `CallExpression(InstantiationExpression(VariableName, TypeArgList), ArgList)`, so
    // the callee has to be unwrapped or the name comes out as `f<number>` — a real string
    // a reader would have seen in the failure.
    if (callee.name === "InstantiationExpression" && callee.firstChild) callee = callee.firstChild;
    // `a.b()`'s name is the property; a plain call's is the callee itself. The *name's*
    // line is the one a reader looks for — a chain puts each call on its own line and the
    // call node starts back at the head of the chain.
    const isMember = callee.name === "MemberExpression";
    const named = isMember ? callee.lastChild : callee;
    if (!named) continue;
    // **A name only when there is one.** Not every callee is a word: an IIFE's is a
    // whole function body, `(x || y)()`'s is an expression, and a computed member's last
    // child is the closing `]` — which would have put `line 1 — ]` in front of a reader.
    // The line is worth having on its own, so those are marked without a name.
    const isWord = named.name === "VariableName" || named.name === "PropertyName";
    wraps.push({
      from: cursor.node.from,
      to: cursor.node.to,
      // An unnamed callee still sits somewhere: use the call's own start for the line.
      line: lineOf(isWord ? named.from : cursor.node.from),
      name: isWord ? src.slice(named.from, named.to) : "",
    });
  } while (cursor.next());
  if (!wraps.length) return src;

  // **Order matters, and it is not obvious.** Every call in a chain *starts at the
  // same character* — `sketch(…)`, `sketch(…).moveTo(…)`, and so on all begin at the head.
  // Sort those arbitrarily and the wrappers nest in the wrong order, which does not fail:
  // it silently reports each call with another call's line (measured: a five-call chain
  // came out exactly reversed). At one position the **wider span is the outer wrapper**,
  // so it is inserted last and ends up first in the text.
  const edits = [
    ...wraps.map((w) => ({
      at: w.from,
      text: `${MARKER}(${w.line}, ${JSON.stringify(w.name)}, () => `,
      span: w.to - w.from,
    })),
    ...wraps.map((w) => ({ at: w.to, text: ")", span: -(w.to - w.from) })),
  ].sort((a, b) => b.at - a.at || a.span - b.span);

  let out = src;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return out;
}
