// Which slice of a uniform-height list to render, and how much filler stands
// in for the rest. Split out from RequestTable so the arithmetic can be tested
// without a browser: the E2E suite is Linux-only, and getting this subtly
// wrong shows up as rows drifting out of alignment with the scrollbar rather
// than as an obvious failure.

export interface VirtualWindowInput {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  total: number;
  overscan: number;
}

// Floor for the overscan, and the whole of it before the viewport has been
// measured — without this the first paint would render nothing.
const MIN_OVERSCAN = 12;

// How many screenfuls to render beyond the viewport on each side.
//
// This is deliberately generous. macOS WebKit scrolls on the compositor
// thread and delivers scroll events to JS afterwards, so during a hard fling
// the viewport moves for several frames before React hears about it and can
// widen the window. The visible symptom is rows appearing to load in. A fixed
// row count can't express that, because the distance covered in those frames
// scales with how much is on screen; screenfuls can.
//
// Two is a judgement call rather than a measured constant: one screenful was
// still catching up on a fast fling. Rows are memoized, so the extra ones cost
// a little reconciliation and no re-render — cheap next to the alternative.
const OVERSCAN_VIEWPORTS = 2;

export function overscanForViewport(
  viewportHeight: number,
  rowHeight: number,
): number {
  if (rowHeight <= 0 || viewportHeight <= 0) return MIN_OVERSCAN;
  const rowsOnScreen = Math.ceil(viewportHeight / rowHeight);
  return Math.max(MIN_OVERSCAN, rowsOnScreen * OVERSCAN_VIEWPORTS);
}

export interface VirtualWindow {
  /** Index of the first rendered row. */
  firstVisible: number;
  /** Exclusive end index of the rendered rows. */
  lastVisible: number;
  /** Filler height standing in for rows before firstVisible. */
  padTop: number;
  /** Filler height standing in for rows after lastVisible. */
  padBottom: number;
}

export function computeVirtualWindow({
  scrollTop,
  viewportHeight,
  rowHeight,
  total,
  overscan,
}: VirtualWindowInput): VirtualWindow {
  if (total <= 0 || rowHeight <= 0) {
    return { firstVisible: 0, lastVisible: 0, padTop: 0, padBottom: 0 };
  }

  // Negative scrollTop happens with rubber-band overscroll on macOS.
  const top = Math.max(0, scrollTop);

  // firstVisible is clamped to the last row: a filter that shrinks the list
  // can leave scrollTop past the new end until the browser's own clamp fires
  // a scroll event, and without this the padding would claim a scroll height
  // the list no longer has.
  const firstVisible = Math.min(
    total - 1,
    Math.max(0, Math.floor(top / rowHeight) - overscan),
  );
  const lastVisible = Math.min(
    total,
    Math.max(
      firstVisible + 1,
      Math.ceil((top + viewportHeight) / rowHeight) + overscan,
    ),
  );

  return {
    firstVisible,
    lastVisible,
    padTop: firstVisible * rowHeight,
    padBottom: (total - lastVisible) * rowHeight,
  };
}
