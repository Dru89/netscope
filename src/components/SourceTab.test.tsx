// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { makeHar } from "../testing/har";
import { parseHar } from "../utils/har";

vi.mock("../platform", async () => {
  const { platformMock } = await import("../testing/platformMock");
  return platformMock();
});

import { DetailPanel } from "./DetailPanel";

// Two entries whose JSON contains a different number of "alpha" occurrences,
// so a counter carried over from one is unmistakable against the other.
const har = parseHar(
  makeHar([
    {
      url: "https://cdn.example.com/alpha/alpha.js",
      size: 1,
      responseHeaders: [
        { name: "x-alpha", value: "alpha" },
        { name: "x-alpha-2", value: "alpha" },
      ],
    },
    {
      url: "https://cdn.example.com/beta.js",
      size: 2,
      responseHeaders: [{ name: "x-beta", value: "beta" }],
    },
  ]),
);
const [busy, quiet] = har.log.entries;

function openSourceSearch(query: string) {
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.change(screen.getByPlaceholderText("Search..."), {
    target: { value: query },
  });
}

const counter = () => document.querySelector(".source-search-count");

describe("source tab state across entries", () => {
  afterEach(cleanup);

  it("counts matches in the entry actually on screen", () => {
    render(<DetailPanel entry={busy} onClose={vi.fn()} />);
    openSourceSearch("alpha");

    // Whatever the exact count, it must be more than the other entry has.
    const busyText = counter()?.textContent ?? "";
    expect(busyText).toMatch(/^1 of \d+$/);
    expect(Number(busyText.split(" of ")[1])).toBeGreaterThan(1);
  });

  it("does not carry a stale count into the next selection", () => {
    const { rerender } = render(<DetailPanel entry={busy} onClose={vi.fn()} />);
    openSourceSearch("alpha");
    expect(counter()).not.toBeNull();

    rerender(<DetailPanel entry={quiet} onClose={vi.fn()} />);

    // The tab is remounted for the new entry, so the search resets rather
    // than leaving a counter describing a document nobody is looking at.
    expect(screen.queryByPlaceholderText("Search...")).toBeNull();
    expect(counter()).toBeNull();
  });

  it("reports no results rather than a leftover number", () => {
    const { rerender } = render(<DetailPanel entry={busy} onClose={vi.fn()} />);
    openSourceSearch("alpha");

    rerender(<DetailPanel entry={quiet} onClose={vi.fn()} />);
    openSourceSearch("alpha");

    // "alpha" appears in busy's URL and headers, in quiet's nothing.
    expect(counter()?.textContent).toBe("No results");
  });

  it("keeps search state while the same entry stays selected", () => {
    const { rerender } = render(<DetailPanel entry={busy} onClose={vi.fn()} />);
    openSourceSearch("alpha");
    const before = counter()?.textContent;

    // A re-render for an unrelated reason must not throw the search away.
    rerender(<DetailPanel entry={busy} onClose={vi.fn()} />);

    expect(counter()?.textContent).toBe(before);
  });
});
