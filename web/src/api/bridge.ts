// The typed door to the wasm boundary. Contract (mirrored from wasm/src/lib.rs):
// queries answer about the **last successful run** — this module is the only caller,
// and it is single-threaded, so the ordering is guaranteed by construction.

import init, * as wasm from "../wasm/pkg/nacre_playground_wasm.js";
import type { Step } from "./steps";

export interface Report {
  merges: number;
  coincidences: number;
  closestCalls: string[];
}

export interface RunOk {
  ok: true;
  rendered: number[];
  autoCopies: number[];
  reports: (Report | null)[];
  values: ("solid" | "sketch" | "plane" | null)[];
}

/** Which script values the kernel would not combine, when that is what went wrong.
 * Absent for a malformed program, which blames no pair.
 *
 * **`a` and `b` can be the same value.** `fuse(a, a)` comes back `between value 0 and
 * value 0` — the pair is a pair of *positions*, not necessarily of distinct values, so a
 * reader counting things to highlight gets one, and words written around it have to
 * agree (`showingWords`). Measured. */
export interface Blame {
  a: number;
  b: number;
  /** Which piece of each — `body k`, or `intermediate k` for a piece a fold made. */
  detail: string;
}

/** Where the kernel was looking when it refused — a witness location the viewport can
 * mark. `coords` holds one point for `"point"`, two for `"segment"`. */
export interface Mark {
  kind: "point" | "segment";
  coords: [number, number, number][];
}

export interface RunErr {
  ok: false;
  /** Which step refused, when one did.
   *
   * **`undefined`, not `null`.** `serde-wasm-bindgen` writes `Option::None` as
   * `undefined`, and the field is always present — measured. Declaring it `number | null`
   * read as a promise the wire does not make, and it hid a dead branch: `main.ts` asked
   * `out.step === null`, which could never be true. */
  step: number | undefined;
  message: string;
  blame?: Blame;
  mark?: Mark;
}

export interface VertexRow {
  vertex: number;
  at: [number, number, number];
}

export interface FaceRow {
  face: number;
  normal: [number, number, number] | null;
  center: [number, number, number];
  area: number;
}

export interface MeshOk {
  ok: true;
  positions: Float32Array;
  normals: Float32Array;
}

export interface EdgesOk {
  ok: true;
  positions: Float32Array;
}

export async function initWasm(): Promise<void> {
  await init();
}

export function run(steps: Step[], upto?: number): RunOk | RunErr {
  return wasm.run(steps, upto) as RunOk | RunErr;
}

export function verticesOf(id: number): VertexRow[] | null {
  return wasm.vertices_of(id) as VertexRow[] | null;
}

/** One vertex's coordinate, realized to `places` decimal places — `null` when the value is not a
 * solid, the index names no vertex of it, or the kernel declines to realize that vertex.
 *
 * The one query that does not read the report cache: the kernel realizes from the vertex's
 * definition and rounds once, so digits past f64's seventeen mean something. */
export function vertexDecimal(
  id: number,
  vertex: number,
  places: number,
): [string, string, string] | null {
  return wasm.vertex_decimal(id, vertex, places) as [string, string, string] | null;
}

/** How many bodies a solid value has — `null` when it is not a solid. */
export function bodiesOf(id: number): number | null {
  return wasm.bodies_of(id) as number | null;
}

export function facesOf(id: number): FaceRow[] | null {
  return wasm.faces_of(id) as FaceRow[] | null;
}

export function meshOf(id: number): MeshOk | RunErr | null {
  return wasm.mesh_of(id) as MeshOk | RunErr | null;
}

export function edgesOf(id: number): EdgesOk | RunErr | null {
  return wasm.edges_of(id) as EdgesOk | RunErr | null;
}

export function sketchOf(id: number): EdgesOk | null {
  return wasm.sketch_of(id) as EdgesOk | null;
}
