import { describe, it, expect } from "vitest";
import { computeVirtualWindow } from "./virtualWindow";

// Matches the real table: 26px rows, 12 rows of overscan.
const base = { rowHeight: 26, overscan: 12 };
const win = (over: Partial<Parameters<typeof computeVirtualWindow>[0]>) =>
  computeVirtualWindow({
    scrollTop: 0,
    viewportHeight: 780,
    total: 1000,
    ...base,
    ...over,
  });

describe("computeVirtualWindow", () => {
  it("renders from the top with only trailing overscan at rest", () => {
    const w = win({ scrollTop: 0 });
    expect(w.firstVisible).toBe(0);
    // 780/26 = 30 visible rows, plus overscan
    expect(w.lastVisible).toBe(42);
    expect(w.padTop).toBe(0);
    expect(w.padBottom).toBe((1000 - 42) * 26);
  });

  it("keeps total height constant regardless of scroll position", () => {
    // The scrollbar must not move under the user: padTop + rendered rows +
    // padBottom always spans the whole list.
    for (const scrollTop of [0, 260, 3053, 12_000, 25_974]) {
      const w = win({ scrollTop });
      const rendered = (w.lastVisible - w.firstVisible) * 26;
      expect(w.padTop + rendered + w.padBottom).toBe(1000 * 26);
    }
  });

  it("windows around the scroll position in the middle of the list", () => {
    const w = win({ scrollTop: 26 * 500 });
    expect(w.firstVisible).toBe(488); // 500 - overscan
    expect(w.lastVisible).toBe(542); // 500 + 30 visible + overscan
    expect(w.padTop).toBe(488 * 26);
  });

  it("renders the final entry when scrolled to the bottom", () => {
    // Same numbers the browser produced for the 146-entry fixture.
    const w = computeVirtualWindow({
      scrollTop: 3053,
      viewportHeight: 771,
      total: 146,
      ...base,
    });
    expect(w.lastVisible).toBe(146);
    expect(w.firstVisible).toBe(105);
    expect(w.padTop).toBe(105 * 26);
    expect(w.padBottom).toBe(0);
  });

  it("never renders past the end of the list", () => {
    const w = win({ scrollTop: 26 * 995, total: 1000 });
    expect(w.lastVisible).toBe(1000);
    expect(w.padBottom).toBe(0);
  });

  it("handles a list shorter than the viewport", () => {
    const w = win({ total: 3 });
    expect(w.firstVisible).toBe(0);
    expect(w.lastVisible).toBe(3);
    expect(w.padTop).toBe(0);
    expect(w.padBottom).toBe(0);
  });

  it("returns an empty window for an empty list", () => {
    const w = win({ total: 0 });
    expect(w).toEqual({
      firstVisible: 0,
      lastVisible: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("still renders a row before the viewport has been measured", () => {
    // First paint: the ResizeObserver hasn't reported a height yet. Rendering
    // nothing here would leave the table blank until the next frame.
    const w = win({ viewportHeight: 0 });
    expect(w.lastVisible).toBeGreaterThan(w.firstVisible);
  });

  it("clamps a scroll position left past the end by a shrinking filter", () => {
    // Was scrolled deep into 1000 entries, then a filter cut it to 5.
    const w = win({ scrollTop: 26 * 900, total: 5 });
    expect(w.firstVisible).toBeLessThanOrEqual(4);
    expect(w.lastVisible).toBeLessThanOrEqual(5);
    expect(w.lastVisible).toBeGreaterThan(w.firstVisible);
    expect(w.padTop).toBeLessThanOrEqual(5 * 26);
    expect(w.padBottom).toBeGreaterThanOrEqual(0);
  });

  it("tolerates negative scrollTop from overscroll", () => {
    const w = win({ scrollTop: -120 });
    expect(w.firstVisible).toBe(0);
    expect(w.padTop).toBe(0);
  });

  it("degrades safely if the row height is not yet known", () => {
    const w = win({ rowHeight: 0 });
    expect(w).toEqual({
      firstVisible: 0,
      lastVisible: 0,
      padTop: 0,
      padBottom: 0,
    });
  });
});
