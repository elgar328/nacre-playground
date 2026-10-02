// What the editor offers, measured through the same door the editor uses.
//
// CodeMirror's state and parser need no DOM, so the completion source can be run here
// exactly as it runs in the browser: a real document, a real syntax tree, a real
// `CompletionContext`. Nothing here is a stand-in.
//
// The propositions worth pinning are the *discriminations*. A source that offered every
// name everywhere would pass "does `part.` offer translate" — so each case below is
// paired with something that must be absent.

import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { nacreCompletions } from "../src/app/complete";

/** Complete at the end of `doc` — the position a person is actually typing at.
 *
 * **The parse has to be finished before the question is asked.** Lezer parses inside a
 * time budget and `syntaxTree(state)` hands back whatever reached the deadline — so on a
 * busy machine a fresh state's tree can stop short of `doc.length`, the completion source
 * finds no node, and the answer is `[]`. Measured: without forcing the parse this file is
 * green on its own every time and fails in **three of three** full-suite runs, with a
 * *different* case failing each time; forcing the parse first makes three of three green.
 *
 * This is the harness catching up with the browser, not a product fix — there the
 * parser keeps working between keystrokes. But an instrument that answers differently
 * under load cannot tell a regression from a busy CPU, and a gate that passes on it
 * passes by luck. */
function offered(doc: string, explicit = false): string[] {
  const state = EditorState.create({
    doc,
    extensions: [javascript({ typescript: true })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  const result = nacreCompletions(new CompletionContext(state, doc.length, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

const PART = "let part = cuboid({ size: [10, 10, 10] });\n";

describe("what a value carries", () => {
  it("a solid offers a solid's methods — and not a sketch's", () => {
    const options = offered(`${PART}part.tr`);
    expect(options).toContain("translate");
    expect(options).toContain("faces");
    // The discrimination is the whole point: `lineTo` belongs to the pen.
    expect(options).not.toContain("lineTo");
  });

  it("a chain resolves, which is where the library's own path-walker gives up", () => {
    const pen = offered("sketch(XY).rect([0, 0], [4, 4]).");
    expect(pen).toContain("circle");
    expect(pen).toContain("lineTo");
    // There is no finishing verb to offer: a sketch exists as soon as it has a closed
    // shape, and `rect` gave it one.
    expect(pen).not.toContain("done");
    expect(pen).not.toContain("translate");
  });

  it("a sketch is drawn on until it is used — every spelling keeps the pen", () => {
    // Bare or with a shape already closed, the value is a sketch that still takes the pen
    // (close() finishes a path, not the sketch), and extruding it reaches a solid.
    expect(offered("sketch(XY).")).toContain("moveTo");
    expect(offered("sketch(XY).circle({center:[0,0],r:1}).")).toContain("moveTo");
    expect(offered("sketch(XY).rect([0,0],[1,1]).")).toContain("circle");
    expect(offered("extrude(sketch(XY).rect([0,0],[1,1]), 2).")).toContain("faces");
  });

  it("a callback parameter is resolved from the call that hands it over", () => {
    // The commonest idiom in the language, and one no declaration-walk can reach.
    const face = offered(`${PART}part.faces().filter(f => f.`);
    expect(face).toEqual(["normal", "center", "area"]);
    const vertex = offered(`${PART}part.vertices().filter(v => v.`);
    expect(vertex).toEqual(["x", "y", "z", "digits"]);
  });

  it("a property read carries on: f.normal is a direction, f.center is a point", () => {
    expect(offered(`${PART}part.faces().maxBy(f => f.area).normal.`)).toContain("isClose");
    expect(offered(`${PART}part.faces().maxBy(f => f.area).center.`)).toEqual(["x", "y", "z"]);
  });

  it("a reassignment is followed, not just the declaration", () => {
    // The demo does exactly this, and reading only `let` would freeze the type.
    const doc = `let s = sketch(XY);\ns = cuboid({ size: [1,1,1] });\ns.`;
    expect(offered(doc)).toContain("translate");
    expect(offered(doc)).not.toContain("moveTo");
  });

  it("a global that is a value, not a function", () => {
    // `Z` is a direction; the six axis and plane constants are values, and a rule that
    // only followed `let` bindings would resolve none of them.
    expect(offered("Z.")).toContain("isClose");
    // `sketch(XY)` says the same thing about `XY` in a way that has an answer to show:
    // it had to be recognised as a plane for the pen to come back.
    expect(offered("sketch(XY).")).toContain("rect");
  });

  it("an unresolved receiver gets silence, not a guess", () => {
    // Without this, every `Math.` and `console.` in a script would be handed the
    // union of everything nacre can do — worse than the nothing there is today.
    expect(offered("Math.")).toEqual([]);
    expect(offered("let a = somethingUnknown();\na.")).toEqual([]);
  });
});

describe("the vocabulary itself", () => {
  it("offers the globals, ranked above the language's own keywords", () => {
    const state = EditorState.create({
      doc: "cub",
      extensions: [javascript({ typescript: true })],
    });
    const result = nacreCompletions(new CompletionContext(state, 3, false))!;
    const cuboid = result.options.find((o) => o.label === "cuboid")!;
    expect(cuboid).toBeTruthy();
    // `case`, `catch`, `class`, `const` and `continue` all match "c" too; a boost is
    // what keeps `cuboid` from being buried under them.
    expect(cuboid.boost).toBeGreaterThan(0);
    expect(cuboid.detail).toContain("cuboid(");
  });

  it("the words that go inside the braces", () => {
    // Half of this API is option objects, and nobody remembers their field names.
    // Note the shape being completed here is an *ObjectPattern*: `view({ f` could still
    // become a destructuring, so that is what the parser makes of it while you type.
    expect(offered("view({ f")).toEqual([
      "from",
      "at",
      "zoom",
      "projection",
      "fov",
    ]);
    // And the fields are the ones that call takes — not every field there is.
    expect(offered("cuboid({ ")).toEqual(["size", "center", "corner"]);
    expect(offered("cuboid({ ")).not.toContain("color");
  });

  it("and the handful of words a field accepts", () => {
    // The seven view names are exactly what sends someone to the cheat sheet.
    expect(offered('view({ projection: "')).toEqual(["ortho", "perspective"]);
    expect(offered('view({ from: "to')).toContain("top");
    // A field with no fixed vocabulary stays a free string.
    expect(offered('view({ zoom: "')).toEqual([]);
  });

  it("options are keyed to the argument they belong to", () => {
    // `plane({ … })` and `plane(XY, { … })` take different fields, and merging them
    // would suggest `plane({ offset: 5 })`, which the API refuses.
    expect(offered("plane({ ")).toContain("through");
    expect(offered("plane({ ")).not.toContain("offset");
    expect(offered("plane(XY, { ")).toContain("offset");
    expect(offered("plane(XY, { ")).not.toContain("through");
    // `display` takes as many values as it likes before its style object, so its
    // fields are pinned to the last argument rather than to a fixed index.
    expect(offered(`${PART}display(part, part, { `)).toContain("edges");
  });

  it("says nothing inside strings and comments", () => {
    expect(offered(`${PART}display(part, { color: "#7f`)).toEqual([]);
    expect(offered("// cub")).toEqual([]);
    expect(offered("let cub")).toEqual([]); // a name being declared, not used
  });
});
