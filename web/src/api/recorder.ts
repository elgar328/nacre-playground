// The recorder — the user syntax's implementation. Every call pushes a Step and hands back a wrapper;
// nothing is judged here. Value semantics come from the kit: reuse freely, the
// build copies before consumption.
//
// Rule of forms: unary operations exist as globals and methods; n-ary ones are
// globals only (a.fuse(b) would read a symmetric operation as a-centric).

import type {
  Anchor,
  Corner,
  CylAnchor,
  Dist,
  Edges,
  KitAxis,
  KitBool,
  Path,
  PenPath,
  Pivot,
  PlaneRef,
  Step,
  Style,
  Vec2,
  Vec3,
  VertexRef,
  WorldPlane,
} from "./steps";
import { Color } from "three";

import { VIEW_NAMES } from "./view";
import type { Projection, SceneView, Vec3 as ViewVec3, ViewName } from "./view";

/** The build-and-query door the selectors need — injected (the web bridge in the
 * app, the nodejs-target pkg in tests), so the runtime is lockable in both. */
export interface Queries {
  /** Written as the two shapes it really has, not one loose row. As `{ ok: boolean;
   * step?: number | null; message?: string }` it would say less than the wire promises:
   * a refusal always carries words, `null` is a value the wire never sends (`serde-wasm-
   * bindgen` writes `Option::None` as `undefined` — `RunErr.step` in `bridge.ts` states
   * it), and a message that might be absent would be pasted into a sentence, which puts
   * `step 1: undefined` one type away. */
  run(steps: Step[]): { ok: true } | { ok: false; step?: number; message: string };
  /** How many bodies a solid value has — `null` when it is not a solid. */
  bodiesOf(id: number): number | null;
  verticesOf(id: number): { vertex: number; at: Vec3 }[] | null;
  vertexDecimal(
    id: number,
    vertex: number,
    places: number,
  ): [string, string, string] | null;
  facesOf(
    id: number,
  ): { face: number; normal: Vec3 | null; center: Vec3; area: number }[] | null;
}

/** What `style(...)` has said about the scene so far.
 *
 * It is not a step: the layers are a ranking — the app's defaults, then the scene,
 * then a value's own `display` — rather than a sequence, so there is nothing about it
 * for the log to record. (The consequence, written down: a step log alone does not
 * describe the scene's defaults.) */
export type SceneStyle = {
  color?: string;
  opacity?: number;
  width?: number;
  edges?: Edges;
};

/** How many printed lines are kept. A script may legally say
 * `for (let i = 0; i < 1e6; i++) print(i)`, and keeping all of it would mean building a
 * million nodes to show them in. */
const PRINT_LIMIT = 500;

/** One recording — created per script run; the script's globals close over it. */
export class Recorder {
  steps: Step[] = [];
  sceneStyle: SceneStyle = {};
  /** What `view(...)` said — a ranking, not a sequence, for the same reason as the
   * styling above. `./view.ts` holds the vocabulary and what it means. */
  sceneView: SceneView = {};
  /** What `print(...)` said, in call order. Not steps: printing changes nothing about
   * the model, so there is nothing about it for the log to record — the same reason
   * `style` and `view` are fields rather than steps. */
  private printed: string[] = [];
  private dropped = 0;
  /** Where the call now running was written — set by the runtime's line marker, which
   * saves and restores it around every call, so this is always the innermost one. */
  at: { line: number; name: string } | null = null;
  /** Per step: where it was recorded from, when that was known. Parallel to `steps`. */
  stepLines: (number | null)[] = [];

  constructor(readonly queries?: Queries) {}

  push(step: Step): number {
    this.steps.push(step);
    // A step remembers where it came from. This is the *call's* line, not the
    // statement's: `cut(` on one line with its arguments on the next two still answers
    // for the line the word `cut` is on, which is the number in the editor's gutter.
    this.stepLines.push(this.at?.line ?? null);
    return this.steps.length - 1;
  }

  print(line: string): void {
    if (this.printed.length < PRINT_LIMIT) this.printed.push(line);
    else this.dropped++;
  }

  /** How many times `print(...)` was called — **not** `lines().length`, which carries the
   * cap's own closing note as one more entry. A badge that counts the note is off by one
   * exactly when a run is long enough for the count to matter. */
  get printedCount(): number {
    return this.printed.length;
  }

  /** The printed lines — with a last one naming what was left out.
   *
   * A cap that says nothing reads as "this is all of it". Whatever is dropped is
   * counted and stated, so a truncated run cannot be mistaken for a complete one. */
  lines(): string[] {
    if (!this.dropped) return this.printed;
    const n = this.dropped.toLocaleString("en-US");
    return [...this.printed, `… ${n} more lines (not kept)`];
  }

  /** Build the steps recorded so far — the selector entrance (pick
   * against the prefix, state by name). A failing prefix is a script error at the
   * query, in the kit's own words.
   *
   * **The step rides the error, not the sentence.** Pasting `step N: ` on the front
   * would repeat what the kit's message already opens with — the panel would read
   * `step 1: step 1: …` — and what the `Where` row says properly anyway, in the line the
   * author wrote. Handing the index over as the second argument is the whole of it. */
  ensureBuilt(): Queries {
    if (!this.queries)
      throw new ScriptError("selectors need a build door (internal: no queries)");
    const out = this.queries.run(this.steps);
    if (!out.ok) throw new ScriptError(out.message, out.step ?? undefined);
    return this.queries;
  }
}

/** A world-plane token: `XY`, `YZ`, `ZX` in scripts. */
export class PlaneToken {
  constructor(readonly world: WorldPlane) {}
}

/** A failure the script caused — a bad argument, or a build that declined under a
 * selector.
 *
 * `step` rides along when the failure came from a **build** (a selector forces one
 * mid-script). The message has always begun "step N: …", but a string cannot be used
 * to rebuild the prefix and show the author what they *did* get — `executeScript`
 * reads this field for exactly that. */
export class ScriptError extends Error {
  constructor(
    message: string,
    readonly step?: number,
  ) {
    super(message);
  }
}

const fail = (what: string): never => {
  throw new ScriptError(what);
};

/** Every options object in this API is read through here.
 *
 * **The one rule, written once.** A name the call does not know is otherwise
 * *swallowed in silence*, and where every field has a default the silence is expensive:
 * the script does not fail, it builds the wrong thing (`cuboid({ size, centre })` is a
 * box at the origin, `rect(…, { filet: 2 })` a sharp corner, `plane(XY, { ofset: 5 })`
 * the un-offset plane). That is true of `cuboid`, `pivot`, `corner`, `plane` and
 * `mirror`; `circle` and `arc` are cheaper cases — they *require* a field, so dropping
 * one already fails, and only a stray extra would go unmentioned. The rule is
 * worth having at all of them, but that is why it is worth having.
 *
 * `known` is spelled at the call, not read from `docs.ts`: the API is the truth and the
 * table describes it, never the other way round.
 *
 * Returns the object as a record, for the callers that go on to read it untyped. */
function onlyKeys(
  arg: unknown,
  known: readonly string[],
  what: string,
): Record<string, unknown> {
  if (arg === null || (arg !== undefined && typeof arg !== "object") || Array.isArray(arg))
    fail(`${what} takes an object like { ${known.join(", ")} }`);
  const a = (arg ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(a))
    if (!known.includes(k)) fail(`${what} does not take '${k}' — it takes ${known.join(", ")}`);
  return a;
}

/** An object literal — `{ color: "red" }` — as opposed to one of this API's values.
 *
 * **A rule, not a list of classes and not a bare `typeof`.** `display` and `plane` have to
 * tell "an options object" from "a value the script built", and each shortcut goes wrong
 * its own way. Naming the classes it is *not* (`!(x instanceof SolidVal) && !(x
 * instanceof SketchBuilder)`) is a list that goes stale the moment a value type is added,
 * and goes stale *silently*: measured, `display(a, planeVal)` would read the plane as a
 * style, draw nothing and say nothing. Asking only `typeof a === "object"` after the
 * `instanceof` arms have returned lets an **array** into the arm meant for a spec.
 * Every value in this API is a class instance, so the question is only whether this is a
 * literal — and that answer cannot drift.
 *
 * True within one realm. The script runs through `new Function` in this one (no
 * iframe, no worker), so a `{}` written in a script has this `Object.prototype`. If that
 * ever stops being so, this goes quietly wrong. */
function isPlainObject(x: unknown): x is Record<string, unknown> {
  return (
    typeof x === "object" && x !== null && Object.getPrototypeOf(x) === Object.prototype
  );
}

/** A value, as it should read back in a refusal — quoted when it is a string, so `"1"`
 * and `1` are told apart, and named when it is not finite.
 *
 * Three arms are this sentence's own, and then it hands over:
 *
 * - **a string is quoted**, because `got 30` and `got "30"` are different mistakes.
 * - **a non-finite number is named** — `JSON.stringify(NaN)` is `"null"`, which would have
 *   put `got null` in front of an author who wrote `NaN`.
 * - **an array is walked**, so the two rules above reach inside one.
 *
 * **Everything else is `show()`'s** — `print`'s renderer, which names every kind the
 * API has. `JSON.stringify` is the worse twin in two measured ways: a value of the
 * API's own (`rotateZ(a, a)`) comes back as **the whole recording** (229 characters for
 * one cube, 1416 for thirteen — it grows with the model), and a cyclic object makes it
 * **throw**, so the author would get `Converting circular structure to JSON` instead of
 * this sentence. `show` names kinds and already guards the cycle.
 *
 * It is not the *same* function: `show` returns a string unquoted, which is the first
 * arm above. The kinds are what is shared. */
const said = (x: unknown): string =>
  typeof x === "string"
    ? JSON.stringify(x)
    : Array.isArray(x)
      ? `[${x.map(said).join(", ")}]`
      : typeof x === "number" && !Number.isFinite(x)
        ? String(x)
        : show(x);

/** A number — the second half of the rule `onlyKeys` is the first half of.
 *
 * **The shape is the app's, the range is the kernel's.** A value of the wrong *shape*
 * dies at the wasm boundary in serde's words, and the kit's own refusals are far better
 * at range and geometry than anything here could be (`the fillet 9 at (0, 0) does not
 * fit — its edge is only 4 long`). So this asks only what the wire cannot carry, and
 * leaves "is it positive, does it fit" to the layer that knows.
 *
 * The exception is a value that **never reaches the kit** — a scene field, a
 * selector's tolerance. Nothing else will ever read those, so their range is checked
 * where they are read. */
function num(x: unknown, what: string): number {
  return typeof x === "number" && Number.isFinite(x)
    ? x
    : fail(`${what} is a number, got ${said(x)}`);
}

/** The colour names the renderer knows — **read from it, not copied.**
 *
 * 148 CSS names are needed. The app could hold them with a test comparing the two
 * lists, but measured, every reason not to import is noise: three is
 * already in this bundle (`app/viewport.ts` draws with it), it loads in node, and
 * `api/bridge.ts` already imports something far heavier and far more environment-bound
 * (the browser wasm build). Copying 148 lines and then writing a test to watch the copy
 * is copying twice; this cannot drift at all.
 *
 * **A `Set`, not `in`.** `"toString" in Color.NAMES` is `true` — it comes off
 * `Object.prototype` — while `new Color("toString")` warns and paints white. Reading the
 * table with `in` would have let through exactly the quiet wrong answer this door is for. */
const COLOUR_NAMES = new Set(Object.keys(Color.NAMES));

/** `#rgb` or `#rrggbb`, the two lengths the renderer accepts (any other length warns and
 * paints white). Case-insensitive, as it is there. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A colour: `#rgb`, `#rrggbb`, or a CSS name.
 *
 * **Nothing else will ever say.** A scene colour never crosses the wire, and a colour
 * that does cross is only *type*-checked there — measured, the kit carries `Option<String>`
 * and never looks at it. So a wrong one reached the renderer, which paints `#000005` for
 * `5` and white for `"reddd"`, warning to a browser console the author does not read.
 *
 * **`rgb(...)`/`hsl(...)` are refused**, though the renderer parses them. Matching that
 * grammar exactly (percentages, alpha, spacing) means copying its regexes, and unlike the
 * name table there is no way to hold that copy honest; matching it loosely would let
 * `rgb(banana)` back into silence. The cheat sheet does not use them, so the message
 * says what is taken instead. */
function colour(x: unknown, what: string): string {
  return typeof x === "string" && (HEX.test(x) || COLOUR_NAMES.has(x.toLowerCase()))
    ? x
    : fail(`${what} is a colour like "#7fb2c8", "#f80" or "red", got ${said(x)}`);
}

/** A function a list method will call.
 *
 * Without this the engine answers instead — `number 3 is not a function` for one
 * spelling and `key is not a function` for its sibling, neither naming the call. The
 * parameters are `unknown` so this cannot be skipped.
 *
 * What it *returns* is not this door's business. A predicate's answer is read for its
 * truth, which is JavaScript's own rule and `Array.prototype.filter`'s — the app's own
 * demo writes `f.normal?.isClose(Z)`, which is `undefined` on a curved face. A key is
 * compared, which is a different thing; `maxBy` asks about its answer where it reads it. */
function callable(x: unknown, what: string): (...args: unknown[]) => unknown {
  return typeof x === "function"
    ? (x as (...args: unknown[]) => unknown)
    : fail(`${what} is a function, got ${said(x)}`);
}

/** A whole number — an index, which is a different thing from a measurement.
 *
 * **Why this is not `num`.** `num` would leave `at(0.5)` to the range arm, and a range
 * is the wrong thing to blame: there is no half body anywhere, so the sentence would be
 * accidentally true and say nothing about the mistake. Shape and range are told apart. */
function whole(x: unknown, what: string): number {
  return typeof x === "number" && Number.isInteger(x)
    ? x
    : fail(`${what} is a whole number, got ${said(x)}`);
}

/** Three finite numbers. `point2` above is the same rule for the sketch plane.
 *
 * The *check* is one; the *phrase* belongs to the caller, because not every triple is a
 * point — `cuboid({ size })` is three lengths, and "is a point like [0, 0, 0]" would be a
 * wrong sentence about a right rule. Everything that really is a point takes the default. */
function point3(x: unknown, what: string, like = "a point like [0, 0, 0]"): Vec3 {
  return Array.isArray(x) && x.length === 3 && x.every((c) => Number.isFinite(c))
    ? (x as Vec3)
    : fail(`${what} is ${like}, got ${said(x)}`);
}

/** `extrude(s, 2)` or `extrude(s, [-2, 6])` — one door, because it is one argument.
 *
 * Asking `num` and then checking the array separately would answer *"is a number"* for
 * a range that is nearly right, which is the wrong half of the sentence.
 *
 * **A range of two, exactly.** `Dist::Both` is a tuple variant on the far side, and
 * serde reads two and **drops the rest** — measured: `extrude(s, [0, 1, 2])` would build
 * z 0…1 and say nothing about the `2`. Serde refuses too few; too many it lets through. */
function distOf(x: unknown, what: string): Dist {
  // One sentence, said from one place, and built only when it is needed.
  const no = () => fail(`${what} is a number or a range like [-2, 6], got ${said(x)}`);
  if (Array.isArray(x))
    return x.length === 2 && x.every((c) => Number.isFinite(c))
      ? { Both: x as [number, number] }
      : no();
  return typeof x === "number" && Number.isFinite(x) ? { One: x } : no();
}

/** The fields that only change how a thing looks. `style` and `display` take these plus
 * `edges`; an `edges` object takes exactly these. */
const APPEARANCE = ["color", "opacity", "width"] as const;

/** The three appearance fields, read in **one** place.
 *
 * `style`, `display` and an `edges` object all need this read, and three copies would each
 * be free to disagree about what a number is. A scene value never reaches the kit, so
 * nothing downstream would ever say: unchecked, `style({opacity: NaN})` goes to the
 * renderer as written and takes the model off the screen in silence. That is
 * why the range is checked here and not left to a later layer: there is no later layer.
 *
 * Passing `color` through because a wrong one would die at the wire does not hold: that
 * is true of `display`'s and **false of `style`'s**, which never crosses — and even the
 * wire only checks its *type*. So the colour is read here too. */
function styleFields(
  o: { color?: unknown; opacity?: unknown; width?: unknown },
  /** Whose fields these are, **already possessive** — `style's`, `display's edges`. The
   * possessive belongs to the caller because the nested one owns two words, and
   * `display's edges's opacity` is not a sentence anyone wants to read. */
  owner: string,
): { color: string | null; opacity: number | null; width: number | null } {
  let opacity: number | null = null;
  if (o.opacity !== undefined) {
    opacity = num(o.opacity, `${owner} opacity`);
    if (opacity < 0 || opacity > 1)
      fail(`${owner} opacity runs from 0 (invisible) to 1 (solid), got ${said(o.opacity)}`);
  }
  let width: number | null = null;
  if (o.width !== undefined) {
    width = num(o.width, `${owner} width`);
    if (width <= 0) fail(`${owner} width is a positive number of pixels, got ${said(o.width)}`);
  }
  const color = o.color === undefined ? null : colour(o.color, `${owner} color`);
  return { color, opacity, width };
}

/** A solid value — a `ValueId` with the unary methods on it. */
export class SolidVal {
  constructor(
    readonly rec: Recorder,
    readonly id: number,
  ) {}

  translate(offset: unknown): SolidVal {
    return new SolidVal(
      this.rec,
      this.rec.push({
        Translate: { src: this.id, offset: point3(offset, "translate's offset") },
      }),
    );
  }
  rotateX(deg: unknown, opts?: RotateOpts): SolidVal {
    return this.rotate("X", deg, opts);
  }
  rotateY(deg: unknown, opts?: RotateOpts): SolidVal {
    return this.rotate("Y", deg, opts);
  }
  rotateZ(deg: unknown, opts?: RotateOpts): SolidVal {
    return this.rotate("Z", deg, opts);
  }
  private rotate(axis: KitAxis, deg: unknown, opts?: RotateOpts): SolidVal {
    return new SolidVal(
      this.rec,
      this.rec.push({
        Rotate: {
          src: this.id,
          axis,
          deg: num(deg, `rotate${axis}'s angle`),
          pivot: pivotOf(opts, `rotate${axis}`),
        },
      }),
    );
  }
  mirror(plane: PlaneToken, opts?: { offset?: unknown }): SolidVal {
    return new SolidVal(
      this.rec,
      this.rec.push({
        Mirror: { src: this.id, plane: mirrorPlaneOf(plane, opts, "mirror") },
      }),
    );
  }
  copy(): SolidVal {
    return new SolidVal(this.rec, this.rec.push({ Copy: { src: this.id } }));
  }

  /** **Its bodies, each usable as a value of its own.**
   *
   * A boolean can answer with several solids — two parts that only touch are two parts
   * — and this is how a script points at one of them. Counting is free; taking one
   * costs a copy, which is the same rule `take` already follows for every value. */
  bodies(): BodyList {
    const q = this.rec.ensureBuilt();
    const n = q.bodiesOf(this.id);
    // A backstop, not a message a script can provoke: the query answers `null` only for
    // a value that is not a solid, and a `SolidVal` never wraps one. **Zero bodies is a
    // different thing entirely** — `common` of two solids that miss each other is empty,
    // and that answers `0`, so it comes back as a list of length 0 rather than here.
    if (n === null) fail(`value ${this.id} is not a solid (internal)`);
    return new BodyList(this.rec, this.id, n!);
  }

  /** The vertices, by appearance — builds the steps so far and reads the report. */
  vertices(): VertexList {
    const q = this.rec.ensureBuilt();
    const rows = q.verticesOf(this.id);
    if (!rows) fail(`value ${this.id} answered no vertices`);
    return new VertexList(
      rows!.map(
        (r) =>
          new VertexPick(
            r.at[0],
            r.at[1],
            r.at[2],
            { of: this.id, vertex: r.vertex },
            this.rec,
          ),
      ),
    );
  }

  /** The faces, by appearance — `normal` is null on curved faces (skip them). */
  faces(): FaceList {
    const q = this.rec.ensureBuilt();
    const rows = q.facesOf(this.id);
    if (!rows) fail(`value ${this.id} answered no faces`);
    return new FaceList(
      rows!.map(
        (r) =>
          new FacePick(
            r.normal ? new Dir(r.normal[0], r.normal[1], r.normal[2]) : null,
            { x: r.center[0], y: r.center[1], z: r.center[2] },
            r.area,
            { of: this.id, face: r.face },
          ),
      ),
    );
  }
}

/** The bodies of a solid value — **counted eagerly, taken lazily.**
 *
 * A kernel copy duplicates every cell of a body, so recording a step per body up front
 * would make `if (part.bodies().length > 1)` — asking a question — double the model.
 * `length` therefore builds nothing, and a body becomes a value only when it is asked
 * for. That is the rule the kit already follows: *mentioning* costs nothing, *taking*
 * copies.
 *
 * Iterable, so `let [a, b] = part.bodies()` and `for (const b of …)` read naturally;
 * each one materialises as it is reached. */
export class BodyList {
  /** Value ids already taken, by index — so `at(0)` twice is one body, not two copies. */
  private taken = new Map<number, SolidVal>();

  constructor(
    private readonly rec: Recorder,
    private readonly src: number,
    readonly length: number,
  ) {}

  /** The body at `i`, as a value. Negative counts from the end, as `Array.prototype.at`
   * does — a method called `at` that refused `-1` would be lying about its name.
   *
   * **Two failures, two sentences.** `i` is `unknown` because a script is not
   * type-checked — its types are stripped, never read — so the shape is this method's to
   * ask. Typed `number` and trusted, `at("0")` would fall through to the range arm and
   * answer `there is no body 0` for a value whose body 0 exists. A range is the
   * kernel's kind of fact; a shape is the app's. */
  at(i: unknown): SolidVal {
    const asked = whole(i, "at's index");
    const index = asked < 0 ? this.length + asked : asked;
    if (index < 0 || index >= this.length) {
      fail(
        `value ${this.src} has ${this.length} ` +
          `${this.length === 1 ? "body" : "bodies"}, so there is no body ${asked}`,
      );
    }
    const had = this.taken.get(index);
    if (had) return had;
    const made = new SolidVal(
      this.rec,
      this.rec.push({ Body: { src: this.src, index } }),
    );
    this.taken.set(index, made);
    return made;
  }

  *[Symbol.iterator](): Iterator<SolidVal> {
    for (let i = 0; i < this.length; i++) yield this.at(i);
  }
}

export interface RotateOpts {
  /** `unknown`, not `"center" | Vec3` — nothing typechecks a script, so a narrow type
   * here would be a promise the runtime does not keep. It also makes the door below
   * *mandatory*: the step's field is typed, so skipping it will not compile. */
  pivot?: unknown;
}

function pivotOf(opts: RotateOpts | undefined, what: string): Pivot {
  onlyKeys(opts, ["pivot"], what);
  if (!opts || opts.pivot === undefined) return "Origin";
  if (opts.pivot === "center") return "Center";
  // After the one string that is legal here.
  return { At: point3(opts.pivot, `${what}'s pivot`) };
}

/** The mirror plane: a world plane, moved along its own normal by `offset`.
 *
 * **A reflection is in a *plane*, so the argument names one.** The kernel says the
 * same thing — "reflect the solid in the coordinate plane `axis = offset`" — and the
 * normal is only one way of naming that plane. Taking `{ normal: "X", offset: 3 }` as
 * well as `YZ` would make one argument position name two different kinds of thing, and
 * a reader would have to convert. `YZ` carries its own offset, so the plane is the only
 * spelling.
 *
 * `{ offset }` is the shape `plane(XY, { offset: 5 })` already uses, and means the
 * same thing there: **along the normal**.
 *
 * Why not an `Axis` token? Because `mirror(part, X)` and `plane(YZ, …)` would then
 * name the same geometric object two different ways — the two-spellings problem above,
 * re-introduced. Plane tokens are the argument of
 * `sketch`, `plane` and `mirror`; axis tokens say which way a cylinder runs. */
function mirrorPlaneOf(
  arg: unknown,
  opts: { offset?: unknown } | undefined,
  what: string,
): { normal: KitAxis; offset: number } {
  if (arg instanceof PlaneToken) {
    onlyKeys(opts, ["offset"], what);
    // The mirror plane's normal is the axis the plane constant leaves out.
    const normal: KitAxis =
      arg.world === "XY" ? "Z" : arg.world === "YZ" ? "X" : "Y";
    return {
      normal,
      offset: opts?.offset === undefined ? 0 : num(opts.offset, `${what}'s offset`),
    };
  }
  // Two wrong guesses are worth their own sentences. A *plane value* is the natural
  // one — and unchecked it would be recorded as `{ offset: 0 }` with no normal at all,
  // which runs, says nothing, and dies at the wasm boundary as `missing field normal`.
  if (arg instanceof PlaneVal)
    fail(`${what} takes XY, YZ or ZX — a plane value is not one of them yet`);
  if (arg !== null && typeof arg === "object" && "normal" in arg)
    fail(
      `${what} names the plane, not its normal — { normal: "X" } is YZ, ` +
        `"Y" is ZX, "Z" is XY, and an offset goes in ${what}(…, { offset })`,
    );
  fail(`${what} takes XY, YZ or ZX`);
  return { normal: "Z", offset: 0 }; // unreachable
}

/** A plane value — pure data plus an interned kernel handle; never consumed. */
export class PlaneVal {
  constructor(
    readonly rec: Recorder,
    readonly id: number,
  ) {}
}

/** A direction for selector comparisons — report-grade f64 (selection reads
 * f64, statements use names). */
export class Dir {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
  ) {}

  isClose(other: Dir, tol = 1e-6): boolean {
    // The kit never sees either of these. Unchecked, both fail the same silent way: a
    // direction that is not one reads `undefined` components, a negative tolerance can
    // never be met, and either way the filter quietly selects nothing.
    if (!(other instanceof Dir))
      fail(`isClose compares directions — X, Y, Z or a face's normal — got ${said(other)}`);
    if (num(tol, "isClose's tolerance") < 0)
      fail(`isClose's tolerance is not negative, got ${said(tol)}`);
    const dot = this.x * other.x + this.y * other.y + this.z * other.z;
    return Math.abs(dot - 1) < tol;
  }
}

/** One of the three world axes — `X`, `Y`, `Z`, and nothing else.
 *
 * **A statement's word, told apart from a selection's by type.** [`Dir`] above is
 * report-grade f64 for comparing normals (selection reads f64, statements use
 * names), so a call that *states* an axis asks for the narrower thing. Subclassing keeps
 * one vocabulary — `Z` is still a `Dir`, so `face.normal.isClose(Z)` reads the same.
 *
 * **Today the types check nobody.** A script is transformed by sucrase, which strips
 * types without reading them, and the editor only highlights — `nacre.d.ts` says so in
 * its first line. So the door a script actually meets is the runtime check in
 * `cylinder`, and the declared types are a statement of intent that `tsc` keeps honest
 * (`tests/axis-types.ts`), not an enforcement the user sees.
 *
 * Note that in `nacre.d.ts` the declared `Axis` carries a private marker and this one
 * does not. It does not need one: nothing here narrows a `Dir` to an `Axis` by type —
 * the runtime comparison does that work — whereas the declaration exists precisely to
 * say the narrowing, and without a marker TypeScript's structural rule would make it
 * say nothing. */
export class Axis extends Dir {}

/** One vertex, picked by appearance; `ref` is the name a statement records. */
export class VertexPick {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly ref: { of: number; vertex: number },
    /** Optional so a test can build a pick without a session; `digits` is what needs it. */
    private readonly rec?: Recorder,
  ) {}

  /** **This vertex's coordinate to `places` decimal places** — a diagnostic.
   *
   * `x`/`y`/`z` above are the report cache, and past about seventeen digits a cache prints its
   * own rounding rather than the point. This asks the kernel to realize the coordinate from the
   * vertex's definition instead, so every digit is one the definition determines. On a vertex
   * that is an exact ratio — a box corner, say — they are the coordinate's *own* digits, not a
   * rounding of it.
   *
   * Ask for `places` and you get `places`: the kernel raises its working precision until they
   * are determined, so this does not quietly hand back fewer.
   *
   * A diagnostic verb, and the syntax overhaul may rename or remove it. */
  digits(places: unknown): string {
    const n = whole(places, "digits' places");
    // A ceiling, not a preference: the kernel's ladder is finite, and a script asking for
    // thousands of places would spend the run climbing it to no purpose.
    if (n < 0 || n > 200) fail(`digits' places is 0 to 200, got ${said(places)}`);
    if (!this.rec) fail("digits needs a vertex picked from a value (use vertices())");
    const q = this.rec!.ensureBuilt();
    const d = q.vertexDecimal(this.ref.of, this.ref.vertex, n);
    if (!d) {
      // **Two very different failures, and the common one is not the kernel's.** A vertex
      // index is model-global and the model is rebuilt on every `ensureBuilt`, so the same
      // solid's corners are 0–7 before a `fuse` and 24–31 after it (measured). A pick taken
      // before further building therefore names nothing in its value — the kit's
      // membership check catches it, which is the only reason this hands back a refusal instead
      // of some other corner's coordinate.
      //
      // A statement like `plane({ through: [...] })` is safe from this because it *records* the
      // reference at the point in the log where it was valid, and replay rebuilds that same
      // prefix. `digits` is a query, answered against the steps that exist when it is called.
      //
      // **Not "cannot be realized exactly"** either — that would name a promise this door
      // never makes (a seam vertex is realized, never exact, and answers fine).
      const live = q.verticesOf(this.ref.of);
      const stale = !live?.some((r) => r.vertex === this.ref.vertex);
      fail(
        stale
          ? `this vertex was picked before later steps were built — ask for its digits right ` +
              `after picking it, or pick it again from ${said(this.ref.of)}`
          : `vertex ${this.ref.vertex} has no coordinate the kernel can work out`,
      );
    }
    return `(${d!.join(", ")})`;
  }
}

export class VertexList {
  constructor(readonly items: VertexPick[]) {}

  nearest(p: Vec3): VertexPick {
    if (this.items.length === 0) fail("nearest on an empty vertex list");
    // Compared here, not recorded: unchecked, `nearest([0, 0])` reads `p[2]` as undefined
    // and every distance comes out NaN, so it answers with the first vertex whatever was
    // asked.
    p = point3(p, "nearest's point");
    let best = this.items[0];
    let bestD = Infinity;
    for (const v of this.items) {
      const d = (v.x - p[0]) ** 2 + (v.y - p[1]) ** 2 + (v.z - p[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** **Two signatures on purpose.** A value parameter can simply be `unknown` — the
   * script is not type-checked, and nothing is lost. A *callback* parameter cannot: typed
   * `unknown` it takes the element type away from every TypeScript caller, and the
   * repository's own probes write `f => f.area`. So the declared signature stays exact
   * (and a typed caller passing a non-function is a compile error), while the body
   * sees `unknown` and therefore cannot skip the door. */
  filter(pred: (v: VertexPick) => unknown): VertexPick[];
  filter(pred: unknown): VertexPick[] {
    const test = callable(pred, "filter's test");
    return this.items.filter((v) => test(v));
  }

  get length(): number {
    return this.items.length;
  }
}

/** One face, picked by appearance; `ref` is the name pad/pocket record. */
export class FacePick {
  constructor(
    readonly normal: Dir | null,
    readonly center: { x: number; y: number; z: number },
    readonly area: number,
    readonly ref: { of: number; face: number },
  ) {}
}

export class FaceList {
  constructor(readonly items: FacePick[]) {}

  /** Two signatures, for the reason `VertexList.filter` gives. */
  filter(pred: (f: FacePick) => unknown): FaceList;
  filter(pred: unknown): FaceList {
    const test = callable(pred, "filter's test");
    return new FaceList(this.items.filter((f) => test(f)));
  }

  /** **The score is read too.** `>` on anything else does not fail, it just stops
   * meaning anything: `maxBy(f => "x")` would compare strings and hand back a face with
   * no complaint, and a key answering `NaN` makes every comparison false so the first face
   * wins whatever was asked. Both would be silent.
   *
   * Reading it once per face also keeps the key to one call per face, rather than two per
   * step plus `key(best)` again on every one. */
  maxBy(key: (f: FacePick) => number): FacePick;
  maxBy(key: unknown): FacePick {
    if (this.items.length === 0) fail("maxBy on an empty face list");
    const score = callable(key, "maxBy's key");
    // `num` writes "<what> is a number, got …", so `what` names the thing being asked
    // about — the score, which is the reference table's own word ("the one scoring
    // highest"). Naming the key here would say the *key* should be a number.
    const scored = (f: FacePick) => num(score(f), "maxBy's score");
    let best = this.items[0];
    let bestScore = scored(best);
    for (const f of this.items) {
      const s = scored(f);
      if (s > bestScore) {
        best = f;
        bestScore = s;
      }
    }
    return best;
  }

  get length(): number {
    return this.items.length;
  }
}

// ---- sketches -------------------------------------------------------------------

interface CornerOpts {
  chamfer?: number;
  fillet?: number;
}

function cornerOf(opts: CornerOpts | undefined, what: string): Corner | null {
  onlyKeys(opts, ["chamfer", "fillet"], what);
  if (!opts) return null;
  if (opts.chamfer !== undefined && opts.fillet !== undefined)
    fail("a corner takes chamfer or fillet, not both");
  // Read here for the same reason the pen's points are: the sketch step is recorded later.
  if (opts.chamfer !== undefined) return { Chamfer: num(opts.chamfer, `${what}'s chamfer`) };
  if (opts.fillet !== undefined) return { Fillet: num(opts.fillet, `${what}'s fillet`) };
  return null;
}

/** `circle({ center, r | d })` — one of `r`, `d`; the literal is recorded as written. */
export function circleOf(arg: unknown, what: string): Path {
  const a = onlyKeys(arg, ["center", "r", "d"], what);
  const center = point2(a.center, `${what}'s center`);
  if (a.r !== undefined && a.d !== undefined) fail(`${what} takes r or d, not both`);
  if (a.r === undefined && a.d === undefined) fail(`${what} needs r or d`);
  const size =
    a.r !== undefined
      ? { Radius: positive(a.r, `${what}'s r`) }
      : { Diameter: positive(a.d, `${what}'s d`) };
  return { Circle: { center, size } };
}

/** `sweep` in degrees — nonzero and finite here; the kit says whether the angle is one it
 * can state exactly (a multiple of 90 today). */
function sweepOf(x: unknown, what: string): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x === 0)
    fail(`${what} needs a nonzero sweep in degrees, got ${said(x)}`);
  return x as number;
}

function point2(x: unknown, what: string): Vec2 {
  return Array.isArray(x) && x.length === 2 && x.every((c) => Number.isFinite(c))
    ? (x as Vec2)
    : fail(`${what} is a point like [0, 0], got ${said(x)}`);
}

function positive(x: unknown, what: string): number {
  return Number.isFinite(x) && (x as number) > 0
    ? (x as number)
    : fail(`${what} must be positive, got ${said(x)}`);
}

/** A sketch: the pen you draw with, and the value you extrude.
 *
 * **A sketch exists as soon as it has a closed shape.** `close()`, `rect()` and
 * `circle()` each bring one into being and each records the step. There is no finishing
 * verb, because there is nothing left for one to do: a sketch is not finished *into* a
 * different value — it is the thing you were drawing all along.
 *
 * `close()` finishes the *path*, not the sketch: drawing on afterwards (another `moveTo`,
 * a `circle`, a `rect`) adds to that same step, until something uses the sketch — from
 * then on it is frozen, so a later stroke cannot change a solid already made from it. The
 * step holds the same arrays the pen writes to, which is what lets a recorded sketch keep
 * growing without a second step. */
export class SketchBuilder {
  private paths: Path[] = [];
  private pen: PenPath | null = null;
  /** The recorded step's index — set by the first closed shape. */
  id: number | null = null;
  private used = false;

  constructor(
    readonly rec: Recorder,
    readonly plane: PlaneRef,
  ) {}

  private drawing(what: string): void {
    if (this.used)
      fail(`${what}: this sketch has already been used — draw before extruding it, or start a new sketch(...)`);
  }

  /** Record the sketch step once; later strokes land in the same step's arrays. */
  private record(): this {
    if (this.id === null)
      this.id = this.rec.push({
        Sketch: { plane: this.plane, paths: this.paths },
      });
    return this;
  }

  /** The recorded id, for a consumer: no open path, recorded, and frozen from here on. */
  use(what: string): number {
    if (this.pen) fail(`${what}: the sketch has an open pen path — close() it first`);
    // Every verb that brings a closed shape into being records the step, so reaching
    // here means *nothing was drawn* — the open-pen case is caught one line up. The kit
    // said this in its own words a step later; saying it here says it about the call the
    // author actually wrote.
    if (this.id === null)
      fail(`${what}: an empty sketch — draw at least one closed path`);
    this.used = true;
    return this.id!;
  }

  moveTo(start: Vec2): this {
    this.drawing("moveTo");
    if (this.pen) fail("moveTo starts a path — close() the previous one first");
    // Checked *here*, not at the wire. The sketch step is pushed once, by whichever
    // verb first closes a shape, so its recorded line is `close()`'s — a wire refusal
    // would name that line for a value written on this one.
    this.pen = { start: point2(start, "moveTo's start"), segs: [], close_corner: null };
    return this;
  }

  lineTo(to: Vec2, corner?: CornerOpts): this {
    if (!this.pen) fail("lineTo needs a moveTo first");
    this.pen!.segs.push({
      LineTo: { to: point2(to, "lineTo's point"), corner: cornerOf(corner, "lineTo") },
    });
    return this;
  }

  /** `arc({ center, sweep })` — from where the pen stands, about `center`, turning `sweep`
   * degrees (positive = +x toward +y). The end point is the kernel's to compute. */
  arc(arg: { center: Vec2; sweep: number }): this {
    if (!this.pen) fail("arc needs a moveTo first");
    const a = onlyKeys(arg, ["center", "sweep"], "arc");
    this.pen!.segs.push({
      Arc: { center: point2(a.center, "arc's center"), sweep: sweepOf(a.sweep, "arc") },
    });
    return this;
  }

  /** Close the pen path (the closing line is drawn for you — none if the pen is already at
   * the start). The sketch is usable from here, and can still be drawn on. */
  close(corner?: CornerOpts): this {
    if (!this.pen) fail("close() needs a pen path — moveTo first");
    this.pen!.close_corner = cornerOf(corner, "close");
    this.paths.push({ Pen: this.pen! });
    this.pen = null;
    return this.record();
  }

  /** An axis-aligned rectangle between two opposite corners — one closed path. A corner
   * treatment applies to all four corners: `rect(a, b, { fillet: r })` rounds them, and
   * with `r` half the short side the rectangle is a slot (the kit merges the meeting
   * quarter arcs into a half circle). */
  rect(c1: Vec2, c2: Vec2, corner?: CornerOpts): this {
    this.drawing("rect");
    // Before `Math.min`, which is the whole point: it *coerces*, so `rect(["2", 0], …)`
    // would become the rectangle from (1,0) to (2,1) without a word said.
    const a = point2(c1, "rect's first corner");
    const b = point2(c2, "rect's second corner");
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    const c = cornerOf(corner, "rect");
    this.paths.push({
      Pen: {
        start: [x0, y0],
        segs: [
          { LineTo: { to: [x1, y0], corner: c } },
          { LineTo: { to: [x1, y1], corner: c } },
          { LineTo: { to: [x0, y1], corner: c } },
        ],
        close_corner: c,
      },
    });
    return this.record();
  }

  /** `circle({ center, r | d })` — its own closed path; a hole or an island by nesting. */
  circle(arg: { center: Vec2; r?: number; d?: number }): this {
    this.drawing("circle");
    this.paths.push(circleOf(arg, "circle"));
    return this.record();
  }

}

// ---- the globals ----------------------------------------------------------------

/** The script API — one object per run, spread into the script's scope. */
/** One value, as a line of text.
 *
 * A value is `value N` here because that is what it is called in the messages the kit
 * refuses with (*"value 3 has 2 bodies"*) — and it is the **same** N, since both are the
 * step index. One vocabulary for the thing being talked about.
 *
 * Numbers are not tidied. `0.1 + 0.2` prints as `0.30000000000000004`, because that is
 * the number the script has; showing a rounder one would be showing a different value,
 * which is the opposite of what this kernel is for. (Script arithmetic is f64 and is a
 * different thing from the exact numbers the kernel judges with.) */
function show(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof SolidVal) return `Solid value ${v.id}`;
  if (v instanceof PlaneVal) return `Plane value ${v.id}`;
  if (v instanceof PlaneToken) return `${v.world} plane`;
  if (v instanceof BodyList) return `BodyList(${v.length})`;
  if (v instanceof FaceList) return `FaceList(${v.items.length})`;
  if (v instanceof VertexList) return `VertexList(${v.items.length})`;
  if (v instanceof FacePick)
    return `FacePick(face ${v.ref.face} of value ${v.ref.of})`;
  if (v instanceof VertexPick)
    return `VertexPick(vertex ${v.ref.vertex} of value ${v.ref.of})`;
  if (v instanceof Dir) return `Dir(${v.x}, ${v.y}, ${v.z})`;
  if (v instanceof SketchBuilder)
    return v.id === null ? "Sketch (unfinished)" : `Sketch value ${v.id}`;
  if (typeof v === "object" && v !== null) {
    // A cycle makes `stringify` throw, and a `print` that kills the script it was
    // added to debug is worse than one that says less.
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return "[object]";
    }
  }
  return String(v);
}

/** Several arguments as one line, the way `console.log` joins them. */
export const printLine = (args: unknown[]): string => args.map(show).join(" ");

export function makeApi(rec: Recorder) {
  const solidArg = (v: unknown, what: string): number => {
    if (v instanceof SolidVal) return v.id;
    if (v instanceof SketchBuilder)
      fail(`${what} takes solids — got a sketch (extrude it first)`);
    fail(`${what} takes solids — got ${typeof v}`);
    return -1; // unreachable
  };

  /** `display` takes anything with something to show — a solid, or a sketch. */
  const shownArg = (v: unknown): number => {
    if (v instanceof SolidVal) return v.id;
    if (v instanceof SketchBuilder) return v.use("display");
    if (v instanceof PlaneVal)
      fail("display takes solids and sketches — a plane has no extent to draw");
    // `display` is variadic, so a list is a near miss rather than a wrong idea — and
    // as the last argument it would be read as a style and dropped without a word.
    if (Array.isArray(v))
      fail("display takes values one at a time — display(a, ...list) spreads a list");
    fail(`display takes solids and sketches — got ${typeof v}`);
    return -1; // unreachable
  };

  const boolean = (kind: KitBool, name: string, args: unknown[]): SolidVal => {
    if (args.length < 2) fail(`${name} needs at least two arguments`);
    return new SolidVal(
      rec,
      rec.push({
        Boolean: { kind, args: args.map((a) => solidArg(a, name)) },
      }),
    );
  };

  const XY = new PlaneToken("XY");
  const YZ = new PlaneToken("YZ");
  const ZX = new PlaneToken("ZX");
  // Hoisted like the plane tokens above, because `cylinder` compares against them.
  const X = new Axis(1, 0, 0);
  const Y = new Axis(0, 1, 0);
  const Z = new Axis(0, 0, 1);

  const planeRefOf = (p: unknown): PlaneRef => {
    if (p instanceof PlaneToken) return { World: p.world };
    if (p instanceof PlaneVal) return { Value: p.id };
    fail("sketch() takes a plane — XY/YZ/ZX or a plane(...) value");
    return { World: "XY" }; // unreachable
  };

  /** `plane(...)` — every form, recorded as datum statements. */
  function plane(
    a: unknown,
    opts?: { offset?: unknown; origin?: unknown },
  ): PlaneVal {
    if (a instanceof PlaneToken) {
      onlyKeys(opts, ["offset", "origin"], "plane");
      if (opts?.offset !== undefined && opts?.origin !== undefined)
        fail("plane takes offset or origin, not both");
      if (opts?.origin !== undefined)
        return new PlaneVal(
          rec,
          rec.push({
            Plane: {
              spec: {
                WorldAt: { base: a.world, origin: point3(opts.origin, "plane's origin") },
              },
            },
          }),
        );
      if (opts?.offset !== undefined) {
        // Offset is sugar over a base plane value; the kit does the exact shift.
        const base = rec.push({ Plane: { spec: { World: a.world } } });
        return new PlaneVal(
          rec,
          rec.push({
            Plane: {
              spec: { Offset: { base, dist: num(opts.offset, "plane's offset") } },
            },
          }),
        );
      }
      return new PlaneVal(rec, rec.push({ Plane: { spec: { World: a.world } } }));
    }
    if (a instanceof PlaneVal) {
      const dist = opts?.offset;
      if (dist === undefined)
        fail("plane(p, { offset }) is the only form over a plane value");
      return new PlaneVal(
        rec,
        rec.push({
          Plane: {
            spec: { Offset: { base: a.id, dist: num(dist, "plane's offset") } },
          },
        }),
      );
    }
    // The same fork as `display`'s: only a literal can be a spec. An array or a pick
    // falls through to the sentence below, which names every form `plane` does take.
    if (isPlainObject(a)) {
      onlyKeys(a, ["origin", "xPoint", "yHint", "through"], "plane");
      const o = a as {
        origin?: unknown;
        xPoint?: unknown;
        yHint?: unknown;
        through?: unknown[];
      };
      if (o.through) {
        if (o.through.length !== 3)
          fail(
            `a through-plane takes exactly three vertices, got ${o.through.length} — ` +
              "filter() results need narrowing before they name a plane",
          );
        const refs = o.through.map((v) => {
          if (!(v instanceof VertexPick))
            fail("through takes vertex picks (from vertices())");
          return (v as VertexPick).ref;
        }) as [VertexRef, VertexRef, VertexRef];
        return new PlaneVal(
          rec,
          rec.push({ Plane: { spec: { Through: { vertices: refs } } } }),
        );
      }
      if (o.origin && o.xPoint && o.yHint)
        return new PlaneVal(
          rec,
          rec.push({
            Plane: {
              spec: {
                Points: {
                  origin: point3(o.origin, "plane's origin"),
                  x_point: point3(o.xPoint, "plane's xPoint"),
                  y_hint: point3(o.yHint, "plane's yHint"),
                },
              },
            },
          }),
        );
    }
    fail("plane() takes XY/YZ/ZX, a plane value, {origin,xPoint,yHint} or {through}");
    return new PlaneVal(rec, -1); // unreachable
  }

  const faceArg = (f: unknown, what: string) => {
    if (!(f instanceof FacePick))
      fail(`${what} takes a face pick (from faces())`);
    return (f as FacePick).ref;
  };

  const sketchArg = (s: unknown, what: string): number => {
    if (!(s instanceof SketchBuilder)) fail(`${what} takes a sketch`);
    return (s as SketchBuilder).use(what);
  };

  /** `cuboid({ size, center | corner })` — a box, centred on the origin unless anchored.
   *
   * **No positional form**, for the reason `cylinder` states one line down and one the
   * bare array makes worse: `[40, 20, 5]` never says *what* it is. The axis order inside
   * it is obvious; that it means a size and not a corner is not, and beside a
   * `cuboid({ corner, size })` two lines away a reader has to know rather than read. A
   * bare `cuboid()` is allowed — the unit box, unambiguous, and the twin of `cylinder()`. */
  function cuboid(arg?: { size?: unknown; center?: unknown; corner?: unknown }): SolidVal {
    if (Array.isArray(arg))
      fail("cuboid takes { size: [x, y, z] } — a bare array does not say what it is");
    onlyKeys(arg, ["size", "center", "corner"], "cuboid");
    // The neighbouring hole, with `{ size }` the only form: an object without it would
    // reach the wire and come back "malformed steps: missing field `size`" — the wire's
    // words for the user's mistake. `cuboid()` means the unit box; `cuboid({ ... })` has
    // to say a size.
    if (arg && arg.size === undefined)
      fail("cuboid takes { size: [x, y, z] } — say a size, or cuboid() for the unit box");
    let size: Vec3 = [1, 1, 1];
    let at: Anchor = { Center: [0, 0, 0] };
    if (arg) {
      // Three lengths, not a point — so the sentence does not call it one.
      size = point3(arg.size, "cuboid's size", "three numbers like [10, 20, 5]");
      if (arg.center && arg.corner)
        fail("cuboid takes center or corner, not both");
      if (arg.corner) at = { Corner: point3(arg.corner, "cuboid's corner") };
      else
        at = {
          Center: arg.center === undefined ? [0, 0, 0] : point3(arg.center, "cuboid's center"),
        };
    }
    return new SolidVal(rec, rec.push({ Cuboid: { size, at } }));
  }

  /** `cylinder({ r | d, h, axis, base | center })` — a round solid along one world axis.
   *
   * Sugar, in the kit, for a circle sketch extruded — the same solid a
   * `sketch(XY).circle({ center, r })` makes. Two numbers and no positional form,
   * because nobody can remember whether radius or height comes first.
   *
   * `d` is halved here, which f64 does exactly (a halving only decrements the
   * exponent), so `d: 5` and `r: 2.5` are the same statement.
   *
   * **`center` is the default, as it is for `cuboid`.** The two primitives anchor alike,
   * which is what makes the comment below — "a bare `cylinder()` … fits inside
   * `cuboid()`" — true: a base-anchored unit cylinder would span `z ∈ [0, 1]` while the
   * unit box spans `[−0.5, 0.5]`.
   *
   * **`axis` takes `X`, `Y` or `Z` and nothing else** — the field means *which world
   * axis*, and the type says only that.
   *
   * This does **not** stop a script from tilting a cylinder: `cylinder({ r, h })
   * .rotateX(30)` says one today, and the kernel refuses it at the first boolean
   * (measured: a 30° and a 45° drill cut from a plate both come back
   * `CylinderGateUndecided`; `ObliqueCylinderCut` is the neighbouring refusal, for a
   * tilt that meets a cut plane as an ellipse). What the narrow field buys is that there
   * is **one** way to say a tilt, so the refusal arrives where the user wrote it — not
   * from a field named `axis` that would quietly accept a direction. When the tilted-cylinder
   * milestone lands it is the kernel's gate that widens; this field follows.
   */
  function cylinder(arg?: {
    r?: number;
    d?: number;
    h?: number;
    axis?: Axis;
    base?: Vec3;
    center?: Vec3;
  }): SolidVal {
    const a = onlyKeys(arg, ["r", "d", "h", "axis", "base", "center"], "cylinder");
    if (a.r !== undefined && a.d !== undefined)
      fail("cylinder takes r or d, not both");
    // A bare `cylinder()` is the unit one — it fits inside `cuboid()`.
    const radius =
      a.d !== undefined
        ? positive(a.d, "cylinder's d") / 2
        : a.r !== undefined
          ? positive(a.r, "cylinder's r")
          : 0.5;
    const height = a.h !== undefined ? positive(a.h, "cylinder's h") : 1;
    if (a.base !== undefined && a.center !== undefined)
      fail("cylinder takes base or center, not both");
    const at: CylAnchor =
      a.base !== undefined
        ? { Base: point3(a.base, "cylinder's base") }
        : { Center: a.center !== undefined ? point3(a.center, "cylinder's center") : [0, 0, 0] };
    // The door itself, since nothing typechecks a script (see `Axis` above): a plain
    // `Dir` off a face and a hand-rolled `new Axis(1, 1, 0)` are both refused here.
    // Exact — the tokens' components are 0 and 1, so there is nothing for a tolerance
    // to decide.
    const axes: [KitAxis, Axis][] = [
      ["X", X],
      ["Y", Y],
      ["Z", Z],
    ];
    let axis: KitAxis = "Z";
    if (a.axis !== undefined) {
      const found = axes.find(
        ([, t]) =>
          a.axis instanceof Dir &&
          (a.axis as Dir).x === t.x &&
          (a.axis as Dir).y === t.y &&
          (a.axis as Dir).z === t.z,
      );
      axis = found ? found[0] : fail("cylinder's axis takes X, Y or Z");
    }
    return new SolidVal(rec, rec.push({ Cylinder: { radius, height, at, axis } }));
  }

  function extrude(s: unknown, dist: unknown): SolidVal {
    const sketch = sketchArg(s, "extrude");
    const d = distOf(dist, "extrude's distance");
    return new SolidVal(rec, rec.push({ Extrude: { sketch, dist: d } }));
  }

  /** `edges: false | true | "#rgb" | { color, opacity, width }` — the four spellings
   * of one idea, checked here so a typo is a script error and not a silent nothing. */
  const edgesOf = (raw: unknown, where: string): Edges | null => {
    if (raw === undefined) return null;
    if (raw === false) return "Off";
    if (raw === true) return { On: { color: null, opacity: null, width: null } };
    // The one colour that does not pass through `styleFields`: `edges` given a bare
    // colour rather than an object.
    if (typeof raw === "string")
      return { On: { color: colour(raw, `${where}'s edges`), opacity: null, width: null } };
    if (raw !== null && typeof raw === "object") {
      const o = onlyKeys(raw, APPEARANCE, `${where}'s edges`);
      return { On: styleFields(o, `${where}'s edges`) };
    }
    fail(`${where}: edges takes false, true, a colour, or { color, opacity, width }`);
    return null; // unreachable
  };

  /** Scene-wide defaults. Merges field by field, so several calls stack up, and it
   * says nothing about *what* is drawn — that stays `display`'s alone. */
  function style(spec: unknown): void {
    // `onlyKeys` lets `undefined` through as `{}` so an *optional* options argument can
    // be left out. This one is required — `style()` says nothing and would become a
    // silent no-op — so it arrives as `null`, which `onlyKeys` refuses in the one
    // sentence it already has for "that is not an options object".
    const o = onlyKeys(spec ?? null, [...APPEARANCE, "edges"], "style");
    const f = styleFields(o, "style's");
    if (f.color !== null) rec.sceneStyle.color = f.color;
    if (f.opacity !== null) rec.sceneStyle.opacity = f.opacity;
    if (f.width !== null) rec.sceneStyle.width = f.width;
    const edges = edgesOf(o.edges, "style");
    if (edges) rec.sceneStyle.edges = edges;
  }

  /** A finite number passing `ok`, or a script error in the words given. */
  const numberOf = (raw: unknown, ok: (n: number) => boolean, message: string): number => {
    if (typeof raw !== "number" || !Number.isFinite(raw) || !ok(raw)) fail(message);
    return raw as number;
  };

  /** A three-number vector, or a script error naming the field that was wrong. */
  const vec3Of = (raw: unknown, field: string): ViewVec3 => {
    if (
      !Array.isArray(raw) ||
      raw.length !== 3 ||
      raw.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      fail(`view: ${field} takes three numbers`);
    }
    return raw as ViewVec3;
  };

  /** Where the camera is, and through what lens. Merges field by field like `style`,
   * so several calls stack up and the last word on each field wins. */
  function view(spec: unknown): void {
    // Required, as `style`'s is — `?? null` so a missing argument gets the same sentence
    // as a wrong one rather than passing as an empty object.
    const o = onlyKeys(spec ?? null, ["from", "at", "zoom", "projection", "fov"], "view");
    if (o.projection !== undefined) {
      if (o.projection !== "ortho" && o.projection !== "perspective")
        fail('view: projection is "ortho" or "perspective"');
      rec.sceneView.projection = o.projection as Projection;
    }
    if (o.from !== undefined) {
      if (typeof o.from === "string") {
        if (!(VIEW_NAMES as readonly string[]).includes(o.from))
          fail(`view: from is a direction or one of ${VIEW_NAMES.join(", ")}`);
        rec.sceneView.from = o.from as ViewName;
      } else {
        const v = vec3Of(o.from, "from");
        if (Math.hypot(v[0], v[1], v[2]) === 0)
          fail("view: from is a direction, and [0, 0, 0] does not point anywhere");
        rec.sceneView.from = v;
      }
    }
    if (o.at !== undefined) rec.sceneView.at = vec3Of(o.at, "at");
    if (o.zoom !== undefined) {
      rec.sceneView.zoom = numberOf(
        o.zoom,
        (n) => n > 0,
        "view: zoom is a positive multiplier on the automatic framing",
      );
    }
    if (o.fov !== undefined) {
      const fov = numberOf(
        o.fov,
        (n) => n > 0 && n < 180,
        "view: fov is an angle in degrees, between 0 and 180",
      );
      // A parallel projection has no field of view at all, so a script that asks for
      // one has said two things that cannot both be true. Naming the fix beats
      // silently picking one of them.
      if ((rec.sceneView.projection ?? "ortho") === "ortho")
        fail('view: fov belongs to a perspective view — say projection: "perspective"');
      rec.sceneView.fov = fov;
    }
  }

  function display(...args: unknown[]): void {
    let style: Style | null = null;
    const last = args[args.length - 1];
    // A trailing object *literal* is a style; anything else is something to show.
    if (args.length > 1 && isPlainObject(last)) {
      const o = onlyKeys(last, [...APPEARANCE, "edges"], "display");
      style = { ...styleFields(o, "display's"), edges: edgesOf(o.edges, "display") };
      args = args.slice(0, -1);
    }
    rec.push({
      Display: { targets: args.map(shownArg), style },
    });
  }

  return {
    XY,
    YZ,
    ZX,
    X,
    Y,
    Z,
    plane,
    pad: (f: unknown, s: unknown, dist: unknown) =>
      new SolidVal(
        rec,
        rec.push({
          Pad: {
            face: faceArg(f, "pad"),
            sketch: sketchArg(s, "pad"),
            dist: num(dist, "pad's depth"),
          },
        }),
      ),
    pocket: (f: unknown, s: unknown, dist: unknown) =>
      new SolidVal(
        rec,
        rec.push({
          Pocket: {
            face: faceArg(f, "pocket"),
            sketch: sketchArg(s, "pocket"),
            dist: num(dist, "pocket's depth"),
          },
        }),
      ),
    cuboid,
    cylinder,
    fuse: (...args: unknown[]) => boolean("Fuse", "fuse", args),
    cut: (...args: unknown[]) => boolean("Cut", "cut", args),
    common: (...args: unknown[]) => boolean("Common", "common", args),
    translate: (s: unknown, offset: unknown) =>
      new SolidVal(
        rec,
        rec.push({
          Translate: {
            src: solidArg(s, "translate"),
            offset: point3(offset, "translate's offset"),
          },
        }),
      ),
    rotateX: (s: unknown, deg: unknown, opts?: RotateOpts) =>
      new SolidVal(rec, solidRotate(rec, s, "X", deg, opts)),
    rotateY: (s: unknown, deg: unknown, opts?: RotateOpts) =>
      new SolidVal(rec, solidRotate(rec, s, "Y", deg, opts)),
    rotateZ: (s: unknown, deg: unknown, opts?: RotateOpts) =>
      new SolidVal(rec, solidRotate(rec, s, "Z", deg, opts)),
    mirror: (s: unknown, plane: PlaneToken, opts?: { offset?: unknown }) =>
      new SolidVal(
        rec,
        rec.push({
          Mirror: {
            src: solidArg(s, "mirror"),
            plane: mirrorPlaneOf(plane, opts, "mirror"),
          },
        }),
      ),
    copy: (s: unknown) =>
      new SolidVal(rec, rec.push({ Copy: { src: solidArg(s, "copy") } })),
    /** `sketch(plane)` — a sketch to draw on with the pen. The plane is the only argument,
     * so a second one (a loose-segment list, `sketch(plane, [line(…), arc(…)])`) is named
     * rather than ignored. */
    sketch: (p: unknown, ...rest: unknown[]) => {
      // The plane is the first argument, so it is the first thing answered for — with
      // both wrong, a reader should hear about the one they wrote first.
      const on = planeRefOf(p);
      if (rest.length > 0)
        fail(
          "sketch takes the plane alone — draw with the pen: sketch(XY).moveTo(…).lineTo(…).close()",
        );
      return new SketchBuilder(rec, on);
    },
    extrude,
    display,
    style,
    view,
    /** Say something in words. It also shadows the browser's own `window.print()` —
     * a script calling `print("…")` and getting a print dialog would be a bad joke. */
    print: (...args: unknown[]) => rec.print(printLine(args)),
  };

  function solidRotate(
    rec2: Recorder,
    s: unknown,
    axis: KitAxis,
    deg: unknown,
    opts?: RotateOpts,
  ): number {
    return rec2.push({
      Rotate: {
        src: solidArg(s, `rotate${axis}`),
        axis,
        deg: num(deg, `rotate${axis}'s angle`),
        pivot: pivotOf(opts, `rotate${axis}`),
      },
    });
  }
}
