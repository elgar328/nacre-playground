// The grid's one rule: how big a cell is at a given camera distance.
//
// Everything else about the grid is pixels, judged by eye. This is the part that can
// be quietly wrong — and its real proposition is **scale invariance**: ten times the
// distance must give ten times the spacing with the same blend, which is what makes
// zooming show the same picture at every scale and decade boundaries pass unnoticed.

import { describe, expect, it } from "vitest";
import { BASE, gridLevels } from "../src/app/grid";
import { viewSpan } from "../src/app/frame";

describe("gridLevels", () => {
  // The argument is the view span, not the camera's distance, which stands in for it only
  // under a perspective lens. The constants are expressed as the conversion rather than as
  // rounded numbers, so under perspective the span rule draws what the distance rule draws
  // *by construction*, and this test can say so at 1e-12 instead of "close enough".
  it("under perspective, sizing by span draws what sizing by distance draws", () => {
    const old = (distance: number) => {
      const d = Math.max(distance, 1e-6) / 12; // the rule stated on distance
      const decade = Math.floor(Math.log10(d));
      const minor = Math.pow(10, decade);
      return { minor, major: minor * 10, blend: Math.log10(d) - decade };
    };
    for (const distance of [0.7, 3, 12, 45, 380]) {
      const span = viewSpan({ ortho: false, distance, fovDeg: 50, halfHeight: 1, zoom: 1 });
      const now = gridLevels(span);
      const then = old(distance);
      expect(now.minor).toBe(then.minor);
      expect(now.major).toBe(then.major);
      expect(now.blend).toBeCloseTo(then.blend, 12); // one ulp of a division apart
    }
  });

  it("is scale invariant: ten times out, ten times the cell, same blend", () => {
    for (const d of [0.7, 3, 12, 45, 380]) {
      const a = gridLevels(d);
      const b = gridLevels(d * 10);
      expect(b.minor).toBeCloseTo(a.minor * 10, 9);
      expect(b.major).toBeCloseTo(a.major * 10, 9);
      expect(b.blend).toBeCloseTo(a.blend, 9);
    }
  });

  it("major is always ten minor cells, and both are powers of ten", () => {
    for (const d of [0.05, 1, 9.9, 10.1, 1000]) {
      const { minor, major } = gridLevels(d);
      expect(major).toBeCloseTo(minor * 10, 9);
      const decades = Math.log10(minor);
      expect(decades).toBeCloseTo(Math.round(decades), 9);
    }
  });

  it("blend runs 0 → 1 across a decade and wraps without a gap", () => {
    const base = BASE;
    const start = gridLevels(base * 1.0001);
    const end = gridLevels(base * 9.9999);
    expect(start.blend).toBeGreaterThanOrEqual(0);
    expect(start.blend).toBeLessThan(0.01);
    expect(end.blend).toBeGreaterThan(0.99);
    expect(end.blend).toBeLessThanOrEqual(1);
    // Crossing the boundary: the blend restarts and the cell steps up by exactly the
    // amount the blend was fading it towards — no jump on screen.
    const after = gridLevels(base * 10.0001);
    expect(after.blend).toBeLessThan(0.01);
    expect(after.minor).toBeCloseTo(end.major, 9);
  });

  it("survives a camera on top of its target", () => {
    const { minor, major, blend } = gridLevels(0);
    expect(Number.isFinite(minor)).toBe(true);
    expect(Number.isFinite(major)).toBe(true);
    expect(blend).toBeGreaterThanOrEqual(0);
    expect(blend).toBeLessThanOrEqual(1);
  });
});
