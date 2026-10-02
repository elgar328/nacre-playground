// Which modifier the Run button names, and why it is not free to disagree.
//
// CodeMirror binds `Mod-Enter` and decides for itself whether `Mod` is ⌘ or Ctrl
// (`@codemirror/view`: `mac: ios || /Mac/.test(nav.platform)`), without exporting the
// answer. The label therefore mirrors that rule, and this table is what keeps the mirror
// honest: the strings are the real `navigator.platform` values, not invented ones.

import { describe, expect, it } from "vitest";
import { modLabel, runHint } from "../src/app/editor";

describe("the Run button names the key this platform actually has", () => {
  // An iPad reports `MacIntel`, which is why CodeMirror's `/Mac/` catches it and why
  // only the iPhone needs naming. Every one of these is a string a browser really sends.
  const APPLE = ["MacIntel", "MacPPC", "Mac68K", "iPhone", "iPad", "iPod touch"];
  const REST = ["Win32", "Win64", "Windows", "Linux x86_64", "Linux aarch64", "X11", "Android"];

  it("⌘ where Mod means Command, Ctrl everywhere else", () => {
    for (const p of APPLE) expect(modLabel(p), p).toBe("⌘");
    for (const p of REST) expect(modLabel(p), p).toBe("Ctrl");
  });

  // The hint is the modifier plus Return. The spacing differs because a glyph needs no
  // separator and a word does — `⌘⏎` reads as one chord, `Ctrl⏎` reads as a typo.
  it("the hint is the modifier and Return, spaced for what the modifier is", () => {
    expect(runHint("MacIntel")).toBe("⌘⏎");
    expect(runHint("Win32")).toBe("Ctrl ⏎");
  });

  // The instrument is not vacuous: it does tell the two apart.
  it("the two answers are different", () => {
    expect(modLabel("MacIntel")).not.toBe(modLabel("Win32"));
  });
});
