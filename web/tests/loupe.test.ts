// **The hand-over to step-loupe follows step-loupe's contract, and says why when it cannot.**
//
// The contract is step-loupe's (`src/index.html`, "optional hand-over from ?from=<id>"): the
// value sits under `step-loupe:<id>` as `{name, text, at}`, and the tab opens with `?from=<id>`.
// The browser is stood in for — a map for the storage, a function for `window.open` — so the
// two refusals can happen here: a storage that will not keep the file, a tab that is blocked.

import { describe, expect, it } from "vitest";
import { handOver, LOUPE_URL, loupeReachable } from "../src/app/loupe";

const browser = (opts: { full?: boolean; blocked?: boolean } = {}) => {
  const items = new Map<string, string>();
  const opened: string[] = [];
  return {
    items,
    opened,
    storage: {
      setItem(key: string, value: string) {
        if (opts.full) throw new DOMException("quota", "QuotaExceededError");
        items.set(key, value);
      },
      removeItem(key: string) {
        items.delete(key);
      },
    },
    open: (url: string) => {
      opened.push(url);
      return opts.blocked ? null : {};
    },
  };
};

describe("step-loupe hand-over", () => {
  it("stores the file under step-loupe's prefix and opens it with ?from=", () => {
    const b = browser();
    expect(handOver(b, "a b", "part.step", "ISO-10303-21;", 1234)).toBeNull();
    expect([...b.items.keys()]).toEqual(["step-loupe:a b"]);
    expect(JSON.parse(b.items.get("step-loupe:a b")!)).toEqual({
      name: "part.step",
      text: "ISO-10303-21;",
      at: 1234,
    });
    expect(b.opened).toEqual([`${LOUPE_URL}?from=a%20b&up=z`]);
  });

  it("refuses, opening nothing, when the storage will not keep the file", () => {
    const b = browser({ full: true });
    expect(handOver(b, "x", "part.step", "text", 0)).toMatch(/would not keep.*QuotaExceededError/);
    expect(b.items.size).toBe(0);
    expect(b.opened).toEqual([]);
  });

  it("takes the file back when the tab is blocked", () => {
    const b = browser({ blocked: true });
    expect(handOver(b, "x", "part.step", "text", 0)).toBe("the browser blocked the new tab");
    expect(b.items.size).toBe(0);
  });

  it("is offered only on step-loupe's own origin", () => {
    expect(loupeReachable("https://elgar328.github.io")).toBe(true);
    expect(loupeReachable("http://localhost:5173")).toBe(false);
    expect(loupeReachable("http://elgar328.github.io")).toBe(false);
  });
});
