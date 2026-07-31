import { describe, it, expect } from "vitest";
import type { HarEntry } from "../types/har";
import {
  getTransferSize,
  parseHar,
  getContentType,
  computeSummary,
  getEntryName,
} from "./har";

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

describe("parseHar", () => {
  const har = (entries: unknown[]) =>
    JSON.stringify({ log: { version: "1.2", entries } });

  it("rejects a file with no entries array", () => {
    expect(() => parseHar('{"log":{"version":"1.2"}}')).toThrow(
      /missing log.entries/,
    );
    // `entries` present but not an array used to reach .forEach and throw a
    // bare TypeError instead of our message
    expect(() => parseHar('{"log":{"entries":{}}}')).toThrow(
      /missing log.entries/,
    );
  });

  it("indexes entries in file order", () => {
    const parsed = parseHar(
      har([
        { request: { url: "https://a.test/" } },
        { request: { url: "https://b.test/" } },
      ]),
    );
    expect(parsed.log.entries.map((e) => e._index)).toEqual([0, 1]);
  });

  it("parses the request URL, tolerating an unparseable one", () => {
    const parsed = parseHar(
      har([
        { request: { url: "https://a.test/x?y=1" } },
        { request: { url: "not a url" } },
      ]),
    );
    expect(parsed.log.entries[0]._url?.hostname).toBe("a.test");
    expect(parsed.log.entries[1]._url).toBeNull();
  });

  // Everything below is a shape a real HAR generator produces and the old
  // parser passed straight through, crashing the renderer on first access.
  describe("normalizes structurally incomplete entries", () => {
    it("fills in a missing response (aborted request)", () => {
      const parsed = parseHar(har([{ request: { url: "https://a.test/" } }]));
      const entry = parsed.log.entries[0];
      expect(entry.response.status).toBe(0);
      expect(entry.response.content.mimeType).toBe("");
      expect(entry.response.headers).toEqual([]);
      expect(entry.response.cookies).toEqual([]);
      // The accessors that used to throw on this entry
      expect(getContentType(entry)).toBe("other");
      expect(getTransferSize(entry)).toBe(0);
    });

    it("fills in a missing request", () => {
      const parsed = parseHar(har([{ response: { status: 200 } }]));
      const entry = parsed.log.entries[0];
      expect(entry.request.method).toBe("");
      expect(entry.request.url).toBe("");
      expect(entry.request.headers).toEqual([]);
      expect(entry.request.queryString).toEqual([]);
      expect(entry._url).toBeNull();
      expect(() => getEntryName(entry)).not.toThrow();
    });

    it("fills in missing timings and cache", () => {
      const parsed = parseHar(har([{ request: { url: "https://a.test/" } }]));
      const entry = parsed.log.entries[0];
      expect(entry.timings).toEqual({ send: -1, wait: -1, receive: -1 });
      expect(entry.cache).toEqual({});
    });

    it("fills in a missing content object (304 with no body)", () => {
      const parsed = parseHar(
        har([
          {
            request: { url: "https://a.test/" },
            response: { status: 304, headers: [] },
          },
        ]),
      );
      const entry = parsed.log.entries[0];
      expect(entry.response.content).toEqual({ size: -1, mimeType: "" });
      expect(getContentType(entry)).toBe("other");
    });

    it("replaces null arrays rather than trusting the type", () => {
      const parsed = parseHar(
        har([
          {
            request: { url: "https://a.test/", headers: null, cookies: null },
            response: { status: 200, headers: null },
          },
        ]),
      );
      const entry = parsed.log.entries[0];
      expect(entry.request.headers).toEqual([]);
      expect(entry.request.cookies).toEqual([]);
      expect(entry.response.headers).toEqual([]);
    });

    it("coerces a non-numeric time", () => {
      const parsed = parseHar(
        har([
          { request: { url: "https://a.test/" }, time: null },
          { request: { url: "https://b.test/" } },
        ]),
      );
      expect(parsed.log.entries[0].time).toBe(0);
      expect(parsed.log.entries[1].time).toBe(0);
    });

    it("preserves values that are present", () => {
      const parsed = parseHar(
        har([
          {
            startedDateTime: "2026-01-01T00:00:00.000Z",
            time: 42,
            request: { url: "https://a.test/", method: "POST" },
            response: {
              status: 201,
              content: { size: 5, mimeType: "application/json" },
            },
            timings: { send: 1, wait: 2, receive: 3 },
          },
        ]),
      );
      const entry = parsed.log.entries[0];
      expect(entry.time).toBe(42);
      expect(entry.request.method).toBe("POST");
      expect(entry.response.status).toBe(201);
      expect(entry.timings).toEqual({ send: 1, wait: 2, receive: 3 });
      expect(getContentType(entry)).toBe("xhr");
    });

    it("summarizes a file of entirely incomplete entries", () => {
      const parsed = parseHar(
        har([{ request: { url: "https://a.test/" } }, {}, { response: {} }]),
      );
      const summary = computeSummary(parsed.log.entries);
      expect(summary.totalRequests).toBe(3);
      expect(Number.isFinite(summary.totalTransferSize)).toBe(true);
      expect(Number.isFinite(summary.totalTime)).toBe(true);
    });
  });
});
