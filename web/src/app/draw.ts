// A built run's values → things to look at. The counting of what reached the screen
// happens here too, because it is the same walk.
//
// **Why this is not in `main.ts`.** Nothing about it needs a document: it asks the wasm
// boundary four questions and returns plain data. What would keep it out of reach of a
// test there is the *door* — `api/bridge.ts` hard-imports the **browser** wasm build, so
// anything importing it cannot be loaded by the node-target suite. `Recorder` has the same
// problem and solves it by taking its queries injected ("the web bridge in the app, the
// nodejs-target pkg in tests, so the runtime is lockable in both"); this is that, again.

import type { EdgesOk, MeshOk, RunErr } from "../api/bridge";
import type { SceneStyle } from "../api/recorder";
import type { Step } from "../api/steps";
import type { Drawable } from "./viewport";
import type { RunFacts } from "./summary";
import { resolveStyle } from "./runtime";

/** The wasm boundary, as much of it as drawing needs. Injected, so this module never
 * names a build: the app hands over `api/bridge`'s functions, a test hands over the
 * nodejs-target pkg's. */
export interface DrawQueries {
  meshOf(id: number): MeshOk | RunErr | null;
  edgesOf(id: number): EdgesOk | RunErr | null;
  sketchOf(id: number): EdgesOk | null;
  /** How many bodies a solid value has — `null` when it is not a solid. */
  bodiesOf(id: number): number | null;
}

/** What a body the kernel refused is drawn in — the value **and** the word for it, so the
 * status line can name the colour the viewport is using without the two drifting apart. */
export const BLAME = { color: "#e06c75", word: "red", floor: 0.85 };

/** Turn a built run's drawable values into meshes. Shared by the success path and by the
 * failure paths — showing what a failed run *did* build is the whole point, and a second
 * copy of this loop is how the two would drift apart. Returns the message when a mesh
 * cannot be had, since only the caller knows what to say around it.
 *
 * A blamed body is the **app** pointing, not the scene, so it owns that body's colour —
 * and a floor on its opacity, because a scene set to `{opacity: 0.05}` would dim the
 * app's own message into nothing. It never sets opacity outright: that channel is the
 * author's. Everything else keeps their scene exactly, minus what never got built. */
export function collect(
  q: DrawQueries,
  built: { rendered: number[]; values: (string | null)[] },
  ids: number[],
  sceneStyle: SceneStyle,
  steps: Step[],
  blamed?: Set<number>,
): { meshes: Drawable[]; drawn: RunFacts["drawn"] } | { error: string } {
  const meshes: Drawable[] = [];
  // Counted here, not from `ids`: a value can be in the render list and still produce
  // no mesh, and the two arms below skip it in silence. What the panel says is drawn has
  // to be what went on screen.
  const drawn = { bodies: 0, sketches: 0 };
  for (const id of ids) {
    const base = resolveStyle(sceneStyle, steps, id);
    const style = blamed?.has(id)
      ? { ...base, color: BLAME.color, opacity: Math.max(base.opacity ?? 1, BLAME.floor) }
      : base;
    if (built.values[id] === "sketch") {
      // A sketch is all line: its own colour and width describe those lines.
      const lines = q.sketchOf(id);
      if (lines) {
        meshes.push({ lines: lines.positions, style });
        drawn.sketches++;
      }
      continue;
    }
    const mesh = q.meshOf(id);
    if (mesh && "positions" in mesh) {
      const edges = style.edges === false ? null : q.edgesOf(id);
      meshes.push({
        data: mesh,
        edges: edges && "positions" in edges ? edges.positions : undefined,
        style,
      });
      // **Bodies, not values.** One `Solid` value holds zero or more disjoint bodies,
      // so `fuse` of two cubes meeting along an edge is one value and two bodies — and an
      // empty `common` is one value and none, which meshes to a mesh of no triangles.
      // Counting values called the first `1 solid` and the second `1 solid` too.
      // `bodiesOf` answers `null` only for what is not a solid, and nothing that is not
      // a solid reaches this arm (a sketch takes the arm above; a plane is never
      // rendered). The floor is there so an unmeasured answer under-reports rather than
      // vanishes — if it ever runs, the screen has something this cannot name.
      drawn.bodies += q.bodiesOf(id) ?? 1;
    } else if (mesh && "message" in mesh) {
      return { error: mesh.message };
    }
  }
  return { meshes, drawn };
}
