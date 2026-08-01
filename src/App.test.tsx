// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { makeHar } from "./testing/har";

vi.mock("./platform", async () => {
  const { platformMock } = await import("./testing/platformMock");
  return platformMock();
});

import * as platform from "./platform";
import App from "./App";

// Deliberately in neither size nor name order, so "sorted" and "file order"
// can never coincide. Two hosts so a filter has something to bite on.
const HAR = makeHar([
  { url: "https://cdn.example.com/medium.js", size: 500 },
  { url: "https://api.example.com/huge.js", size: 9000 },
  { url: "https://cdn.example.com/tiny.js", size: 10 },
  { url: "https://cdn.example.com/small.js", size: 100 },
]);

const FILE_ORDER = ["medium.js", "huge.js", "tiny.js", "small.js"];
const SIZE_DESC = ["huge.js", "medium.js", "small.js", "tiny.js"];

async function loadFile() {
  vi.mocked(platform.getWindowFile).mockResolvedValue({
    filePath: "/tmp/test.har",
    content: HAR,
    fileName: "test.har",
  });
  render(<App />);
  await screen.findByText("huge.js");
}

function rowFor(name: string) {
  return screen.getByText(name).closest("tr")!;
}

function sortBy(column: RegExp, clicks: number) {
  const header = screen.getByRole("columnheader", { name: column });
  for (let i = 0; i < clicks; i++) fireEvent.click(header);
}

/**
 * Row order as actually rendered, read off the DOM. The name cell reads
 * "small.js - cdn.example.com"; only the file name is interesting here.
 */
function displayedOrder(): string[] {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (row) =>
      row.querySelector(".cell-name-text")?.textContent?.split(" - ")[0] ?? "",
  );
}

/** What the last showRequestContextMenu call would have put on the clipboard. */
function lastContextMenuEntries(): string[] {
  const calls = vi.mocked(platform.showRequestContextMenu).mock.calls;
  const last = calls[calls.length - 1];
  return last[0].allEntries.map((e) => e.request.url.split("/").pop()!);
}

describe("request context menu entry list", () => {
  beforeEach(() => {
    vi.mocked(platform.showRequestContextMenu).mockClear();
  });
  afterEach(cleanup);

  it("matches the displayed order after sorting", async () => {
    await loadFile();
    sortBy(/^Size/, 2); // first click ascending, second descending

    fireEvent.contextMenu(rowFor("huge.js"));

    expect(displayedOrder()).toEqual(SIZE_DESC);
    expect(lastContextMenuEntries()).toEqual(SIZE_DESC);
  });

  it("no longer falls back to HAR file order", async () => {
    await loadFile();
    sortBy(/^Size/, 2);

    fireEvent.contextMenu(rowFor("huge.js"));

    // The #15 regression: allEntries was filteredEntries, still in file order,
    // so this is exactly what the clipboard used to receive.
    expect(lastContextMenuEntries()).not.toEqual(FILE_ORDER);
  });

  it("is file order when nothing has been sorted", async () => {
    await loadFile();

    fireEvent.contextMenu(rowFor("huge.js"));

    // Default sort is waterfall ascending and makeHar stamps startedDateTime
    // in array order, so displayed order and file order agree here.
    expect(lastContextMenuEntries()).toEqual(FILE_ORDER);
  });

  it("carries the filter as well as the sort", async () => {
    await loadFile();

    fireEvent.change(screen.getByPlaceholderText(/^Filter/), {
      target: { value: "cdn." },
    });
    await screen.findByText("medium.js");
    sortBy(/^Size/, 2);
    fireEvent.contextMenu(rowFor("medium.js"));

    expect(lastContextMenuEntries()).toEqual([
      "medium.js",
      "small.js",
      "tiny.js",
    ]);
  });
});

describe("parse error banner", () => {
  beforeEach(() => {
    vi.mocked(platform.onHarFileOpened).mockClear();
  });
  afterEach(cleanup);

  /** The handler App registered for OS-driven opens, so a file can be pushed
   *  at an already-loaded window the way a drop or File > Open would. */
  function pushFile(content: string, fileName: string) {
    const handler = vi.mocked(platform.onHarFileOpened).mock.calls[0][0];
    act(() => handler({ filePath: `/tmp/${fileName}`, content, fileName }));
  }

  it("surfaces a parse failure that used to be silent", async () => {
    await loadFile();
    expect(screen.queryByRole("alert")).toBeNull();

    pushFile("{ not a har }", "broken.har");

    expect(screen.getByRole("alert").textContent).toMatch(
      /Failed to parse HAR file/,
    );
  });

  it("leaves the open capture alone", async () => {
    await loadFile();

    pushFile("{ not a har }", "broken.har");

    // The previous file is still usable — the failure replaced nothing.
    expect(screen.getByText("huge.js")).toBeTruthy();
    expect(displayedOrder()).toEqual(FILE_ORDER);
  });

  it("dismisses on click", async () => {
    await loadFile();
    pushFile("{ not a har }", "broken.har");

    fireEvent.click(screen.getByLabelText("Dismiss error"));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears when a later file loads successfully", async () => {
    await loadFile();
    pushFile("{ not a har }", "broken.har");
    expect(screen.queryByRole("alert")).not.toBeNull();

    pushFile(
      makeHar([{ url: "https://cdn.example.com/ok.js", size: 1 }]),
      "ok.har",
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("ok.js")).toBeTruthy();
  });
});
