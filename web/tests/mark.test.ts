// Where a call is, and what marking one costs the script that contains it.
//
// The strong claim here is not "the lines are right" but "**the script still means what
// it meant**" — so most of this file runs the same source twice, once plain and once
// marked, and compares what came out. A transform that reports beautiful lines for a
// program it has changed is worse than no transform.

import { describe, expect, it } from "vitest";
import { transform } from "sucrase";
import { MARKER, markCalls } from "../src/app/mark";
import { EXAMPLES } from "./examples";
import { cheatScript } from "../src/app/cheatsheet";

/** Run `src`, with or without markers, and collect what it said. */
function run(src: string, marked: boolean): unknown {
  const js = transform(marked ? markCalls(src) : src, { transforms: ["typescript"] }).code;
  const said: string[] = [];
  const world = {
    box: (n: unknown) => `box${n}`,
    out: (s: unknown) => void said.push(String(s)),
    list: () => [1, 2, 3],
    nums: () => [1, 2],
    sum: (...n: number[]) => n.reduce((a, b) => a + b, 0),
    maybe: () => ({ deep: () => "deep" }),
    boom: () => {
      throw new Error("bang");
    },
    pair: () => [1, 2],
    obj: () => ({ z: 3 }),
    cond: true,
    Thing: class {
      n: unknown;
      constructor(n: unknown) {
        this.n = n;
      }
    },
  };
  const names = Object.keys(world);
  const at = (_l: number, _n: string, thunk: () => unknown) => thunk();
  new Function(...names, "api", MARKER, `"use strict";\n${js}`)(
    ...names.map((n) => (world as never)[n]),
    { box: world.box },
    at,
  );
  return said;
}

/** Run marked, and report which line each call saw. */
function lines(src: string): string[] {
  const js = transform(markCalls(src), { transforms: ["typescript"] }).code;
  const log: string[] = [];
  let cur = 0;
  const api: Record<string, unknown> = {};
  for (const n of ["moveTo", "lineTo", "close", "rect", "filter", "map"]) {
    api[n] = (...a: unknown[]) => {
      log.push(`${n}@${cur}`);
      return typeof a[0] === "function" ? api : api;
    };
  }
  const fn = (n: string) => (..._a: unknown[]) => {
    log.push(`${n}@${cur}`);
    return api;
  };
  const at = (line: number, _name: string, thunk: () => unknown) => {
    const prev = cur;
    cur = line;
    try {
      return thunk();
    } finally {
      cur = prev;
    }
  };
  const names = ["sketch", "cut", "cuboid", "box", "keep", "XY", "ZX", "b"];
  const vals: unknown[] = [fn("sketch"), fn("cut"), fn("cuboid"), fn("box"), fn("keep"), {}, {}, {}];
  new Function(...names, MARKER, `"use strict";\n${js}`)(...vals, at);
  return log;
}

const SHAPES: [string, string][] = [
  ["for loop", `let acc = [];\nfor (let i = 0; i < 3; i++) {\n  acc.push(box(i));\n}\nout(acc.join(","));\n`],
  ["while + if/else", `let i = 0;\nwhile (i < 3) {\n  if (i % 2 === 0) { out(box(i)); } else { out("odd" + i); }\n  i++;\n}\n`],
  ["ternary", `out(cond ? box(1) : box(2));\n`],
  ["arrow callback", `out(list().filter((f) => f > 1).map((f) => box(f)).join("|"));\n`],
  ["optional chaining", `out(maybe()?.deep?.());\n`],
  ["template literal", "out(`a${box(1)}b${box(2)}`);\n"],
  ["computed member", `out(api["box"](7));\n`],
  ["new", `out(String(new Thing(3).n));\n`],
  ["spread", `out(sum(...nums()));\n`],
  ["try/catch", `try { boom(); } catch (e) { out("caught " + e.message); }\n`],
  ["nested fn + default arg", `function f(x = box(9)) { return x; }\nout(f());\nout(f("given"));\n`],
  ["destructuring", `const [a, b] = pair();\nconst { z } = obj();\nout(a + b + z);\n`],
  ["chain across lines", `out(list()\n  .filter((v) => v > 0)\n  .map((v) => v * 2)\n  .join("-"));\n`],
];

describe("marking does not change what a script means", () => {
  it("thirteen shapes say the same thing marked and unmarked", () => {
    for (const [what, src] of SHAPES) {
      expect(run(src, true), what).toEqual(run(src, false));
    }
  });

  // The fallback in `runtime.ts` is silent by design, so a transform that produces
  // broken source would show up as "no line numbers today" and nothing else. This is what
  // watches that silence.
  it("everything the app ships still compiles after marking", () => {
    for (const [what, src] of [...EXAMPLES, ["cheat sheet", cheatScript()], ...SHAPES] as const) {
      expect(() => transform(markCalls(src), { transforms: ["typescript"] }), what).not.toThrow();
    }
  });
});

describe("a call says which line it is on", () => {
  // A chain broken across lines, which is how sketches are written. Each verb has to
  // answer for its own line, because that is the number in the editor's gutter.
  it("every call in a chain has its own line", () => {
    expect(
      lines(`let s2 = sketch(ZX)\n  .moveTo([60, 15])\n  .lineTo([0, 15])\n  .lineTo([0, 85])\n  .close();\n`),
    ).toEqual(["sketch@1", "moveTo@2", "lineTo@3", "lineTo@4", "close@5"]);
  });

  // Marking the *receiver* instead lets a call in the arguments overwrite the marker, and
  // this shape — a solid built inside a boolean — is the commonest thing anyone writes
  // here.
  it("a call in the arguments does not steal the outer call's line", () => {
    expect(lines(`let c = cut(\n  cuboid({ size: [1,1,1] }),\n  b);\n`)).toEqual([
      "cuboid@2",
      "cut@1",
    ]);
    expect(lines(`let p = cut(\n  cuboid({size:[1,1,1]}),\n  sketch(XY)\n    .rect([0,0],[1,1]));\n`)).toEqual([
      "cuboid@2",
      "sketch@3",
      "rect@4",
      "cut@1",
    ]);
  });

  it("a loop, a callback and a branch each report the line that ran", () => {
    expect(
      lines(
        `let parts = [];\nfor (let i = 0; i < 2; i++) {\n  parts.push(\n    box(i));\n}\nlet picked = parts\n  .filter((p) => keep(p))\n  .map((p) => box(p));\nif (parts.length) {\n  box("in-if");\n} else {\n  box("in-else");\n}\n`,
      ),
      // `parts` is a real array, so `filter`/`map` are the language's own and only the
      // callbacks reach the fakes — which is the point: the *callback's* line is right.
    ).toEqual(["box@4", "box@4", "keep@7", "keep@7", "box@8", "box@8", "box@10"]);
  });
});

describe("the parser has to be the TypeScript one", () => {
  // The plain JavaScript parser reads `f<number>(1)` as `f < number > (1)` and finds no
  // call — so the marker would be missing and the line quietly lost. Nothing else would
  // fail; that is why this is pinned.
  // And the name is the function's, not the function plus its type arguments — a
  // generic call wears an extra node that has to be unwrapped.
  it("finds a generic call, and names it `f`", () => {
    expect(markCalls(`let a = f<number>(1);\n`)).toContain(`${MARKER}(1, "f"`);
    expect(markCalls(`let b = o.m<number>(2);\n`)).toContain(`${MARKER}(1, "m"`);
  });

  it("is not thrown off by TypeScript that has no runtime", () => {
    for (const [src, expected] of [
      [`interface P { x: number }\nlet a = box(1);\n`, `${MARKER}(2, "box"`],
      [`type P = { x: number };\nlet a = box(1);\n`, `${MARKER}(2, "box"`],
      [`enum E { A }\nlet a = box(1);\n`, `${MARKER}(2, "box"`],
      [`let a = box(1) satisfies unknown;\n`, `${MARKER}(1, "box"`],
    ] as const) {
      expect(markCalls(src), src).toContain(expected);
    }
  });
});

describe("a name only when there is one", () => {
  const names = (src: string) =>
    [...markCalls(src).matchAll(/__at\(\d+, ("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]));

  // Not every callee is a word. Reading one out of these produces a whole function body,
  // an expression — and, for a computed member, the closing bracket: `line 1 — ]`.
  it("leaves an unnameable callee unnamed rather than inventing a name", () => {
    expect(names(`(function () { return 1; })();`)).toEqual([""]);
    expect(names(`(() => 1)();`)).toEqual([""]);
    expect(names(`let a = [f][0](1);`)).toEqual([""]);
    expect(names(`let b = (x || y)(1);`)).toEqual([""]);
    // …and a call as a callee is not a name either.
    expect(names(`let d = f()(1);`)).toEqual(["", "f"]);
  });

  it("still names the ordinary shapes", () => {
    expect(names(`let c = obj.a.b.c(1);`)).toEqual(["c"]);
    expect(names(`cut(a, b);`)).toEqual(["cut"]);
  });
});
