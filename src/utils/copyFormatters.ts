import type { HarEntry } from "../types/har";

/**
 * Headers that browsers manage automatically and strip from fetch() calls.
 * The Node.js fetch variant includes these; the browser variant omits them.
 */
const BROWSER_FORBIDDEN_HEADERS = new Set([
  "accept-encoding",
  "accept-language",
  "connection",
  "cookie",
  "host",
  "origin",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "upgrade-insecure-requests",
  "user-agent",
]);

/**
 * Pseudo-headers and internal headers that should be excluded from all
 * copy formats. Chrome DevTools records these in HAR but they aren't
 * real request headers.
 */
const PSEUDO_HEADERS = new Set([":authority", ":method", ":path", ":scheme"]);

function getHeaders(entry: HarEntry): { name: string; value: string }[] {
  return entry.request.headers.filter(
    (h) => !PSEUDO_HEADERS.has(h.name.toLowerCase()),
  );
}

function getBody(entry: HarEntry): string | undefined {
  return entry.request.postData?.text;
}

/**
 * Escape a string for use inside single quotes in a shell command.
 * Replaces `'` with `'\''` (end quote, escaped quote, start quote).
 */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

// ---------------------------------------------------------------------------
// cURL
// ---------------------------------------------------------------------------

/**
 * Format a HAR entry as a cURL command.
 *
 * Produces output like:
 *   curl 'https://example.com/api' \
 *     -X POST \
 *     -H 'Content-Type: application/json' \
 *     --data-raw '{"key":"value"}'
 */
export function toCurl(entry: HarEntry): string {
  const parts: string[] = [`curl '${shellEscape(entry.request.url)}'`];

  const method = entry.request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    parts.push(`-X ${method}`);
  }

  for (const h of getHeaders(entry)) {
    parts.push(`-H '${shellEscape(h.name)}: ${shellEscape(h.value)}'`);
  }

  const body = getBody(entry);
  if (body) {
    parts.push(`--data-raw '${shellEscape(body)}'`);
  }

  return parts.join(" \\\n  ");
}

// ---------------------------------------------------------------------------
// fetch (browser)
// ---------------------------------------------------------------------------

/**
 * Format a HAR entry as a browser fetch() call.
 * Omits browser-managed headers that would be ignored or rejected.
 */
export function toFetch(entry: HarEntry): string {
  return buildFetch(entry, true);
}

/**
 * Format a HAR entry as a Node.js fetch() call.
 * Includes all headers since Node.js doesn't enforce browser restrictions.
 */
export function toFetchNode(entry: HarEntry): string {
  return buildFetch(entry, false);
}

function buildFetch(entry: HarEntry, browserMode: boolean): string {
  const method = entry.request.method.toUpperCase();
  const headers = getHeaders(entry).filter(
    (h) => !browserMode || !BROWSER_FORBIDDEN_HEADERS.has(h.name.toLowerCase()),
  );
  const body = getBody(entry);

  const options: string[] = [];

  if (method !== "GET") {
    options.push(`  method: ${JSON.stringify(method)},`);
  }

  if (headers.length > 0) {
    const headerLines = headers.map(
      (h) => `    ${JSON.stringify(h.name)}: ${JSON.stringify(h.value)},`,
    );
    options.push(`  headers: {\n${headerLines.join("\n")}\n  },`);
  }

  if (body) {
    options.push(`  body: ${JSON.stringify(body)},`);
  }

  if (options.length === 0) {
    return `fetch(${JSON.stringify(entry.request.url)});`;
  }

  return `fetch(${JSON.stringify(entry.request.url)}, {\n${options.join("\n")}\n});`;
}

// ---------------------------------------------------------------------------
// PowerShell
// ---------------------------------------------------------------------------

/**
 * Format a HAR entry as a PowerShell Invoke-WebRequest command.
 *
 * Produces output like:
 *   Invoke-WebRequest -Uri "https://example.com/api" `
 *     -Method POST `
 *     -Headers @{ "Content-Type" = "application/json" } `
 *     -Body '{"key":"value"}'
 */
export function toPowerShell(entry: HarEntry): string {
  const parts: string[] = [`Invoke-WebRequest -Uri "${entry.request.url}"`];

  const method = entry.request.method.toUpperCase();
  if (method !== "GET") {
    parts.push(`-Method ${method}`);
  }

  const headers = getHeaders(entry);
  if (headers.length > 0) {
    const pairs = headers.map(
      (h) => `"${h.name}" = "${h.value.replace(/"/g, '`"')}"`,
    );
    if (pairs.length === 1) {
      parts.push(`-Headers @{ ${pairs[0]} }`);
    } else {
      parts.push(`-Headers @{\n    ${pairs.join("\n    ")}\n  }`);
    }
  }

  const body = getBody(entry);
  if (body) {
    // Use single quotes for the body to avoid PowerShell string interpolation
    parts.push(`-Body '${body.replace(/'/g, "''")}'`);
  }

  return parts.join(" `\n  ");
}

// ---------------------------------------------------------------------------
// Response body
// ---------------------------------------------------------------------------

/**
 * Extract the response body text from a HAR entry.
 * Returns the decoded text, or an empty string if not available.
 */
export function getResponseBody(entry: HarEntry): string {
  const content = entry.response.content;
  if (!content.text) return "";

  // If the content is base64-encoded, decode it
  if (content.encoding === "base64") {
    try {
      return atob(content.text);
    } catch {
      return content.text;
    }
  }

  return content.text;
}
