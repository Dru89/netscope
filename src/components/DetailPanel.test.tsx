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

// Long enough to be cut by the fixed 170px key column, and sharing a prefix
// with its neighbour so an ellipsis renders them indistinguishable.
const LONG = "access-control-allow-credentials";
const SIBLING = "access-control-allow-methods";

function renderPanel() {
  const har = parseHar(
    makeHar([
      {
        url: "https://cdn.example.com/app.js",
        size: 100,
        responseHeaders: [
          { name: LONG, value: "true" },
          { name: SIBLING, value: "GET, POST" },
          { name: "etag", value: 'W/"abc"' },
        ],
      },
    ]),
  );
  render(<DetailPanel entry={har.log.entries[0]} onClose={vi.fn()} />);
}

const cell = (name: string) => screen.getByText(name);

describe("detail panel header names", () => {
  afterEach(cleanup);

  it("exposes the full name as a title, so a truncated key is still readable", () => {
    renderPanel();

    expect(cell(LONG).getAttribute("title")).toBe(LONG);
    expect(cell(SIBLING).getAttribute("title")).toBe(SIBLING);
  });

  it("gives short names a title too, rather than guessing what fits", () => {
    renderPanel();

    // Whether 170px truncates depends on font metrics jsdom doesn't have, so
    // the title is unconditional rather than measured.
    expect(cell("etag").getAttribute("title")).toBe("etag");
  });

  it("expands the name in place when clicked, and collapses again", () => {
    renderPanel();
    const key = cell(LONG);

    expect(key.className).toContain("clamped-key");
    expect(key.className).not.toContain("expanded");

    fireEvent.click(key);
    expect(key.className).toContain("expanded");

    fireEvent.click(key);
    expect(key.className).not.toContain("expanded");
  });

  it("expands only the clicked key", () => {
    renderPanel();

    fireEvent.click(cell(LONG));

    expect(cell(LONG).className).toContain("expanded");
    expect(cell(SIBLING).className).not.toContain("expanded");
  });
});
