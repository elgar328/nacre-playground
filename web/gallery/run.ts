// One example script, run the way the app runs it: the script runtime records the steps,
// the kit's nodejs wasm build builds them, and the app's own `collect` turns the result
// into the drawables the viewport would show.

// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import { executeScript } from "../src/app/runtime";
import { collect } from "../src/app/draw";
import type { DrawQueries } from "../src/app/draw";
import type { Queries } from "../src/api/recorder";
import type { RunErr, RunOk } from "../src/api/bridge";
import type { Drawable } from "../src/app/viewport";
import { resolveView } from "../src/api/view";
import type { ViewSpec } from "../src/api/view";

const queries: Queries = {
  run: (steps) => wasm.run(steps, undefined),
  bodiesOf: (id) => wasm.bodies_of(id),
  verticesOf: (id) => wasm.vertices_of(id),
  vertexDecimal: (id, vertex, places) => wasm.vertex_decimal(id, vertex, places),
  facesOf: (id) => wasm.faces_of(id),
};
const draw: DrawQueries = {
  meshOf: (id) => wasm.mesh_of(id),
  edgesOf: (id) => wasm.edges_of(id),
  sketchOf: (id) => wasm.sketch_of(id),
  bodiesOf: (id) => wasm.bodies_of(id),
};

export type Scene = { ok: true; meshes: Drawable[]; view: ViewSpec } | { ok: false; message: string };

export function sceneOf(code: string): Scene {
  const script = executeScript(code, queries);
  if (!script.ok) return { ok: false, message: script.message };
  const out = wasm.run(script.steps, undefined) as RunOk | RunErr;
  if (!out.ok) return { ok: false, message: out.message };
  const drawn = collect(draw, out, out.rendered, script.sceneStyle, script.steps);
  if ("error" in drawn) return { ok: false, message: drawn.error };
  return { ok: true, meshes: drawn.meshes, view: resolveView(script.sceneView) };
}
