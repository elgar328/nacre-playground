// Who wins when two things are at the same depth.
//
// The picture itself can only be judged by eye, but the way it goes wrong can be
// measured: if model edges and sketch lines are both created with no depth bias at all,
// their tie has no winner and the answer changes from pixel to pixel. That is a fact
// about the materials, and materials can be built without a GPU.
//
// Note what these check: not the arithmetic, the **materials**. A test of
// `layerBias` alone would pass while the viewport went on constructing its lines
// without it — which is precisely the bug this guards against.

import { describe, expect, it } from "vitest";
import { LAYER, layerBias, layeredLine, layeredMesh } from "../src/app/layers";

const ORDER = ["faces", "grid", "edges", "sketch"] as const;

describe("the layer rule reaches the materials", () => {
  it("a line built for a layer carries that layer's bias", () => {
    const sketch = layeredLine(LAYER.sketch, { color: 0xffffff, linewidth: 1.5 });
    expect(sketch.polygonOffset).toBe(true);
    expect(sketch.polygonOffsetUnits).toBe(layerBias(LAYER.sketch).polygonOffsetUnits);
    // …and the caller's own settings survive being merged with it.
    expect(sketch.linewidth).toBe(1.5);
  });

  it("so does a surface, and the two do not end up equal", () => {
    const faces = layeredMesh(LAYER.faces, { color: 0x7fb2c8 });
    const edges = layeredLine(LAYER.edges, { color: 0x222222 });
    expect(faces.polygonOffset).toBe(true);
    // The failure this guards against: two things drawn at one depth with one bias
    // between them. Every tie has a winner.
    expect(edges.polygonOffsetUnits).not.toBe(faces.polygonOffsetUnits);
  });
});

describe("the ordering", () => {
  it("each layer stands in front of the one below, strictly", () => {
    for (let i = 1; i < ORDER.length; i++) {
      const above = layerBias(LAYER[ORDER[i]]);
      const below = layerBias(LAYER[ORDER[i - 1]]);
      // Negative is toward the camera.
      expect(above.polygonOffsetUnits).toBeLessThan(below.polygonOffsetUnits);
      expect(above.polygonOffsetFactor).toBeLessThan(below.polygonOffsetFactor);
    }
  });

  it("the table says what it means to say", () => {
    expect(LAYER.faces).toBeLessThan(LAYER.grid);
    expect(LAYER.grid).toBeLessThan(LAYER.edges);
    expect(LAYER.edges).toBeLessThan(LAYER.sketch);
  });

  it("no existing pair's margin shrinks", () => {
    // The grid against a part's base face is the widest gap anything has needed — an
    // enormous quad whose depth varies across itself — and it was measured at one of
    // slope and four of constant, against faces that were themselves pushed a step
    // back. Rounding the per-layer step down would quietly narrow exactly that, so
    // this pins it: separating edges from sketch lines must not bring back the grid's
    // flicker against the faces.
    const gap = (a: number, b: number) => ({
      factor: layerBias(b).polygonOffsetFactor - layerBias(a).polygonOffsetFactor,
      units: layerBias(b).polygonOffsetUnits - layerBias(a).polygonOffsetUnits,
    });
    const gridOverFaces = gap(LAYER.faces, LAYER.grid);
    expect(-gridOverFaces.factor).toBeGreaterThanOrEqual(2);
    expect(-gridOverFaces.units).toBeGreaterThanOrEqual(5);
  });
});
