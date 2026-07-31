import {
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useState,
  memo,
} from "react";
import { flushSync } from "react-dom";
import type { HarEntry, SortState, SortField } from "../types/har";
import {
  getEntryName,
  getEntryDomain,
  getContentType,
  getTransferSize,
  formatBytes,
  formatTime,
  getStatusColor,
  getMethodColor,
  getContentTypeIcon,
  computeTimingOffsets,
} from "../utils/har";
import {
  computeVirtualWindow,
  overscanForViewport,
} from "../utils/virtualWindow";

const COLUMN_COUNT = 7;

// Only used until a real row can be measured; see syncMetrics below.
const ESTIMATED_ROW_HEIGHT = 26;

interface RequestTableProps {
  entries: HarEntry[];
  allEntries: HarEntry[];
  selectedEntry: HarEntry | null;
  onSelectEntry: (entry: HarEntry) => void;
  onClickEntry: (entry: HarEntry) => void;
  onToggleDetail: (entry: HarEntry) => void;
  onContextMenu?: (entry: HarEntry) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function RequestTable({
  entries,
  allEntries,
  selectedEntry,
  onSelectEntry,
  onClickEntry,
  onToggleDetail,
  onContextMenu,
  sort,
  onSortChange,
  containerRef: externalContainerRef,
}: RequestTableProps) {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const prevEntriesRef = useRef<HarEntry[]>(entries);

  // Virtual window state. A capture can hold tens of thousands of entries and
  // each row is a dozen-odd elements, so only the visible slice is rendered;
  // spacer rows stand in for the rest to keep the scrollbar honest.
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT);
  const headerHeightRef = useRef(0);

  const hasRows = entries.length > 0;

  // The window's arithmetic has to agree with what the browser actually laid
  // out or scrolling drifts, and the rendered height isn't simply the
  // --ns-row-h token: the cells collapse a 1px border between them. So
  // measure a real row rather than trusting the token, and re-measure when
  // the container resizes (the header's height feeds the same arithmetic).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncMetrics = () => {
      setViewportHeight(container.clientHeight);
      headerHeightRef.current = theadRef.current?.offsetHeight ?? 0;
      const row = container.querySelector<HTMLElement>("tbody tr.row");
      const measured = row?.getBoundingClientRect().height ?? 0;
      if (measured > 0) {
        setRowHeight((prev) =>
          Math.abs(prev - measured) > 0.5 ? measured : prev,
        );
      }
    };

    syncMetrics();
    const observer = new ResizeObserver(syncMetrics);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, hasRows]);

  // Set state straight from the event rather than deferring to
  // requestAnimationFrame: React batches these already, rows are memoized so
  // a re-render is cheap, and rAF doesn't run in a background window — which
  // would leave the window stale after any programmatic scroll there.
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Scroll programmatically, then move the window before the browser paints.
  //
  // Relying on the resulting scroll event is too late twice over: the event
  // arrives a frame or more later on WebKit's threaded scrolling, and the
  // re-render it schedules is itself async. Either way the new scroll position
  // gets painted with the rows that used to be there, which is the flash a
  // Home/End jump showed. flushSync is the point of this function — a plain
  // setState here would still land after the paint.
  const scrollContainerTo = useCallback(
    (top: number) => {
      const container = containerRef.current;
      if (!container) return;
      container.scrollTop = Math.max(0, top);
      // Read it back rather than reusing `top`: the browser clamps to the
      // scrollable range, and the window has to agree with where we landed.
      const landed = container.scrollTop;
      flushSync(() => setScrollTop(landed));
    },
    [containerRef],
  );

  const { firstVisible, lastVisible, padTop, padBottom } = computeVirtualWindow(
    {
      scrollTop,
      viewportHeight,
      rowHeight,
      total: entries.length,
      overscan: overscanForViewport(viewportHeight, rowHeight),
    },
  );
  const visibleEntries = entries.slice(firstVisible, lastVisible);

  // Where an entry's row sits in scroll coordinates. Computed rather than
  // measured: with virtualization the row usually isn't in the DOM.
  const rowTopFor = useCallback(
    (positionInList: number) =>
      headerHeightRef.current + positionInList * rowHeight,
    [rowHeight],
  );

  // Scroll the selected entry into view only when the entries list changes
  // (e.g., when switching content-type filter tabs), not on selection change
  useEffect(() => {
    const entriesChanged = prevEntriesRef.current !== entries;
    prevEntriesRef.current = entries;

    const container = containerRef.current;
    if (!entriesChanged || !selectedEntry || !container) return;
    const position = entries.findIndex(
      (e) => e._index === selectedEntry._index,
    );
    if (position === -1) return;

    // Center the row in the container
    const rowTop = rowTopFor(position);
    scrollContainerTo(rowTop - container.clientHeight / 2 + rowHeight / 2);
  }, [
    entries,
    selectedEntry,
    containerRef,
    rowHeight,
    rowTopFor,
    scrollContainerTo,
  ]);

  // Compute waterfall boundaries
  const { minTime, maxTime } = useMemo(() => {
    if (allEntries.length === 0) return { minTime: 0, maxTime: 1 };
    let min = Infinity;
    let max = -Infinity;
    allEntries.forEach((entry) => {
      const start = new Date(entry.startedDateTime).getTime();
      const end = start + entry.time;
      if (start < min) min = start;
      if (end > max) max = end;
    });
    return { minTime: min, maxTime: max };
  }, [allEntries]);

  const totalDuration = maxTime - minTime || 1;

  const handleSort = (field: SortField) => {
    if (sort.field === field) {
      onSortChange({
        field,
        direction: sort.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ field, direction: "asc" });
    }
  };

  const renderSortArrow = (field: SortField) => {
    if (sort.field !== field) return null;
    return (
      <span className="sort-arrow">
        {sort.direction === "asc" ? "\u25B2" : "\u25BC"}
      </span>
    );
  };

  // Scroll a row into view within the table container, keeping it visible
  // without centering it (unlike the filter-change scroll which centers).
  const scrollEntryIntoView = useCallback(
    (entry: HarEntry) => {
      const container = containerRef.current;
      if (!container) return;
      const position = entries.findIndex((e) => e._index === entry._index);
      if (position === -1) return;

      const headerHeight = headerHeightRef.current;
      const rowTop = rowTopFor(position);
      const rowBottom = rowTop + rowHeight;
      const viewTop = container.scrollTop + headerHeight;
      const viewBottom = container.scrollTop + container.clientHeight;
      if (rowTop < viewTop) {
        scrollContainerTo(rowTop - headerHeight);
      } else if (rowBottom > viewBottom) {
        scrollContainerTo(rowBottom - container.clientHeight);
      }
    },
    [containerRef, entries, rowHeight, rowTopFor, scrollContainerTo],
  );

  // Keyboard navigation within the request table
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (entries.length === 0) return;

      const isMeta = e.metaKey || e.ctrlKey;

      let nextEntry: HarEntry | null = null;

      // Up / k — select previous entry
      if ((e.key === "ArrowUp" && !isMeta) || (e.key === "k" && !isMeta)) {
        e.preventDefault();
        if (!selectedEntry) {
          nextEntry = entries[entries.length - 1];
        } else {
          const idx = entries.findIndex(
            (ent) => ent._index === selectedEntry._index,
          );
          if (idx === -1) {
            nextEntry = entries[entries.length - 1];
          } else if (idx > 0) {
            nextEntry = entries[idx - 1];
          }
        }
      }

      // Down / j — select next entry
      if ((e.key === "ArrowDown" && !isMeta) || (e.key === "j" && !isMeta)) {
        e.preventDefault();
        if (!selectedEntry) {
          nextEntry = entries[0];
        } else {
          const idx = entries.findIndex(
            (ent) => ent._index === selectedEntry._index,
          );
          if (idx === -1) {
            nextEntry = entries[0];
          } else if (idx < entries.length - 1) {
            nextEntry = entries[idx + 1];
          }
        }
      }

      // Home / Cmd+Up — select first entry
      if (e.key === "Home" || (e.key === "ArrowUp" && isMeta)) {
        e.preventDefault();
        nextEntry = entries[0];
      }

      // End / Cmd+Down — select last entry
      if (e.key === "End" || (e.key === "ArrowDown" && isMeta)) {
        e.preventDefault();
        nextEntry = entries[entries.length - 1];
      }

      if (nextEntry) {
        onSelectEntry(nextEntry);
        scrollEntryIntoView(nextEntry);
        return;
      }

      // Enter / Space — toggle detail panel for selected entry
      if ((e.key === "Enter" || e.key === " ") && selectedEntry) {
        e.preventDefault();
        onToggleDetail(selectedEntry);
      }
    },
    [
      entries,
      selectedEntry,
      onSelectEntry,
      onToggleDetail,
      scrollEntryIntoView,
    ],
  );

  return (
    <div
      className="request-table-container"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onScroll={handleScroll}
    >
      <table className="request-table">
        <thead ref={theadRef}>
          <tr>
            <th
              className={`col-name ${sort.field === "name" ? "sorted" : ""}`}
              onClick={() => handleSort("name")}
            >
              Name {renderSortArrow("name")}
            </th>
            <th
              className={`col-method ${sort.field === "method" ? "sorted" : ""}`}
              onClick={() => handleSort("method")}
            >
              Method {renderSortArrow("method")}
            </th>
            <th
              className={`col-status ${sort.field === "status" ? "sorted" : ""}`}
              onClick={() => handleSort("status")}
            >
              Status {renderSortArrow("status")}
            </th>
            <th
              className={`col-type ${sort.field === "type" ? "sorted" : ""}`}
              onClick={() => handleSort("type")}
            >
              Type {renderSortArrow("type")}
            </th>
            <th
              className={`col-size ${sort.field === "size" ? "sorted" : ""}`}
              onClick={() => handleSort("size")}
            >
              Size {renderSortArrow("size")}
            </th>
            <th
              className={`col-time ${sort.field === "time" ? "sorted" : ""}`}
              onClick={() => handleSort("time")}
            >
              Time {renderSortArrow("time")}
            </th>
            <th
              className={`col-waterfall ${sort.field === "waterfall" ? "sorted" : ""}`}
              onClick={() => handleSort("waterfall")}
            >
              Waterfall {renderSortArrow("waterfall")}
            </th>
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <SpacerRow height={padTop} />}
          {visibleEntries.map((entry, offset) => (
            <RequestRow
              key={entry._index ?? firstVisible + offset}
              entry={entry}
              isSelected={selectedEntry?._index === entry._index}
              minTime={minTime}
              totalDuration={totalDuration}
              onSelectEntry={onSelectEntry}
              onClickEntry={onClickEntry}
              onContextMenu={onContextMenu}
            />
          ))}
          {padBottom > 0 && <SpacerRow height={padBottom} />}
        </tbody>
      </table>
    </div>
  );
}

// Stands in for the rows outside the virtual window so the scroll height and
// scrollbar match the full list. Inline styles because the stylesheet gives
// every td a row height and a bottom border.
function SpacerRow({ height }: { height: number }) {
  return (
    <tr aria-hidden="true" className="row-spacer">
      <td colSpan={COLUMN_COUNT} style={{ height, padding: 0, border: 0 }} />
    </tr>
  );
}

interface RequestRowProps {
  entry: HarEntry;
  isSelected: boolean;
  minTime: number;
  totalDuration: number;
  onSelectEntry: (entry: HarEntry) => void;
  onClickEntry: (entry: HarEntry) => void;
  onContextMenu?: (entry: HarEntry) => void;
}

const RequestRow = memo(function RequestRow({
  entry,
  isSelected,
  minTime,
  totalDuration,
  onSelectEntry,
  onClickEntry,
  onContextMenu,
}: RequestRowProps) {
  const name = getEntryName(entry);
  const domain = getEntryDomain(entry);
  const contentType = getContentType(entry);
  const transferSize = getTransferSize(entry);
  const isError = entry.response.status >= 400 || entry.response.status === 0;
  const phases = computeTimingOffsets(entry);
  const startOffset = new Date(entry.startedDateTime).getTime() - minTime;

  return (
    <tr
      data-entry-index={entry._index}
      className={`row ${isSelected ? "selected" : ""} ${isError ? "error-row" : ""}`}
      onClick={() => onClickEntry(entry)}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelectEntry(entry);
        onContextMenu?.(entry);
      }}
      title={entry.request.url}
    >
      <td className="col-name">
        <div className="cell-name">
          <span className={`type-badge ${contentType}`}>
            {getContentTypeIcon(contentType)}
          </span>
          <span className="cell-name-text">
            {name}
            {domain && <span className="cell-name-domain"> - {domain}</span>}
          </span>
        </div>
      </td>
      <td className="col-method">
        <span
          className="method-label"
          style={{ color: getMethodColor(entry.request.method) }}
        >
          {entry.request.method}
        </span>
      </td>
      <td className="col-status">
        <span
          className="status-code"
          style={{ color: getStatusColor(entry.response.status) }}
        >
          {entry.response.status || "ERR"}
        </span>
      </td>
      <td className="col-type">
        <span className={`type-badge ${contentType}`}>{contentType}</span>
      </td>
      <td className="col-size">
        <span className="size-cell">
          {transferSize > 0 ? formatBytes(transferSize) : "-"}
        </span>
      </td>
      <td className="col-time">
        <span className="time-cell">{formatTime(entry.time)}</span>
      </td>
      <td className="col-waterfall">
        <div className="waterfall-cell">
          {/* One bar spanning the request's duration on the shared
              capture timeline; phase segments butt-join inside it
              so the rounded ends clip cleanly. */}
          <div
            className="waterfall-bar"
            style={{
              left: `${(startOffset / totalDuration) * 100}%`,
              width: `${Math.max((entry.time / totalDuration) * 100, 0.2)}%`,
            }}
          >
            {phases.map((phase, i) => {
              const requestTime = entry.time || 1;
              return (
                <div
                  key={i}
                  className="waterfall-seg"
                  style={{
                    left: `${(phase.start / requestTime) * 100}%`,
                    width: `${(phase.duration / requestTime) * 100}%`,
                    background: phase.color,
                  }}
                  title={`${phase.name}: ${formatTime(phase.duration)}`}
                />
              );
            })}
          </div>
        </div>
      </td>
    </tr>
  );
});
