// Where you are looking from.
//
// Two of these tests are about a freedom the API deliberately does not expose. `from`
// and `at` fix where the camera stands and what it points at, which is five numbers of
// the six a camera has; the sixth — the roll about the line of sight — is settled by a
// convention instead. A convention that is only *described* is the kind that quietly
// stops being true, so it is measured here, through the same call the viewer makes.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Recorder, ScriptError, makeApi } from "../src/api/recorder";
import {
  DEFAULT_VIEW,
  anglesFor,
  cameraShouldMove,
  directionFor,
  resolveView,
} from "../src/api/view";
import type { SceneView, Vec3, ViewName } from "../src/api/view";

/** Put a camera where `from` says, aim it, and report what the screen's axes became.
 *
 * `lookAt` is not a stand-in for the viewer's behaviour — it is literally the call
 * `OrbitControls.update()` ends with, so the roll measured here is the roll drawn. */
function screenAxes(from: ViewName | [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(...directionFor(from)).multiplyScalar(10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  // `|| 0` folds negative zero in with zero: it is the same direction, and the only
  // thing it would ever distinguish here is which way a rounding error fell.
  const round = (v: THREE.Vector3) =>
    v.toArray().map((n) => Math.round(n * 1000) / 1000 || 0) as [number, number, number];
  return {
    up: round(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)),
    right: round(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)),
  };
}

describe("the roll convention", () => {
  it("the side views need no convention — world up is screen up", () => {
    for (const name of ["front", "back", "left", "right"] as const) {
      expect(screenAxes(name).up).toEqual([0, 0, 1]);
    }
    // And they face the way their names say.
    expect(screenAxes("front").right).toEqual([1, 0, 0]); // looking along +Y
    expect(screenAxes("right").right).toEqual([0, 1, 0]); // looking along −X
  });

  it("top and bottom have to choose one, and it is the drafting one", () => {
    // Straight down: +X to the right and +Y up, the way a plan view is drawn.
    expect(screenAxes("top")).toEqual({ up: [0, 1, 0.001], right: [1, 0, 0] });
    // From below, the part reads as flipped about that same +X axis.
    expect(screenAxes("bottom")).toEqual({ up: [0, -1, 0.001], right: [1, 0, 0] });
  });

  it("a direction at the pole lands exactly where the name does", () => {
    // Two spellings, one rule — otherwise `from: [0,0,1]` would take whatever roll the
    // degenerate construction happened to produce.
    expect(anglesFor([0, 0, 1])).toEqual(anglesFor("top"));
    expect(anglesFor([0, 0, -4])).toEqual(anglesFor("bottom"));
    expect(screenAxes([0, 0, 1]).up).toEqual([0, 1, 0.001]);
  });

  it("iso really is isometric — the three axes meet the screen equally", () => {
    const d = directionFor("iso");
    expect(Math.abs(d[0])).toBeCloseTo(Math.abs(d[1]), 9);
    expect(Math.abs(d[1])).toBeCloseTo(Math.abs(d[2]), 9);
    expect(Math.hypot(...d)).toBeCloseTo(1, 12);
  });
});

describe("cameraShouldMove", () => {
  // Built through `resolveView`, so every spec here is one a script could actually
  // produce — a hand-written `said` could describe a state the recorder never makes,
  // and a test of an impossible state proves nothing about the real one.
  const frame = (scene: SceneView, bounds: string) => ({
    spec: resolveView(scene),
    bounds,
  });

  it("the first run has nowhere to keep, so it takes the script's word", () => {
    expect(cameraShouldMove(null, frame({}, "a"))).toEqual({
      move: true,
      useSpecDirection: true,
    });
  });

  it("a script with no opinion leaves the camera alone", () => {
    // The case this half of the rule exists for: orbit somewhere, change a colour,
    // press Run. Nothing in the script asked for a camera, so nothing takes it back.
    expect(cameraShouldMove(frame({}, "a"), frame({}, "a"))).toEqual({
      move: false,
      useSpecDirection: false,
    });
  });

  it("a stated view is an instruction, and Run obeys it every time", () => {
    // An instruction you can only obey once is not one. Orbit away from a stated front
    // view, press Run, and you are back at the front — nothing about the script
    // changed, and that is exactly why it still applies.
    const stated = { from: "front" as const };
    expect(cameraShouldMove(frame(stated, "a"), frame(stated, "a"))).toEqual({
      move: true,
      useSpecDirection: true,
    });
  });

  it("field by field: saying only `zoom` re-frames without turning the model", () => {
    for (const scene of [{ zoom: 1.5 }, { at: [1, 2, 3] as Vec3 }] as SceneView[]) {
      expect(cameraShouldMove(frame(scene, "a"), frame(scene, "a"))).toEqual({
        move: true,
        useSpecDirection: false,
      });
    }
  });

  it("a model of a different size is re-framed — from where you were looking", () => {
    expect(cameraShouldMove(frame({}, "a"), frame({}, "b"))).toEqual({
      move: true,
      useSpecDirection: false,
    });
  });

  it("deleting the view line does not move anything — nothing is asking to", () => {
    // The one case a spec-diff would decide differently (it would swing the camera back
    // to the default angle). The principle answers it without a diff: an
    // absent instruction is not an instruction to go home.
    expect(cameraShouldMove(frame({ from: "top" }, "a"), frame({}, "a"))).toEqual({
      move: false,
      useSpecDirection: false,
    });
  });
});

describe("view()", () => {
  const record = (fn: (api: ReturnType<typeof makeApi>) => void) => {
    const rec = new Recorder();
    fn(makeApi(rec));
    return rec;
  };
  const refuses = (fn: (api: ReturnType<typeof makeApi>) => void) => {
    let message = "";
    try {
      record(fn);
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      message = e.message;
    }
    expect(message).not.toBe("");
    return message;
  };

  it("is not a step — it says nothing about what the model is", () => {
    const rec = record((v) => v.view({ from: "top" }));
    expect(rec.steps).toEqual([]);
    expect(rec.sceneView.from).toBe("top");
  });

  it("merges field by field, and the last word on each field wins", () => {
    const rec = record((api) => {
      api.view({ from: "top", zoom: 2 });
      api.view({ zoom: 3, projection: "perspective" });
    });
    expect(resolveView(rec.sceneView)).toEqual({
      from: "top",
      at: null,
      zoom: 3,
      projection: "perspective",
      fov: 50,
      said: { any: true, from: true },
    });
  });

  it("defaults to a parallel projection from an isometric angle", () => {
    expect(resolveView({})).toEqual(DEFAULT_VIEW);
    expect(DEFAULT_VIEW.projection).toBe("ortho");
    // And an untouched scene has said nothing — the flag that decides whether the
    // camera is the script's or the mouse's.
    expect(resolveView({}).said).toEqual({ any: false, from: false });
    expect(resolveView({ zoom: 2 }).said).toEqual({ any: true, from: false });
  });

  it("refuses what it cannot mean, and names the fix", () => {
    expect(refuses((v) => v.view({ from: "topp" }))).toContain("iso");
    expect(refuses((v) => v.view({ from: [0, 0, 0] }))).toContain("does not point");
    expect(refuses((v) => v.view({ from: [1, 2] }))).toContain("three numbers");
    expect(refuses((v) => v.view({ zoom: 0 }))).toContain("positive");
    expect(refuses((v) => v.view({ projection: "flat" }))).toContain("perspective");
    expect(refuses((v) => v.view("front"))).toContain("object");
    // A parallel view has no field of view at all — the message says which word to add.
    expect(refuses((v) => v.view({ fov: 35 }))).toContain('projection: "perspective"');
  });

  it("…and accepts a field of view once the projection can have one", () => {
    const rec = record((v) => v.view({ projection: "perspective", fov: 35 }));
    expect(rec.sceneView.fov).toBe(35);
    // Said in either order, across calls, it is the same statement.
    const split = record((api) => {
      api.view({ projection: "perspective" });
      api.view({ fov: 35 });
    });
    expect(split.sceneView.fov).toBe(35);
  });
});
