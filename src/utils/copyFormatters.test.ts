import { describe, it, expect } from "vitest";
import {
  toCurl,
  toFetch,
  toFetchNode,
  toPowerShell,
  getResponseBody,
} from "./copyFormatters";
import type { HarEntry } from "../types/har";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: {
  url?: string;
  method?: string;
  headers?: { name: string; value: string }[];
  postData?: { mimeType: string; text?: string };
  responseText?: string;
  responseEncoding?: string;
}): HarEntry {
  const url = overrides.url ?? "https://example.com/api/data";
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  return {
    startedDateTime: "2024-01-01T00:00:00.000Z",
    time: 100,
    request: {
      method: overrides.method ?? "GET",
      url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: overrides.headers ?? [],
      queryString: [],
      postData: overrides.postData,
      headersSize: 0,
      bodySize: 0,
    },
    response: {
      status: 200,
      statusText: "OK",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: [],
      content: {
        size: 0,
        mimeType: "application/json",
        text: overrides.responseText,
        encoding: overrides.responseEncoding,
      },
      redirectURL: "",
      headersSize: 0,
      bodySize: 0,
    },
    cache: {},
    timings: { send: 1, wait: 50, receive: 10 },
    _index: 0,
    _url: parsedUrl,
  };
}

// ===========================================================================
// toCurl
// ===========================================================================

describe("toCurl", () => {
  it("formats a simple GET request", () => {
    const entry = makeEntry({});
    const result = toCurl(entry);
    expect(result).toBe("curl 'https://example.com/api/data'");
  });

  it("includes method for non-GET requests", () => {
    const entry = makeEntry({ method: "POST" });
    const result = toCurl(entry);
    expect(result).toContain("-X POST");
  });

  it("does not include -X for GET", () => {
    const entry = makeEntry({ method: "GET" });
    expect(toCurl(entry)).not.toContain("-X");
  });

  it("includes headers", () => {
    const entry = makeEntry({
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "Authorization", value: "Bearer token123" },
      ],
    });
    const result = toCurl(entry);
    expect(result).toContain("-H 'Content-Type: application/json'");
    expect(result).toContain("-H 'Authorization: Bearer token123'");
  });

  it("includes request body", () => {
    const entry = makeEntry({
      method: "POST",
      postData: { mimeType: "application/json", text: '{"key":"value"}' },
    });
    const result = toCurl(entry);
    expect(result).toContain('--data-raw \'{"key":"value"}\'');
  });

  it("escapes single quotes in URL", () => {
    const entry = makeEntry({ url: "https://example.com/api?q=it's" });
    const result = toCurl(entry);
    expect(result).toContain("it'\\''s");
  });

  it("filters out HTTP/2 pseudo-headers", () => {
    const entry = makeEntry({
      headers: [
        { name: ":authority", value: "example.com" },
        { name: ":method", value: "GET" },
        { name: ":path", value: "/api/data" },
        { name: ":scheme", value: "https" },
        { name: "Accept", value: "application/json" },
      ],
    });
    const result = toCurl(entry);
    expect(result).not.toContain(":authority");
    expect(result).not.toContain(":method");
    expect(result).toContain("Accept: application/json");
  });
});

// ===========================================================================
// toFetch (browser)
// ===========================================================================

describe("toFetch", () => {
  it("formats a simple GET request", () => {
    const entry = makeEntry({});
    const result = toFetch(entry);
    expect(result).toBe('fetch("https://example.com/api/data");');
  });

  it("includes method for non-GET", () => {
    const entry = makeEntry({ method: "POST" });
    const result = toFetch(entry);
    expect(result).toContain('method: "POST"');
  });

  it("omits browser-forbidden headers", () => {
    const entry = makeEntry({
      headers: [
        { name: "User-Agent", value: "Mozilla/5.0" },
        { name: "Cookie", value: "session=abc" },
        { name: "Accept", value: "application/json" },
        { name: "Host", value: "example.com" },
      ],
    });
    const result = toFetch(entry);
    expect(result).not.toContain("User-Agent");
    expect(result).not.toContain("Cookie");
    expect(result).not.toContain("Host");
    expect(result).toContain("Accept");
  });

  it("includes request body", () => {
    const body = '{"key":"value"}';
    const entry = makeEntry({
      method: "POST",
      postData: { mimeType: "application/json", text: body },
    });
    const result = toFetch(entry);
    expect(result).toContain(`body: ${JSON.stringify(body)}`);
  });
});

// ===========================================================================
// toFetchNode
// ===========================================================================

describe("toFetchNode", () => {
  it("includes browser-forbidden headers", () => {
    const entry = makeEntry({
      headers: [
        { name: "User-Agent", value: "Mozilla/5.0" },
        { name: "Cookie", value: "session=abc" },
        { name: "Accept", value: "application/json" },
      ],
    });
    const result = toFetchNode(entry);
    expect(result).toContain("User-Agent");
    expect(result).toContain("Cookie");
    expect(result).toContain("Accept");
  });

  it("still filters out pseudo-headers", () => {
    const entry = makeEntry({
      headers: [
        { name: ":authority", value: "example.com" },
        { name: "Accept", value: "application/json" },
      ],
    });
    const result = toFetchNode(entry);
    expect(result).not.toContain(":authority");
    expect(result).toContain("Accept");
  });
});

// ===========================================================================
// toPowerShell
// ===========================================================================

describe("toPowerShell", () => {
  it("formats a simple GET request", () => {
    const entry = makeEntry({});
    const result = toPowerShell(entry);
    expect(result).toBe(
      'Invoke-WebRequest -Uri "https://example.com/api/data"',
    );
  });

  it("includes method for non-GET", () => {
    const entry = makeEntry({ method: "POST" });
    const result = toPowerShell(entry);
    expect(result).toContain("-Method POST");
  });

  it("includes headers", () => {
    const entry = makeEntry({
      headers: [{ name: "Accept", value: "application/json" }],
    });
    const result = toPowerShell(entry);
    expect(result).toContain('-Headers @{ "Accept" = "application/json" }');
  });

  it("includes request body", () => {
    const entry = makeEntry({
      method: "POST",
      postData: { mimeType: "application/json", text: '{"key":"value"}' },
    });
    const result = toPowerShell(entry);
    expect(result).toContain('-Body \'{"key":"value"}\'');
  });

  it("escapes single quotes in body", () => {
    const entry = makeEntry({
      method: "POST",
      postData: { mimeType: "text/plain", text: "it's a test" },
    });
    const result = toPowerShell(entry);
    expect(result).toContain("it''s a test");
  });
});

// ===========================================================================
// getResponseBody
// ===========================================================================

describe("getResponseBody", () => {
  it("returns plain text response", () => {
    const entry = makeEntry({ responseText: '{"result":true}' });
    expect(getResponseBody(entry)).toBe('{"result":true}');
  });

  it("decodes base64 response", () => {
    const entry = makeEntry({
      responseText: btoa("hello world"),
      responseEncoding: "base64",
    });
    expect(getResponseBody(entry)).toBe("hello world");
  });

  it("returns empty string when no content", () => {
    const entry = makeEntry({});
    expect(getResponseBody(entry)).toBe("");
  });
});
