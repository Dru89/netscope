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
