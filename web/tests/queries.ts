// The wasm doors the tests hand to the app's own modules — one copy of each.
//
// The selectors need a way to build the steps so far and read the result back
// (`Recorder.ensureBuilt`); the app injects the browser bridge, the tests inject the
// nodejs-target wasm. One door here, so a new query is a single edit rather than one
// per test file, copies that would only ever agree by hand.

// @ts-ignore — CJS entry
import * as wasm from "../src/wasm/pkg-node/nacre_playground_wasm.js";
import type { Queries } from "../src/api/recorder";
import type { DrawQueries } from "../src/app/draw";

export const queries: Queries = {
  run: (steps) => wasm.run(steps, undefined),
  bodiesOf: (id) => wasm.bodies_of(id),
  verticesOf: (id) => wasm.vertices_of(id),
  vertexDecimal: (id, vertex, places) => wasm.vertex_decimal(id, vertex, places),
  facesOf: (id) => wasm.faces_of(id),
};

/** The drawing pass's own door — `app/draw.ts` turns values into meshes and counts what
 * reached the screen, and it asks these four. Injected for the same reason as above:
 * `api/bridge.ts` is bound to the browser build, and this suite is not. */
export const drawQueries: DrawQueries = {
  meshOf: (id) => wasm.mesh_of(id),
  edgesOf: (id) => wasm.edges_of(id),
  sketchOf: (id) => wasm.sketch_of(id),
  bodiesOf: (id) => wasm.bodies_of(id),
};
