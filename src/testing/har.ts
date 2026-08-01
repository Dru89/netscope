// Builders for synthetic HAR content in component tests. The fixtures under
// test/fixtures are real captures — good for E2E and for parsing edge cases,
// too big and too incidental to assert ordering against.
//
// Keep the entry count under the virtual table's minimum overscan (12) so
// every row renders in jsdom, where the viewport measures zero and the window
// falls back to that minimum.

export interface FakeEntry {
  url: string;
  /** Drives the Size column via response._transferSize. */
  size: number;
  method?: string;
  status?: number;
  /** Drives the Time column, in ms. */
  time?: number;
  mimeType?: string;
  startedDateTime?: string;
}

export function makeHar(entries: FakeEntry[]): string {
  return JSON.stringify({
    log: {
      version: "1.2",
      creator: { name: "netscope-tests", version: "1.0" },
      entries: entries.map((e, i) => ({
        startedDateTime:
          e.startedDateTime ??
          new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        time: e.time ?? 10,
        request: {
          method: e.method ?? "GET",
          url: e.url,
          httpVersion: "HTTP/1.1",
          headers: [],
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: e.status ?? 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          headers: [],
          cookies: [],
          content: {
            size: e.size,
            mimeType: e.mimeType ?? "application/javascript",
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: -1,
          _transferSize: e.size,
        },
        cache: {},
        timings: { send: 0, wait: e.time ?? 10, receive: 0 },
      })),
    },
  });
}
