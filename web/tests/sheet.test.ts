// The sheet's only real logic: which stop a release lands on, and the fact that
// the stops are derived from the space actually available (so the on-screen keyboard
// shrinks them instead of pushing the sheet off-screen).

import { describe, expect, it } from "vitest";
import { clampHeight, peekHeight, snapTarget, stopsFor } from "../src/app/sheet";

const stops = stopsFor(700, 56); // peek 56, half 385, full 700

describe("stopsFor", () => {
  it("derives the three stops from the available height", () => {
    expect(stops.map((s) => s.name)).toEqual(["peek", "half", "full"]);
    expect(stops[0].height).toBe(56);
    expect(stops[1].height).toBeCloseTo(385);
    expect(stops[2].height).toBe(700); // all of it — `full` means full
  });

  it("a keyboard shrinks every stop — the same name stays valid", () => {
    const withKeyboard = stopsFor(340, 56); // ~half the screen taken by the keyboard
    for (const s of withKeyboard) {
      expect(s.height).toBeLessThanOrEqual(340);
      expect(s.height).toBeGreaterThanOrEqual(56);
    }
    expect(withKeyboard.find((s) => s.name === "half")!.height).toBeLessThan(
      stops.find((s) => s.name === "half")!.height,
    );
  });

  it("never returns a stop shorter than the grip, however cramped", () => {
    for (const s of stopsFor(60, 56)) expect(s.height).toBeGreaterThanOrEqual(56);
  });
});

describe("snapTarget", () => {
  it("lands on the nearest stop when the gesture is slow", () => {
    expect(snapTarget(80, 0, stops).name).toBe("peek");
    expect(snapTarget(360, 0.1, stops).name).toBe("half");
    expect(snapTarget(660, -0.2, stops).name).toBe("full");
  });

  it("a flick states a direction, overriding nearness", () => {
    // Just above peek, flicked upward → half, not peek.
    expect(snapTarget(80, 1.2, stops).name).toBe("half");
    // Just below full, flicked downward → half, not full.
    expect(snapTarget(680, -1.2, stops).name).toBe("half");
  });

  it("a flick cannot run past the ends", () => {
    expect(snapTarget(700, 2, stops).name).toBe("full");
    expect(snapTarget(56, -2, stops).name).toBe("peek");
  });

  it("clamps a drag to the stop range", () => {
    expect(clampHeight(-100, stops)).toBe(56);
    expect(clampHeight(10_000, stops)).toBe(700);
    expect(clampHeight(300, stops)).toBe(300);
  });
});

describe("peekHeight — the loop that ate the sheet", () => {
  it("counts the sheet's own chrome, not just the grip", () => {
    // An iPhone's home-indicator inset plus a border: without these the sheet is set
    // shorter than its own content, squeezing the grip it has just measured.
    expect(peekHeight(96, 35)).toBe(131);
    expect(peekHeight(96, 0)).toBe(96);
  });

  it("never falls below the floor — a mismeasurement must not lock the app", () => {
    expect(peekHeight(0, 0)).toBe(56);
    expect(peekHeight(10, 5)).toBe(56);
    expect(peekHeight(0, 0, 44)).toBe(44);
  });

  it("is monotone in both inputs (no shrinking spiral is representable)", () => {
    expect(peekHeight(120, 35)).toBeGreaterThan(peekHeight(96, 35));
    expect(peekHeight(96, 35)).toBeGreaterThan(peekHeight(96, 10));
  });
});
