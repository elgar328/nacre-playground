// The reference table cannot drift from the API it describes.
//
// Two different failures are guarded here, and only one of them is loud by nature.
// A *missing* entry shows up as an empty completion list; a *wrong* `returns` shows up
// as nothing at all — the completions after it are simply the wrong ones, and no test
// that only counts names would notice. So the types are checked by calling the API and
// looking at what comes back.

import { describe, expect, it } from "vitest";
// @ts-ignore — CJS entry, the same door `cheatsheet.test.ts` runs the API through
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import {
  Axis,
  BodyList,
  Dir,
  FaceList,
  FacePick,
  PlaneToken,
  PlaneVal,
  Recorder,
  SketchBuilder,
  SolidVal,
  VertexList,
  VertexPick,
  makeApi,
} from "../src/api/recorder";
import { GLOBALS, INTERNAL, MEMBERS } from "../src/api/docs";
import { queries } from "./queries";
// The declarations a script is described by — read as text, since nothing loads it.
import ts from "typescript";
import dts from "../src/api/nacre.d.ts?raw";
import { EXAMPLES } from "./examples";
import { cheatScript } from "../src/app/cheatsheet";
import type { TypeName } from "../src/api/docs";

/** Every class the vocabulary can name, and which `TypeName` it answers to. */
const CLASSES: [TypeName, { prototype: object }][] = [
  ["Solid", SolidVal],
  ["Sketch", SketchBuilder],
  ["Plane", PlaneVal],
  ["WorldPlane", PlaneToken],
  ["Dir", Dir],
  ["VertexList", VertexList],
  ["FaceList", FaceList],
  ["BodyList", BodyList],
  ["VertexPick", VertexPick],
  ["FacePick", FacePick],
];

const classOf = (v: unknown): TypeName | null => {
  for (const [name, cls] of CLASSES) {
    if (v instanceof (cls as unknown as new (...a: never[]) => object)) return name;
  }
  return null;
};

const withoutInternal = (type: string, names: string[]) =>
  names.filter((n) => !(INTERNAL[type] ?? []).includes(n));

describe("the table names exactly what the API has", () => {
  it("every global, and no global that does not exist", () => {
    const real = Object.keys(makeApi(new Recorder()));
    expect(real.length).toBeGreaterThan(20); // the list is really being read
    expect(real.filter((n) => !GLOBALS[n])).toEqual([]);
    expect(Object.keys(GLOBALS).filter((n) => !real.includes(n))).toEqual([]);
  });

  it("every method a value carries", () => {
    for (const [type, cls] of CLASSES) {
      const real = withoutInternal(
        type,
        Object.getOwnPropertyNames(cls.prototype).filter((n) => n !== "constructor"),
      );
      const described = Object.keys(MEMBERS[type]);
      expect(real.filter((n) => !described.includes(n))).toEqual([]);
    }
  });

  it("and every field, which is not on any prototype to be found", () => {
    // The picks carry their report values as instance fields, so a prototype walk sees
    // none of them — `f.normal` would have been missing with every other test green.
    const instances: [TypeName, object][] = [
      ["FacePick", new FacePick(null, { x: 0, y: 0, z: 0 }, 1, { of: 0, face: 0 })],
      ["VertexPick", new VertexPick(0, 0, 0, { of: 0, vertex: 0 })],
      ["Dir", new Dir(0, 0, 1)],
    ];
    for (const [type, instance] of instances) {
      const real = withoutInternal(type, Object.keys(instance));
      expect(real.filter((n) => !MEMBERS[type][n])).toEqual([]);
    }
  });

  it("what is withheld is withheld on purpose", () => {
    // `rotate` is TypeScript-private, which is compile-time only — it is on the
    // prototype at runtime, and offering it would put an unsupported call in reach.
    // `ref` is the recorded reference a pick carries for the step log.
    expect(Object.getOwnPropertyNames(SolidVal.prototype)).toContain("rotate");
    expect(MEMBERS.Solid.rotate).toBeUndefined();
    expect(Object.keys(new VertexPick(0, 0, 0, { of: 0, vertex: 0 }))).toContain("ref");
    expect(MEMBERS.VertexPick.ref).toBeUndefined();
  });

  // `cylinder` *refuses* a field it does not know (every one of its fields has a
  // default, so a stray name would otherwise be swallowed).
  // That makes the table's option names a promise the call has to keep — two lists
  // that must agree, and nothing else makes them.
  it("the fields the table offers are fields the call accepts", () => {
    const sample: Record<string, unknown> = {
      r: 2,
      d: 4,
      h: 3,
      base: [0, 0, 0],
      center: [0, 0, 0],
      axis: new Axis(0, 0, 1),
    };
    const offered = Object.keys(GLOBALS.cylinder.options![0]);
    expect(offered.sort()).toEqual(Object.keys(sample).sort());
    for (const name of offered) {
      const api = makeApi(new Recorder());
      expect(() => api.cylinder({ [name]: sample[name] } as never), name).not.toThrow();
    }
  });

  // `mirror` likewise — its `{ offset }` has a default too, so a typo there would
  // build the un-offset mirror in silence. Both spellings are checked, because the option
  // sits at a different argument in each (the global carries the solid first).
  it("mirror's table and its two call shapes agree", () => {
    const offered = Object.keys(GLOBALS.mirror.options![2]);
    expect(offered).toEqual(["offset"]);
    expect(Object.keys(MEMBERS.Solid.mirror.options![1])).toEqual(offered);
    for (const name of offered) {
      const api = makeApi(new Recorder());
      const b = api.cuboid({ size: [1, 1, 1] });
      expect(() => api.mirror(b, api.YZ, { [name]: 1 } as never), name).not.toThrow();
      expect(() => api.cuboid({ size: [1, 1, 1] }).mirror(api.YZ, { [name]: 1 } as never), name)
        .not.toThrow();
    }
  });

  it("the check bites: a name that does not exist is described nowhere", () => {
    expect(GLOBALS.sphere).toBeUndefined();
    expect(MEMBERS.Solid.revolve).toBeUndefined();
    // `done` does not exist, rather than being withheld: a sketch is finished as soon as
    // it has a closed shape. The table must not name it either, or the editor offers a
    // call that is not there — and the members check only looks the other way (it asks
    // that the prototype is described, not that a description exists).
    expect(MEMBERS.Sketch.done).toBeUndefined();
  });
});

describe("what a call returns is checked by calling it", () => {
  // **One recorder per claim.** With a shared one, a single fixture that records
  // something the kernel will refuse — a lone open segment, say — poisons every later
  // query in the file, so the failures point everywhere except at the entry that caused
  // them. Independent recorders also mean a claim is measured on its own, which is what
  // it says it is.
  type Api = ReturnType<typeof makeApi>;
  const fresh = (): Api =>
    makeApi(new Recorder(queries));

  const box = (api: Api) => api.cuboid({ size: [10, 10, 10] });
  const pen = (api: Api) => api.sketch(api.XY) as SketchBuilder;
  const square = (api: Api) => pen(api).rect([-2, -2], [2, 2]);
  const topFace = (api: Api) =>
    box(api)
      .faces()
      .filter((f) => !!f.normal?.isClose(api.Z))
      .maxBy((f) => f.center.z);

  const CALLS: Record<string, (api: Api) => unknown> = {
    cuboid: (a) => a.cuboid({ size: [1, 1, 1] }),
    cylinder: (a) => a.cylinder({ r: 1, h: 2 }),
    fuse: (a) => a.fuse(box(a), box(a)),
    cut: (a) => a.cut(box(a), box(a)),
    common: (a) => a.common(box(a), box(a)),
    translate: (a) => a.translate(box(a), [1, 0, 0]),
    rotateX: (a) => a.rotateX(box(a), 10),
    rotateY: (a) => a.rotateY(box(a), 10),
    rotateZ: (a) => a.rotateZ(box(a), 10),
    mirror: (a) => a.mirror(box(a), a.YZ),
    copy: (a) => a.copy(box(a)),
    plane: (a) => a.plane(a.XY, { offset: 5 }),
    extrude: (a) => a.extrude(square(a), 2),
    // The one entrance, `sketch(plane)`, answers with a sketch.
    sketch: (a) => a.sketch(a.XY),
    "Solid.translate": (a) => box(a).translate([1, 0, 0]),
    "Solid.rotateX": (a) => box(a).rotateX(10),
    "Solid.rotateY": (a) => box(a).rotateY(10),
    "Solid.rotateZ": (a) => box(a).rotateZ(10),
    "Solid.mirror": (a) => box(a).mirror(a.YZ),
    "Solid.copy": (a) => box(a).copy(),
    "Solid.vertices": (a) => box(a).vertices(),
    "Solid.faces": (a) => box(a).faces(),
    "Solid.bodies": (a) => box(a).bodies(),
    "BodyList.at": (a) => box(a).bodies().at(0),
    "VertexList.nearest": (a) => box(a).vertices().nearest([0, 0, 0]),
    "FaceList.filter": (a) => box(a).faces().filter(() => true),
    "FaceList.maxBy": (a) => box(a).faces().maxBy((f) => f.area),
    "Sketch.moveTo": (a) => pen(a).moveTo([0, 0]),
    "Sketch.lineTo": (a) => pen(a).moveTo([0, 0]).lineTo([1, 1]),
    "Sketch.rect": (a) => square(a),
    "Sketch.arc": (a) => pen(a).moveTo([0, 0]).arc({ center: [0, 1], sweep: 90 }),
    "Sketch.circle": (a) => pen(a).circle({ center: [0, 0], r: 3 }),
    "Sketch.close": (a) => pen(a).moveTo([0, 0]).lineTo([4, 0]).lineTo([4, 4]).close(),
    pad: (a) => a.pad(topFace(a), square(a), 2),
    pocket: (a) => a.pocket(topFace(a), square(a), 2),
  };

  it("the claimed type is the type that comes back", () => {
    for (const [key, call] of Object.entries(CALLS)) {
      const [owner, name] = key.includes(".") ? key.split(".") : [null, key];
      const entry = owner
        ? MEMBERS[owner as TypeName][name]
        : GLOBALS[name.split("/")[0]];
      const claimed =
        typeof entry.returns === "string"
          ? entry.returns
          : entry.returns![Number(name.split("/")[1])];
      expect(`${key} → ${classOf(call(fresh()))}`).toBe(`${key} → ${claimed}`);
    }
  });

  it("every claim is covered — a new return type cannot arrive unmeasured", () => {
    const claims: string[] = [];
    for (const [name, entry] of Object.entries(GLOBALS)) {
      if (!entry.returns) continue;
      if (typeof entry.returns === "string") claims.push(name);
      else for (const n of Object.keys(entry.returns)) claims.push(`${name}/${n}`);
    }
    for (const [type, members] of Object.entries(MEMBERS)) {
      for (const [name, entry] of Object.entries(members)) {
        // Property reads (`f.normal`) name a type without being callable; the
        // execution check is for calls.
        if (entry.returns && entry.signature) claims.push(`${type}.${name}`);
      }
    }
    expect(claims.filter((c) => !CALLS[c])).toEqual([]);
  });

  it("the asymmetry the table has to be honest about", () => {
    // Two `filter`s, two different answers: FaceList's gives a FaceList, VertexList's
    // gives a plain array. Claiming otherwise would misfile everything downstream, so
    // the entry says nothing rather than something plausible.
    expect(MEMBERS.FaceList.filter.returns).toBe("FaceList");
    expect(MEMBERS.VertexList.filter.returns).toBeUndefined();
    expect(Array.isArray(box(fresh()).vertices().filter(() => true))).toBe(true);
  });
});

// A typo in an options object must be named, wherever options are taken.
//
// `onlyKeys` says why — *"where every field has a default the silence is expensive: the
// script does not fail, it builds the wrong thing"* — and a reader that takes an options
// object raw lets a stray key run to completion in silence. So every documented position
// is probed.
//
// The table below is the same idea as `CALLS`: one line per place the reference table
// says options live, and a completeness check so a new one cannot arrive unmeasured.
//
// **What this does and does not automate.** It freezes every position `docs.ts`
// documents. It cannot see a *new* call that takes options and never says so — `options`
// is an optional field on `Entry`, and nothing makes it required. Closing that needs the
// table's own shape to change, and is written down as its own piece of work.
describe("a stray key is named, at every documented options position", () => {
  type Api = ReturnType<typeof makeApi>;
  const fresh = (): Api => makeApi(new Recorder(queries));
  const box = (a: Api) => a.cuboid({ size: [1, 1, 1] });
  const pen = (a: Api) => a.sketch(a.XY) as SketchBuilder;
  const opt = { __nope: 1 } as never;

  /** One call per documented options position, keyed `entry@argument`. Each puts the
   * probe object where the table says options go, on a call that is otherwise valid.
   *
   * `plane@0` has to be **complete** — a spec missing a field is refused by the
   * catch-all before any key check runs, so a probe built that way would pass with no
   * guard in place and measure nothing. */
  const WITH_OPTS: Record<string, (a: Api, o: never) => unknown> = {
    "cuboid@0": (a, o) => a.cuboid({ size: [1, 1, 1], ...(o as object) }),
    "cylinder@0": (a, o) => a.cylinder({ r: 1, h: 2, ...(o as object) }),
    "rotateX@2": (a, o) => a.rotateX(box(a), 10, o),
    "rotateY@2": (a, o) => a.rotateY(box(a), 10, o),
    "rotateZ@2": (a, o) => a.rotateZ(box(a), 10, o),
    "mirror@2": (a, o) => a.mirror(box(a), a.YZ, o),
    "plane@0": (a, o) =>
      a.plane({ origin: [0, 0, 0], xPoint: [1, 0, 0], yHint: [0, 1, 0], ...(o as object) } as never),
    "plane@1": (a, o) => a.plane(a.XY, { offset: 5, ...(o as object) }),
    "display@-1": (a, o) => a.display(box(a), o),
    "style@0": (a, o) => a.style(o),
    "view@0": (a, o) => a.view({ from: "top", ...(o as object) }),
    "Solid.rotateX@1": (a, o) => box(a).rotateX(10, o),
    "Solid.rotateY@1": (a, o) => box(a).rotateY(10, o),
    "Solid.rotateZ@1": (a, o) => box(a).rotateZ(10, o),
    "Solid.mirror@1": (a, o) => box(a).mirror(a.YZ, o),
    "Sketch.lineTo@1": (a, o) => pen(a).moveTo([0, 0]).lineTo([1, 1], o),
    "Sketch.rect@2": (a, o) => pen(a).rect([0, 0], [1, 1], o),
    "Sketch.arc@0": (a, o) =>
      pen(a).moveTo([1, 0]).arc({ center: [0, 0], sweep: 90, ...(o as object) } as never),
    "Sketch.circle@0": (a, o) =>
      pen(a).circle({ center: [0, 0], r: 1, ...(o as object) } as never),
    "Sketch.close@0": (a, o) => pen(a).moveTo([0, 0]).lineTo([4, 0]).lineTo([4, 4]).close(o),
  };

  /** Every `entry@argument` the reference table documents. */
  const documented = (): string[] => {
    const out: string[] = [];
    for (const [name, e] of Object.entries(GLOBALS))
      for (const i of Object.keys(e.options ?? {})) out.push(`${name}@${i}`);
    for (const [type, members] of Object.entries(MEMBERS))
      for (const [name, e] of Object.entries(members))
        for (const i of Object.keys(e.options ?? {})) out.push(`${type}.${name}@${i}`);
    return out;
  };

  it("every documented position is probed, and every probe is documented", () => {
    const doc = documented();
    expect(doc.length).toBeGreaterThan(15); // the table is really being read
    expect(doc.filter((k) => !WITH_OPTS[k]).sort()).toEqual([]);
    expect(Object.keys(WITH_OPTS).filter((k) => !doc.includes(k)).sort()).toEqual([]);
  });

  // **The same shape, for the members that take a callback.** `docs.ts` already marks
  // them (`callbackParam`, which the completion engine reads to type the parameter inside
  // the arrow), so the set is the reference table's own — a new callback member arriving
  // without a probe turns this red rather than slipping through untested.
  //
  // Unguarded, the engine answers instead: `number 3 is not a function` for one
  // spelling and `key is not a function` for its sibling, neither naming the call.
  const WITH_CALLBACK: Record<string, (a: Api, cb: never) => unknown> = {
    "VertexList.filter": (a, cb) => box(a).vertices().filter(cb),
    "FaceList.filter": (a, cb) => box(a).faces().filter(cb),
    "FaceList.maxBy": (a, cb) => box(a).faces().maxBy(cb),
  };

  /** Every member the reference table says takes a callback. */
  const takesCallback = (): string[] => {
    const out: string[] = [];
    for (const [type, members] of Object.entries(MEMBERS))
      for (const [name, e] of Object.entries(members)) if (e.callbackParam) out.push(`${type}.${name}`);
    return out;
  };

  it("every member documented as taking a callback is probed, and every probe is documented", () => {
    const doc = takesCallback();
    expect(doc.length).toBeGreaterThan(2); // the mark is really being read
    expect(doc.filter((k) => !WITH_CALLBACK[k]).sort()).toEqual([]);
    expect(Object.keys(WITH_CALLBACK).filter((k) => !doc.includes(k)).sort()).toEqual([]);
  });

  it("names the argument that is not a function", () => {
    const bad: string[] = [];
    for (const [key, call] of Object.entries(WITH_CALLBACK)) {
      let said = "";
      try {
        call(fresh(), 3 as never);
      } catch (e) {
        said = (e as Error).message;
      }
      // Named, not merely refused — the warning the options probe above carries.
      if (!said.includes("is a function, got 3")) bad.push(`${key} → ${said || "no complaint at all"}`);
    }
    expect(bad, `${bad.length} of ${Object.keys(WITH_CALLBACK).length}`).toEqual([]);
  });

  // The claim is **named**, not merely refused. A probe that only asked "does it
  // throw" would go green on a call that died for some other reason — `plane@0` is
  // exactly that trap, which is why its probe carries a complete spec.
  it("names the key it does not know", () => {
    const bad: string[] = [];
    for (const [key, call] of Object.entries(WITH_OPTS)) {
      let said = "";
      try {
        call(fresh(), opt);
      } catch (e) {
        said = (e as Error).message;
      }
      if (!said.includes("__nope")) bad.push(`${key} → ${said || "no complaint at all"}`);
    }
    expect(bad, `${bad.length} of ${Object.keys(WITH_OPTS).length}`).toEqual([]);
  });
});

// **The scripts this app ships type-check against the declarations it ships.**
//
// Nothing checks a script today — sucrase strips the types and the editor only highlights
// them — so `nacre.d.ts` is prose that nobody executes, and prose drifts: a predicate asked
// for a `boolean` while the ordinary `f.normal?.isClose(Z)` is `boolean | undefined`, or a
// `display` that takes neither a sketch nor an `edges` option, both of which the app takes
// and the cheat sheet writes. This is the compiler reading it.
//
// It also reads the *scripts*: a cheat sheet teaching `f.normal.isClose(Z)` without the
// `?.` is a null dereference on any curved face — shipped advice that crashes the moment
// it is used on a cylinder.
describe("the app's own scripts against the app's own declarations", () => {
  /** Type errors in `script`, checked against `nacre.d.ts` and nothing else. */
  function diagnose(script: string): string[] {
    const files: Record<string, string> = { "/nacre.d.ts": dts, "/script.ts": script };
    const host: ts.CompilerHost = {
      fileExists: (f) => f in files || ts.sys.fileExists(f),
      readFile: (f) => files[f] ?? ts.sys.readFile(f),
      getSourceFile: (f, lang) => {
        const text = files[f] ?? ts.sys.readFile(f);
        return text === undefined ? undefined : ts.createSourceFile(f, text, lang, true);
      },
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      writeFile: () => {},
      getCurrentDirectory: () => "/",
      getCanonicalFileName: (f) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
    };
    const program = ts.createProgram(
      ["/nacre.d.ts", "/script.ts"],
      { noEmit: true, strict: true, target: ts.ScriptTarget.ES2020, lib: ["lib.es2020.d.ts"] },
      host,
    );
    return ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === "/script.ts")
      .map((d) => {
        const line = d.file!.getLineAndCharacterOfPosition(d.start!).line + 1;
        return `line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
      });
  }

  it("the examples and the cheat sheet have nothing to say to the compiler", () => {
    for (const [what, src] of [...EXAMPLES, ["cheat sheet", cheatScript()]] as const) {
      expect(diagnose(src), what).toEqual([]);
    }
  });

  // The instrument has to be able to speak, or the assertion above is a green nothing.
  it("…and it does report a real disagreement", () => {
    expect(diagnose(`let a = cuboid({ size: "big" });`)[0]).toContain("not assignable");
    expect(diagnose(`let a = cuboid({ size: [1, 1, 1] }).nope();`)[0]).toContain("does not exist");
  });
});

// `nacre.d.ts` is the third description of this API — the one an editor would load,
// and the one nothing else checks. Left alone it drifts — a global such as `style` or
// `view` goes undeclared, a `bodies()` or `BodyList` ships without the declarations
// hearing about it. `docs.ts` cannot drift like that because a test compares it both
// ways; this is the same tie for this file.
describe("the declarations file is the API too", () => {
  const declared = (kind: string) =>
    new Set([...dts.matchAll(new RegExp(`declare (?:${kind}) (\\w+)`, "g"))].map((m) => m[1]));

  it("every global is declared, and every declaration is a global", () => {
    const real = new Set(Object.keys(makeApi(new Recorder())));
    const said = new Set([...declared("function|const")]);
    expect([...real].filter((g) => !said.has(g)).sort()).toEqual([]);
    expect([...said].filter((g) => !real.has(g)).sort()).toEqual([]);
  });

  // A *declaration* check, not a type check: it asks that a line begins with the name
  // followed by `(`, `:` or `<`. That is enough for the failure that matters — a method
  // shipping and the declarations never hearing about it — without pretending to compare
  // signatures.
  //
  // "Does the name appear anywhere" is not enough, and planting the violation shows it:
  // with that check, deleting `bodies(): BodyList` stays green, because the prose one line
  // above says "zero or more disjoint **bodies**". A lock that reads the comments is not
  // reading the declarations.
  it("every member the table names is declared, not merely mentioned", () => {
    const missing: string[] = [];
    for (const [type, members] of Object.entries(MEMBERS))
      for (const name of Object.keys(members))
        if (!new RegExp(`^\\s*(?:readonly\\s+)?${name}\\s*[(:<]`, "m").test(dts))
          missing.push(`${type}.${name}`);
    expect(missing.sort()).toEqual([]);
  });
});
