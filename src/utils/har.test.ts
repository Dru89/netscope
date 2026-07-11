import { describe, it, expect } from "vitest";
import type { HarEntry } from "../types/har";
import { getTransferSize } from "./har";

function makeEntry(response: Partial<HarEntry["response"]>): HarEntry {
  return {
    startedDateTime: "2026-01-01T00:00:00.000Z",
    time: 10,
    request: {
      method: "GET",
      url: "https://example.com/a",
      httpVersion: "http/2.0",
      headers: [],
      queryString: [],
      cookies: [],
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: 200,
      statusText: "OK",
      httpVersion: "http/2.0",
      headers: [],
      cookies: [],
      content: { size: 1000, mimeType: "text/html" },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
      ...response,
    },
    cache: {},
    timings: { send: 1, wait: 5, receive: 4 },
  } as HarEntry;
}

describe("getTransferSize", () => {
  it("prefers Chrome's _transferSize when present", () => {
    // Modern Chrome exports: headersSize/bodySize are -1, the real
    // on-the-wire size lives in _transferSize
    const entry = makeEntry({
      _transferSize: 4321,
      headersSize: -1,
      bodySize: -1,
    });
    expect(getTransferSize(entry)).toBe(4321);
  });

  it("treats _transferSize: 0 (disk cache) as zero transfer", () => {
    const entry = makeEntry({ _transferSize: 0, bodySize: 512 });
    expect(getTransferSize(entry)).toBe(0);
  });

  it("falls back to headersSize + bodySize without _transferSize", () => {
    const entry = makeEntry({ headersSize: 200, bodySize: 800 });
    expect(getTransferSize(entry)).toBe(1000);
  });

  it("ignores a negative _transferSize", () => {
    const entry = makeEntry({
      _transferSize: -1,
      headersSize: 100,
      bodySize: 400,
    });
    expect(getTransferSize(entry)).toBe(500);
  });

  it("clamps negative header/body sizes in the fallback", () => {
    const entry = makeEntry({ headersSize: -1, bodySize: -1 });
    expect(getTransferSize(entry)).toBe(0);
  });
});
