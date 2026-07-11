import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import {
  launchApp,
  eventually,
  setInputValue,
  FIXTURES,
  type Session,
} from "./helpers";

describe("welcome screen", () => {
  let session: Session;

  beforeAll(async () => {
    session = await launchApp();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it("renders the welcome screen with no file", async () => {
    const { browser } = session;
    const title = await eventually(async () => {
      const el = await browser.$(".welcome-title");
      expect(await el.isExisting()).toBe(true);
      return el.getText();
    });
    expect(title).toBe("Netscope");
    const button = await browser.$(".welcome-open-btn");
    expect(await button.getText()).toContain("Open HAR File");
  });

  it("sets the platform attribute for platform-specific styling", async () => {
    const platform = await session.browser.execute(
      () => document.documentElement.dataset.platform,
    );
    expect(["darwin", "win32", "linux"]).toContain(platform);
  });
});

describe("file open and interaction", () => {
  let session: Session;

  beforeAll(async () => {
    session = await launchApp([path.join(FIXTURES, "www.google.com.har")]);
  });

  afterAll(async () => {
    await session?.stop();
  });

  it("loads a HAR passed as a CLI argument", async () => {
    const { browser } = session;
    const rowCount = await eventually(async () => {
      const rows = await browser.$$(".request-table tbody tr.row");
      expect(rows.length).toBeGreaterThan(0);
      return rows.length;
    });
    const count = await browser.$(".toolbar-count");
    expect(await count.getText()).toContain(String(rowCount));
  });

  it("shows summary stats", async () => {
    const { browser } = session;
    const summary = await browser.$(".summary-bar");
    expect(await summary.getText()).toContain("requests");
  });

  it("filters entries from the search input", async () => {
    const { browser } = session;
    const before = (await browser.$$(".request-table tbody tr.row")).length;

    await setInputValue(browser, ".toolbar-search input", "method:POST");
    const after = await eventually(async () => {
      const rows = await browser.$$(".request-table tbody tr.row");
      expect(rows.length).toBeLessThan(before);
      return rows.length;
    });
    expect(after).toBeGreaterThan(0);

    await setInputValue(browser, ".toolbar-search input", "");
    await eventually(async () => {
      const rows = await browser.$$(".request-table tbody tr.row");
      expect(rows.length).toBe(before);
    });
  });

  it("opens the detail panel on row click and closes on Escape", async () => {
    const { browser } = session;
    // Click a cell, not the <tr> — WebDriver reports table rows as
    // not-interactable targets
    const row = await browser.$(".request-table tbody tr.row td");
    await row.click();
    await eventually(async () => {
      const panel = await browser.$(".detail-panel");
      expect(await panel.isExisting()).toBe(true);
    });
    await browser.keys(["Escape"]);
    await eventually(async () => {
      const panel = await browser.$(".detail-panel");
      expect(await panel.isExisting()).toBe(false);
    });
  });

  it("sorts when a column header is clicked", async () => {
    const { browser } = session;
    const header = await browser.$(".request-table th.col-time");
    await header.click();
    await eventually(async () => {
      const arrow = await browser.$(".request-table th.col-time .sort-arrow");
      expect(await arrow.isExisting()).toBe(true);
    });
    // Ascending: first row should be the fastest request
    const firstTime = await browser
      .$(".request-table tbody tr.row .time-cell")
      .getText();
    expect(firstTime).toBeTruthy();
  });

  it("navigates rows with j/k", async () => {
    const { browser } = session;
    const table = await browser.$(".request-table-container");
    await table.click();
    await browser.keys(["j"]);
    await browser.keys(["j"]);
    await eventually(async () => {
      const selected = await browser.$(".request-table tr.row.selected");
      expect(await selected.isExisting()).toBe(true);
    });
  });
});
