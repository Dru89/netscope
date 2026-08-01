import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  Har,
  HarEntry,
  FilterState,
  SortState,
  SortField,
  SortDirection,
} from "./types/har";
import {
  parseHar,
  getContentType,
  getEntryName,
  getTransferSize,
  computeSummary,
} from "./utils/har";
import { parseFilterQuery, matchEntry } from "./utils/filterParser";
import { extractSuggestionData } from "./utils/filterSuggestions";
import { Toolbar } from "./components/Toolbar";
import { RequestTable } from "./components/RequestTable";
import { DetailPanel } from "./components/DetailPanel";
import { SummaryBar } from "./components/SummaryBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import * as platform from "./platform";
import "./styles/app.css";

export type ThemeMode = "system" | "light" | "dark";

// Start time in ms, or +Infinity when the entry has no usable timestamp, so
// the waterfall comparator stays consistent and undated entries sort last.
function startedAt(entry: HarEntry): number {
  const ms = new Date(entry.startedDateTime).getTime();
  return Number.isNaN(ms) ? Infinity : ms;
}

function App() {
  const [har, setHar] = useState<Har | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [selectedEntry, setSelectedEntry] = useState<HarEntry | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>({
    search: "",
    method: null,
    statusCode: null,
    contentType: null,
  });
  const [sort, setSort] = useState<SortState>({
    field: "waterfall",
    direction: "asc",
  });
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem("themeMode") as ThemeMode) || "system";
  });

  // Apply theme mode on mount and when it changes. The root data-theme
  // attribute is what the CSS keys off for an explicit Light/Dark choice;
  // System mode removes it so prefers-color-scheme decides (the pre-paint
  // script in index.html sets it before first render to avoid a flash).
  //
  // This deliberately doesn't broadcast: it also runs for a mode another
  // window chose, and re-announcing that would bounce the event around.
  // Announcing is changeThemeMode's job, below.
  useEffect(() => {
    localStorage.setItem("themeMode", themeMode);
    if (themeMode === "system") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = themeMode;
    }
    void platform.setThemeMode(themeMode);
  }, [themeMode]);

  // The user picked a mode in this window. Every other open window has to be
  // told, or it keeps both its old CSS and its old native chrome until it's
  // recreated — the persisted value alone only helps windows opened later.
  const changeThemeMode = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    void platform.broadcastThemeMode(mode);
  }, []);

  // Another window picked a mode. Setting state runs the effect above, which
  // applies it here without re-announcing.
  useEffect(() => platform.onThemeModeChanged(setThemeMode), []);

  const loadHarContent = useCallback((content: string, name: string) => {
    try {
      const parsed = parseHar(content);
      setHar(parsed);
      setFileName(name);
      setSelectedEntry(null);
      setDetailPanelOpen(false);
      setError(null);
      setFilter({
        search: "",
        method: null,
        statusCode: null,
        contentType: null,
      });
      void platform.setWindowTitle(name);
    } catch (err) {
      setError(
        `Failed to parse HAR file: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }, []);

  // Listen for files opened via OS (double-click, file associations, CLI arg)
  useEffect(() => {
    const cleanup = platform.onHarFileOpened((data) => {
      loadHarContent(data.content, data.fileName);
      platform.signalReady();
    });
    return cleanup;
  }, [loadHarContent]);

  // Load file pre-assigned to this window (CLI arg or file association),
  // then signal ready — windows are created hidden and shown on this signal
  // so file windows never flash the welcome screen (welcome windows show as
  // soon as they've painted).
  useEffect(() => {
    void platform.getWindowFile().then((data) => {
      if (data) loadHarContent(data.content, data.fileName);
      platform.signalReady();
    });
  }, [loadHarContent]);

  // Rust owns the picker and routes what's chosen (dedup, welcome-window
  // reuse, new windows), so this just asks for it. File > Open doesn't come
  // through here at all any more — the menu calls the same Rust path directly,
  // which is what lets it work with no window open.
  const handleOpenFile = useCallback(() => {
    void platform.pickAndOpenFiles();
  }, []);

  // Dev-only: load a fixture over HTTP in plain-browser dev, with optional
  // state params for visual work and screenshots, e.g.
  // http://localhost:5173/?fixture=/test/fixtures/www.example.com.har
  //   &theme=dark&filter=mime-type:json&select=3&tab=timing
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const params = new URLSearchParams(window.location.search);
    const fixture = params.get("fixture");
    if (!fixture) return;
    void fetch(fixture)
      .then((res) => res.text())
      .then((text) => {
        loadHarContent(text, fixture.split("/").pop() ?? fixture);
        const search = params.get("filter");
        if (search) setFilter((f) => ({ ...f, search }));
      });
  }, [loadHarContent]);

  // Dev-only: force a theme via ?theme= (works on the welcome screen too)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const theme = new URLSearchParams(window.location.search).get("theme");
    if (theme === "light" || theme === "dark") setThemeMode(theme);
  }, []);

  // Dev-only: select a row (and open the detail panel) once entries exist
  useEffect(() => {
    if (!import.meta.env.DEV || !har) return;
    const params = new URLSearchParams(window.location.search);
    const select = params.get("select");
    if (select === null) return;
    const entry = har.log.entries[Number(select)];
    if (entry) {
      setSelectedEntry(entry);
      setDetailPanelOpen(true);
    }
  }, [har]);

  // DOM drag-and-drop only serves plain-browser dev: under Tauri the native
  // drag-drop channel delivers drops instead — with real filesystem paths —
  // via platform.onFileDrop below.
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (platform.isNativeDropHandled()) return;

      const files = e.dataTransfer.files;
      if (files.length === 0) return;
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          loadHarContent(event.target.result as string, file.name);
        }
      };
      reader.readAsText(file);
    },
    [loadHarContent],
  );

  // Native drag-drop (Tauri): load in place and register the path so the
  // dropped file dedups against other windows like every other open path
  useEffect(() => {
    return platform.onFileDrop((data) => {
      loadHarContent(data.content, data.fileName);
      void platform.registerOpenFile(data.filePath);
    });
  }, [loadHarContent]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Select an entry and open the detail panel (used by click)
  const handleSelectEntry = useCallback((entry: HarEntry) => {
    setSelectedEntry(entry);
    setDetailPanelOpen(true);
  }, []);

  // Select an entry without changing the detail panel (used by keyboard nav)
  const handleSelectEntryOnly = useCallback((entry: HarEntry) => {
    setSelectedEntry(entry);
  }, []);

  // Toggle the detail panel for an entry (used by Enter/Space)
  const handleToggleDetail = useCallback(
    (entry: HarEntry) => {
      const isSameEntry = selectedEntry?._index === entry._index;
      setSelectedEntry(entry);
      if (isSameEntry) {
        setDetailPanelOpen((open) => !open);
      } else {
        setDetailPanelOpen(true);
      }
    },
    [selectedEntry],
  );

  const handleCloseDetail = useCallback(() => {
    setDetailPanelOpen(false);
  }, []);

  // Listen for sort changes from the context menu
  useEffect(() => {
    const cleanup = platform.onContextMenuSort((newSort) => {
      setSort({
        field: newSort.field as SortField,
        direction: newSort.direction as SortDirection,
      });
    });
    return cleanup;
  }, []);

  const filterInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Dev-only: initial detail-panel tab for the ?tab= screenshot param
  const devInitialTab = useMemo(() => {
    if (!import.meta.env.DEV) return undefined;
    return new URLSearchParams(window.location.search).get("tab") ?? undefined;
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      const isInDetailPanel = !!target.closest(".detail-panel");

      // Escape — close detail panel and return focus to table
      if (e.key === "Escape") {
        if (isInput && target === filterInputRef.current) {
          // Escape in filter input: blur it and return focus to table
          (target as HTMLElement).blur();
          tableContainerRef.current?.focus();
          return;
        }
        // If focus is inside the detail panel, let its own handlers deal with
        // Escape first (e.g., closing the source search bar). Only close the
        // panel when Escape is pressed outside an input within the panel.
        if (isInDetailPanel && isInput) return;
        if (detailPanelOpen) {
          e.preventDefault();
          setDetailPanelOpen(false);
          tableContainerRef.current?.focus();
          return;
        }
      }

      // / — focus filter input (unless already in an input)
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        filterInputRef.current?.focus();
        return;
      }

      // Cmd+F — focus filter input (unless in detail panel or already in an input)
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "f" &&
        !isInDetailPanel &&
        !isInput
      ) {
        e.preventDefault();
        filterInputRef.current?.focus();
        return;
      }

      // Cmd/Ctrl+N and Cmd/Ctrl+W are deliberately NOT handled here: the
      // native menu owns those accelerators in both runtimes, and a web-layer
      // handler double-fires on Tauri (same bug as the Ctrl+O double-open).
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [detailPanelOpen]);

  // Parse the search string into structured filter tokens
  const filterTokens = useMemo(
    () => parseFilterQuery(filter.search),
    [filter.search],
  );

  // Filter and sort entries. Memoized so selection changes, panel toggles,
  // and theme switches don't re-filter and re-sort a large HAR every render.
  const filteredEntries = useMemo(() => {
    if (!har) return [];
    return har.log.entries.filter((entry) => {
      // Apply structured filter tokens from the search input
      if (filterTokens.length > 0 && !matchEntry(filterTokens, entry))
        return false;
      // Apply toolbar button filters (these are separate from the text input)
      if (filter.method && entry.request.method !== filter.method) return false;
      if (filter.statusCode) {
        const status = entry.response.status.toString();
        if (filter.statusCode.endsWith("xx")) {
          if (!status.startsWith(filter.statusCode[0])) return false;
        } else {
          if (status !== filter.statusCode) return false;
        }
      }
      if (filter.contentType && getContentType(entry) !== filter.contentType)
        return false;
      return true;
    });
  }, [har, filterTokens, filter.method, filter.statusCode, filter.contentType]);

  const sortedEntries = useMemo(() => {
    return [...filteredEntries].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      switch (sort.field) {
        case "name":
          return dir * getEntryName(a).localeCompare(getEntryName(b));
        case "method":
          return dir * a.request.method.localeCompare(b.request.method);
        case "status":
          return dir * (a.response.status - b.response.status);
        case "type":
          return dir * getContentType(a).localeCompare(getContentType(b));
        case "size":
          return dir * (getTransferSize(a) - getTransferSize(b));
        case "time":
          return dir * (a.time - b.time);
        case "waterfall":
          // A missing or malformed startedDateTime parses to NaN, which makes
          // the comparator inconsistent and the resulting order arbitrary.
          // Sort those entries to the end instead.
          return dir * (startedAt(a) - startedAt(b));
        default:
          return 0;
      }
    });
  }, [filteredEntries, sort]);

  // Walks every entry doing per-entry content-type and date work, so it must
  // not run on unrelated renders — filter keystrokes, row selection, panel
  // toggles. Only the loaded file changes the result.
  const summary = useMemo(
    () => (har ? computeSummary(har.log.entries) : null),
    [har],
  );

  // Right-click context menu on request rows
  const handleContextMenu = useCallback(
    (entry: HarEntry) => {
      platform.showRequestContextMenu({
        // The "Copy All Listed" actions must copy what the table shows, in the
        // order it shows it. That's sortedEntries, not filteredEntries.
        entry,
        allEntries: sortedEntries,
        sortField: sort.field,
        sortDirection: sort.direction,
      });
    },
    [sortedEntries, sort],
  );

  // Precompute unique values from entries for filter autocomplete
  const suggestionData = useMemo(
    () => extractSuggestionData(har?.log.entries ?? []),
    [har],
  );

  return (
    <div className="app" onDrop={handleDrop} onDragOver={handleDragOver}>
      {/* macOS hides the native title bar (TitleBarStyle::Overlay), so the
          window has no chrome of its own to drag by — this strip is it. The
          data attribute is what Tauri hooks; the CSS app-region property that
          used to be here is Electron-only and did nothing. */}
      <div className="titlebar-drag-region" data-tauri-drag-region />
      {!har ? (
        <WelcomeScreen onOpenFile={handleOpenFile} error={error} />
      ) : (
        <div className="app-content">
          <Toolbar
            ref={filterInputRef}
            fileName={fileName}
            filter={filter}
            onFilterChange={setFilter}
            onOpenFile={handleOpenFile}
            totalEntries={har.log.entries.length}
            filteredEntries={sortedEntries.length}
            suggestionData={suggestionData}
          />
          <div className="app-main">
            <div
              className={`request-list-pane ${detailPanelOpen ? "with-detail" : ""}`}
            >
              <RequestTable
                entries={sortedEntries}
                allEntries={har.log.entries}
                selectedEntry={selectedEntry}
                onSelectEntry={handleSelectEntryOnly}
                onClickEntry={handleSelectEntry}
                onToggleDetail={handleToggleDetail}
                onContextMenu={handleContextMenu}
                sort={sort}
                onSortChange={setSort}
                containerRef={tableContainerRef}
              />
            </div>
            {detailPanelOpen && selectedEntry && (
              <div className="detail-pane">
                <DetailPanel
                  entry={selectedEntry}
                  onClose={handleCloseDetail}
                  initialTab={devInitialTab}
                />
              </div>
            )}
          </div>
          {summary && (
            <SummaryBar
              summary={summary}
              themeMode={themeMode}
              onThemeModeChange={changeThemeMode}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default App;
