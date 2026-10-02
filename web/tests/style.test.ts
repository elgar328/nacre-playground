// How three layers of styling settle into one answer.
//
// The layers are a ranking, not a sequence: the viewer's defaults, then the scene's
// `style(...)`, then the last `display(...)` naming the value. The part worth pinning
// is what happens where they overlap.

import { describe, expect, it } from "vitest";
import { resolveStyle } from "../src/app/runtime";
import type { SceneStyle } from "../src/api/recorder";
import type { Step } from "../src/api/steps";

const display = (targets: number[], style: Step extends never ? never : unknown): Step =>
  ({ Display: { targets, style } }) as Step;

describe("resolveStyle", () => {
  it("says nothing when nothing was said — edges are on by default", () => {
    const s = resolveStyle({}, [], 0);
    expect(s.color).toBeUndefined();
    expect(s.opacity).toBeUndefined();
    expect(s.edges).toEqual({
      color: undefined,
      opacity: undefined,
      width: undefined,
    });
  });

  it("a display overrides the scene", () => {
    const scene: SceneStyle = { color: "#111111" };
    const steps = [display([0], { color: "#222222", opacity: null, edges: null })];
    expect(resolveStyle(scene, steps, 0).color).toBe("#222222");
    // …and leaves values it did not name alone.
    expect(resolveStyle(scene, steps, 1).color).toBe("#111111");
  });

  it("edge settings merge field by field across the layers", () => {
    const scene: SceneStyle = {
      edges: { On: { color: "#ff0000", opacity: null, width: 3 } },
    };
    const steps = [
      display([0], {
        color: null,
        opacity: null,
        edges: { On: { color: null, opacity: 0.5, width: null } },
      }),
    ];
    // The scene's colour and width survive; the display adds an opacity.
    expect(resolveStyle(scene, steps, 0).edges).toEqual({
      color: "#ff0000",
      opacity: 0.5,
      width: 3,
    });
  });

  it("false does not merge — it replaces whatever was underneath", () => {
    const scene: SceneStyle = {
      edges: { On: { color: "#ff0000", opacity: null, width: 3 } },
    };
    const off = [display([0], { color: null, opacity: null, edges: "Off" })];
    expect(resolveStyle(scene, off, 0).edges).toBe(false);

    // And a display can bring them back over a scene that turned them off.
    const noScene: SceneStyle = { edges: "Off" };
    const on = [
      display([0], {
        color: null,
        opacity: null,
        edges: { On: { color: null, opacity: null, width: 2 } },
      }),
    ];
    expect(resolveStyle(noScene, on, 0).edges).toEqual({
      color: undefined,
      opacity: undefined,
      width: 2,
    });
  });

  it("the last display naming a value wins", () => {
    const steps = [
      display([0], { color: "#111111", opacity: null, edges: null }),
      display([0], { color: "#333333", opacity: null, edges: null }),
    ];
    expect(resolveStyle({}, steps, 0).color).toBe("#333333");
  });
});
