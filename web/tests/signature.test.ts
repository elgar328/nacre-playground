// Which call the cursor is inside, and which argument it is on.
//
// The tooltip is drawing; this is the deciding, and it is the part that can be quietly
// wrong. Measured on real documents through the same function the editor calls.

import { describe, expect, it } from "vitest";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { signatureAt } from "../src/app/signature";

/** `|` marks where the cursor is. */
function hintAt(withCursor: string) {
  const pos = withCursor.indexOf("|");
  const doc = withCursor.replace("|", "");
  const state = EditorState.create({
    doc,
    extensions: [javascript({ typescript: true })],
  });
  // Same reason as `complete.test.ts`'s `offered`: Lezer parses inside a time budget,
  // so a fresh state's tree can stop short of the cursor on a busy machine and this
  // reads as "no call here". Forcing the parse here closes that before it flakes, rather
  // than after it costs a diagnosis.
  ensureSyntaxTree(state, doc.length, 5000);
  return signatureAt(state, pos);
}

const PART = "let part = cuboid({ size: [10, 10, 10] });\n";

describe("signatureAt", () => {
  it("names the call the cursor is inside", () => {
    expect(hintAt("cuboid(|")).toEqual({
      signature: "cuboid({ size, center | corner })",
      active: 0,
    });
  });

  it("moves to the next argument as commas are passed", () => {
    expect(hintAt("extrude(|")?.active).toBe(0);
    expect(hintAt("extrude(outline, |")?.active).toBe(1);
    expect(hintAt("pad(face, sketch, |")?.active).toBe(2);
  });

  it("a comma inside an argument belongs to that argument", () => {
    // `{ size: [10, 20, 5] }` is one argument with commas in it — counting characters
    // rather than reading the tree would put the cursor on the third parameter of a call
    // that has one.
    expect(hintAt("cuboid({ size: [10, 20, |")?.active).toBe(0);
    expect(hintAt("translate(part, [1, 2, |")?.active).toBe(1);
  });

  it("methods are found too, through the receiver's type", () => {
    expect(hintAt(`${PART}part.rotateZ(|`)).toEqual({
      signature: "rotateZ(deg, { pivot })",
      active: 0,
    });
    // …and a chain still resolves.
    expect(hintAt("sketch(XY).lineTo(|")?.signature).toContain("lineTo(");
  });

  it("says nothing where there is nothing to say", () => {
    expect(hintAt("|")).toBeNull();
    expect(hintAt("cuboid({ size: [1,1,1] })|")).toBeNull(); // outside the parentheses again
    expect(hintAt("unknownThing(|")).toBeNull();
    expect(hintAt(`${PART}part.|`)).toBeNull();
  });
});
