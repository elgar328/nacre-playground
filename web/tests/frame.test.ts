// The framing arithmetic, locked. This calculation can go wrong silently (a distance
// from the model's size alone clips the demo plate on a wide window), and a sheet that
// reshapes the viewport makes every aspect routine.

import { describe, expect, it } from "vitest";
import { fitDistance, fitHalfHeight, viewSpan } from "../src/app/frame";

const FOV = 50;

describe("fitDistance", () => {
  it("at aspect 1 the two fields agree — the sphere just fits", () => {
    const d = fitDistance(1, FOV, 1, 1);
    // The half-angle subtended by the sphere is exactly the half field.
    expect(Math.asin(1 / d)).toBeCloseTo((FOV * Math.PI) / 360, 10);
  });

  it("a wide canvas is limited by its height, a tall one by its width", () => {
    const wide = fitDistance(1, FOV, 4, 1);
    const square = fitDistance(1, FOV, 1, 1);
    const tall = fitDistance(1, FOV, 0.25, 1);
    expect(wide).toBeCloseTo(square, 10); // vertical field decides both
    expect(tall).toBeGreaterThan(square); // the narrow width pushes the camera back
  });

  it("the further from square, the further back — monotone in both directions", () => {
    const at = (a: number) => fitDistance(1, FOV, a, 1);
    expect(at(0.2)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.9));
    expect(at(0.9)).toBeGreaterThan(at(1) - 1e-12);
  });

  it("scales with the model and honours the margin", () => {
    expect(fitDistance(3, FOV, 1, 1)).toBeCloseTo(3 * fitDistance(1, FOV, 1, 1), 10);
    expect(fitDistance(1, FOV, 1, 1.15)).toBeCloseTo(
      1.15 * fitDistance(1, FOV, 1, 1),
      10,
    );
  });

  it("survives a degenerate canvas instead of returning infinity", () => {
    expect(Number.isFinite(fitDistance(1, FOV, 0))).toBe(true);
  });
});

// The quantity the grid and the depth range are sized from. The whole reason it
// exists is that "how far the camera stands" answers it under one lens and says
// nothing under the other.
describe("viewSpan", () => {
  const persp = (distance: number, zoom = 1) =>
    viewSpan({ ortho: false, distance, fovDeg: FOV, halfHeight: 1, zoom });
  const ortho = (distance: number, zoom = 1, halfHeight = 5) =>
    viewSpan({ ortho: true, distance, fovDeg: FOV, halfHeight, zoom });

  it("perspective: proportional to the distance, and zoom is not part of it", () => {
    expect(persp(20)).toBeCloseTo(2 * persp(10), 12);
    expect(persp(10, 4)).toBe(persp(10)); // three dollies a perspective camera instead
  });

  it("ortho: inversely proportional to zoom — and the distance does not appear", () => {
    expect(ortho(10, 2)).toBeCloseTo(ortho(10, 1) / 2, 12);
    // The negative control, and the bug this function exists to prevent: dollying an
    // orthographic camera changes nothing about what you see, so a grid sized from
    // distance would have frozen at one cell size however far you zoomed in.
    expect(ortho(1000)).toBe(ortho(0.1));
  });

  it("the two lenses agree about what the span means", () => {
    // A sphere framed by each lens spans about the same amount of world: the ortho
    // frustum is the half-height it was fitted to, the perspective one is what its
    // field subtends at the distance it was sent to.
    const aspect = 1.6;
    const half = fitHalfHeight(1, aspect);
    const d = fitDistance(1, FOV, aspect);
    expect(ortho(d, 1, half) / persp(d)).toBeGreaterThan(0.8);
    expect(ortho(d, 1, half) / persp(d)).toBeLessThan(1.2);
  });
});

describe("fitHalfHeight", () => {
  const fits = (radius: number, aspect: number) => {
    const half = fitHalfHeight(radius, aspect, 1);
    return { vertical: half >= radius, horizontal: half * aspect >= radius - 1e-12 };
  };

  it("contains the sphere both ways, whatever shape the canvas is", () => {
    for (const aspect of [1, 2, 0.5, 4, 0.25]) {
      expect(fits(3, aspect)).toEqual({ vertical: true, horizontal: true });
    }
  });

  it("a tall narrow canvas needs a bigger frustum than a square one", () => {
    // The proof that the shape of the canvas is really being read: a wide canvas is
    // limited by its height and asks for nothing extra, a narrow one is limited by its
    // width and must grow.
    expect(fitHalfHeight(1, 4, 1)).toBeCloseTo(fitHalfHeight(1, 1, 1), 12);
    expect(fitHalfHeight(1, 0.25, 1)).toBeCloseTo(4 * fitHalfHeight(1, 1, 1), 12);
  });

  it("scales with the model, honours the margin, and survives a zero canvas", () => {
    expect(fitHalfHeight(3, 1, 1.15)).toBeCloseTo(3 * 1.15, 12);
    expect(Number.isFinite(fitHalfHeight(1, 0))).toBe(true);
  });
});
