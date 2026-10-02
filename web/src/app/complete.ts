// Completion for the nacre vocabulary.
//
// CodeMirror already runs an autocompletion; `basicSetup` includes it and
// lang-javascript already contributes keywords and the document's own variable names.
// What is missing is a source that knows our API — this is that source, and it costs
// no new dependency.
//
// **The order of the branches below is the correctness.** lang-javascript's
// `dontComplete` list — the one that keeps completions out of strings and comments —
// contains `PropertyName`, `PropertyDefinition` and `.`, which are precisely the nodes
// member and option completion live on. Applied first, that guard silently deletes
// most of this file's reason to exist. So: members, then options, then the guard, then
// plain identifiers. (`completionPath` in lang-javascript orders its branches the same
// way, for the same reason.)

import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { GLOBALS, MEMBERS } from "../api/docs";
import type { Entry, TypeName } from "../api/docs";

/** Nodes where nothing should be offered — strings, comments, and the places where a
 * name is being *declared* rather than used. Copied in spirit from lang-javascript,
 * minus the property nodes, which are handled before this guard is consulted. */
const DONT_COMPLETE = new Set([
  "TemplateString",
  "String",
  "RegExp",
  "LineComment",
  "BlockComment",
  "VariableDefinition",
  "TypeDefinition",
  "Label",
  "PrivatePropertyDefinition",
  "PrivatePropertyName",
]);

const read = (state: EditorState, node: SyntaxNode) =>
  state.doc.sliceString(node.from, node.to);

/** Unwrap parentheses, which change nothing about a value's type. */
function skipParens(node: SyntaxNode | null): SyntaxNode | null {
  while (node && node.name === "ParenthesizedExpression") node = node.firstChild;
  return node;
}

/** The entry a callee names, if we know it: `cuboid` or `part.faces`. */
function calleeEntry(state: EditorState, callee: SyntaxNode | null): Entry | null {
  const node = skipParens(callee);
  if (!node) return null;
  if (node.name === "VariableName") return GLOBALS[read(state, node)] ?? null;
  if (node.name === "MemberExpression") {
    const object = node.firstChild;
    const prop = node.lastChild;
    if (!object || !prop || prop.name !== "PropertyName") return null;
    const owner = typeOf(state, object);
    return owner ? (MEMBERS[owner][read(state, prop)] ?? null) : null;
  }
  return null;
}

/** Whether an `ArgList` child is an argument somebody wrote.
 *
 * Punctuation is obvious; the zero-width node is not. Half-typed code leaves an error
 * marker of no width where the closing paren will go, and counting it would make
 * `display(a, b, { … })` believe its object is the second of four arguments — so the
 * fields keyed to "the last one" would never be reached. */
const isArgument = (node: SyntaxNode) =>
  node.name !== "(" && node.name !== ")" && node.name !== "," && node.to > node.from;

/** How many arguments a call was given — a `returns` map answers by arity, and option
 * fields are keyed by which argument they belong to. */
function argCount(args: SyntaxNode): number {
  let n = 0;
  for (let c = args.firstChild; c; c = c.nextSibling) if (isArgument(c)) n++;
  return n;
}

function resolveReturns(entry: Entry | null, args: SyntaxNode | null): TypeName | null {
  if (!entry?.returns) return null;
  if (typeof entry.returns === "string") return entry.returns;
  const n = args ? argCount(args) : 0;
  return entry.returns[n] ?? null;
}

/** What kind of value an expression produces, as far as we can tell from the source.
 *
 * Deliberately partial: straight-line `let x = f(…)` and method chains are what CAD
 * scripts are made of, and those resolve exactly. A conditional or a destructuring
 * does not, and then we say nothing rather than guess. */
export function typeOf(
  state: EditorState,
  node: SyntaxNode | null,
  depth = 0,
): TypeName | null {
  const n = skipParens(node);
  if (!n || depth > 8) return null;

  if (n.name === "VariableName") {
    const name = read(state, n);
    // A global that *is* a value, not a function: XY, Z, …
    const global = GLOBALS[name];
    if (global?.type) return global.type;
    const bound = lastBindingBefore(state, name, n.from);
    if (bound) return typeOf(state, bound, depth + 1);
    return callbackParamType(state, n, name, depth);
  }

  if (n.name === "CallExpression") {
    const entry = calleeEntry(state, n.firstChild);
    return resolveReturns(entry, n.getChild("ArgList"));
  }

  if (n.name === "MemberExpression") {
    const object = n.firstChild;
    const prop = n.lastChild;
    if (!object || !prop || prop.name !== "PropertyName") return null;
    const owner = typeOf(state, object, depth + 1);
    if (!owner) return null;
    const entry = MEMBERS[owner][read(state, prop)];
    return entry?.returns && typeof entry.returns === "string" ? entry.returns : null;
  }

  return null;
}

/** The right-hand side of the last `let`/`const`/assignment to `name` before `pos`.
 * Assignments count because a script may reassign (`part = pad(cap, boss, 3)`), and
 * reading only declarations would freeze the type at
 * whatever it was first. */
function lastBindingBefore(
  state: EditorState,
  name: string,
  pos: number,
): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  syntaxTree(state).iterate({
    from: 0,
    to: pos,
    enter: (node) => {
      if (node.name === "VariableDeclaration") {
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === "VariableDefinition" && read(state, c) === name) {
            const init = c.nextSibling?.name === "Equals" ? c.nextSibling.nextSibling : null;
            if (init && init.to <= pos) found = init;
          }
        }
      } else if (node.name === "AssignmentExpression") {
        const target = node.node.firstChild;
        if (target?.name === "VariableName" && read(state, target) === name) {
          const value = node.node.lastChild;
          if (value && value.to <= pos) found = value;
        }
      }
    },
  });
  return found;
}

/** `part.faces().filter(f => f.…)` — `f` is a parameter of an arrow function that is an
 * argument to a call, and the call's entry says what its predicate is handed. Without
 * this the most common selector idiom in the language resolves to nothing. */
function callbackParamType(
  state: EditorState,
  from: SyntaxNode,
  name: string,
  depth: number,
): TypeName | null {
  for (let a: SyntaxNode | null = from; a; a = a.parent) {
    if (a.name !== "ArrowFunction") continue;
    const params = a.firstChild;
    if (!params) continue;
    const named =
      (params.name === "VariableDefinition" && read(state, params) === name) ||
      (params.name === "ParamList" &&
        (() => {
          for (let p = params.firstChild; p; p = p.nextSibling) {
            if (p.name === "VariableDefinition" && read(state, p) === name) return true;
          }
          return false;
        })());
    if (!named) continue;
    const call = a.parent?.name === "ArgList" ? a.parent.parent : null;
    if (call?.name !== "CallExpression") continue;
    const entry = calleeEntry(state, call.firstChild);
    if (entry?.callbackParam) return entry.callbackParam;
    void depth;
  }
  return null;
}

function option(name: string, spec: { doc: string }): Completion {
  return { label: name, type: "property", info: spec.doc, boost: 2 };
}

function member(name: string, entry: Entry): Completion {
  return {
    label: name,
    type: entry.signature ? "method" : "property",
    detail: entry.signature ?? undefined,
    info: entry.doc,
    boost: 2,
  };
}

function globalCompletion(name: string, entry: Entry): Completion {
  return {
    label: name,
    type: entry.signature ? "function" : "variable",
    detail: entry.signature ?? entry.type,
    info: entry.doc,
    // Our names sort above the language's keywords: typing `c` should not bury
    // `cuboid` under case, catch, class, const and continue.
    boost: 1,
    // Landing inside the parentheses is what makes the signature appear next.
    apply: entry.signature
      ? (view, _c, from, to) =>
          view.dispatch({
            changes: { from, to, insert: `${name}()` },
            selection: { anchor: from + name.length + 1 },
          })
      : undefined,
  };
}

/** The call an object literal belongs to, and which argument it is. */
function enclosingArgument(
  node: SyntaxNode,
): { call: SyntaxNode; index: number; count: number } | null {
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    const args = n.parent;
    if (args?.name !== "ArgList" || args.parent?.name !== "CallExpression") continue;
    let index = -1;
    let count = 0;
    for (let c = args.firstChild; c; c = c.nextSibling) {
      if (!isArgument(c)) continue;
      if (c.from === n.from) index = count;
      count++;
    }
    if (index < 0) continue;
    return { call: args.parent, index, count };
  }
  return null;
}

function optionsAt(
  state: EditorState,
  node: SyntaxNode,
): Record<string, { doc: string; values?: string[] }> | null {
  const found = enclosingArgument(node);
  if (!found) return null;
  const entry = calleeEntry(state, found.call.firstChild);
  if (!entry?.options) return null;
  // `-1` is the last argument — `display(a, b, { … })` takes as many values as it likes
  // before its style object.
  return (
    entry.options[found.index] ??
    (found.index === found.count - 1 ? entry.options[-1] : undefined) ??
    null
  );
}

export function nacreCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  const inner = syntaxTree(state).resolveInner(pos, -1);

  // 1 — after a dot: the members of whatever the receiver is.
  //
  // Only when the property really belongs to a member expression. A half-typed
  // `view({ f` also resolves to a `PropertyName` — inside a `PatternProperty`, because
  // `{ f` could still turn out to be a destructuring — and returning here on the
  // strength of the node's name alone silently swallowed every option completion.
  const isMember =
    (inner.name === "PropertyName" || inner.name === "." || inner.name === "?.") &&
    inner.parent?.name === "MemberExpression";
  if (isMember) {
    const expr = inner.parent!;
    const owner = typeOf(state, expr.firstChild);
    if (!owner) return null; // an unresolved receiver gets silence, not a guess
    const members = MEMBERS[owner];
    const options = Object.entries(members).map(([name, entry]) => member(name, entry));
    if (!options.length) return null;
    return {
      from: inner.name === "PropertyName" ? inner.from : pos,
      options,
      validFor: /^[\w$]*$/,
    };
  }

  // 2 — inside an object argument: the fields that call accepts, and their values.
  //     A half-typed `view({ f` parses as an ObjectPattern (it could still become a
  //     destructuring), so both shapes have to be recognised.
  const objectish = inner.name === "String" ? inner.parent : inner;
  const fields = objectish ? optionsAt(state, objectish) : null;
  if (fields) {
    if (inner.name === "String") {
      // The value side: `projection: "or…`. The one place a string is not silence.
      const property = inner.parent;
      const key = property?.firstChild;
      const values = key ? fields[read(state, key)]?.values : undefined;
      if (!values) return null;
      return {
        from: inner.from + 1,
        to: pos,
        options: values.map((v) => ({ label: v, type: "enum", boost: 2 })),
        validFor: /^[\w-]*$/,
      };
    }
    if (
      inner.name === "PropertyName" ||
      inner.name === "PropertyDefinition" ||
      inner.name === "{" ||
      inner.name === "ObjectExpression" ||
      inner.name === "ObjectPattern"
    ) {
      const from =
        inner.name === "PropertyName" || inner.name === "PropertyDefinition"
          ? inner.from
          : pos;
      return {
        from,
        options: Object.entries(fields).map(([name, spec]) => option(name, spec)),
        validFor: /^[\w$]*$/,
      };
    }
  }

  // 3 — strings, comments, and names being declared: say nothing.
  if (DONT_COMPLETE.has(inner.name)) return null;

  // 4 — a plain identifier: the vocabulary.
  if (inner.name === "VariableName" || context.explicit) {
    const from = inner.name === "VariableName" ? inner.from : pos;
    return {
      from,
      options: Object.entries(GLOBALS).map(([name, entry]) =>
        globalCompletion(name, entry),
      ),
      validFor: /^[\w$]*$/,
    };
  }
  return null;
}
