import type { HarEntry } from "../types/har";
import { getTransferSize, getEntryName } from "./har";

/**
 * Supported filter types that use the `key:value` syntax.
 * Modeled after Chrome DevTools Network panel filter syntax.
 */
export type FilterType =
  | "domain"
  | "method"
  | "status-code"
  | "mime-type"
  | "larger-than"
  | "scheme"
  | "has-response-header"
  | "url";

const FILTER_TYPES: Set<string> = new Set<string>([
  "domain",
  "method",
  "status-code",
  "mime-type",
  "larger-than",
  "scheme",
  "has-response-header",
  "url",
]);

export interface FilterToken {
  type: FilterType | "text";
  value: string;
  negated: boolean;
}

/**
 * Parse a filter query string into structured tokens.
 *
 * Supports:
 * - Plain text tokens: `api` matches against URL and entry name
 * - Typed filters: `domain:example.com`, `method:GET`, etc.
 * - Negation: `-domain:example.com` excludes matches
 * - Negated text: `-analytics` excludes entries matching "analytics"
 * - Quoted values: `domain:"my site.com"` for values containing spaces
 * - Multiple tokens separated by spaces (AND logic)
 */
export function parseFilterQuery(query: string): FilterToken[] {
  const tokens: FilterToken[] = [];
  let remaining = query.trim();

  while (remaining.length > 0) {
    // Skip leading whitespace
    remaining = remaining.trimStart();
    if (remaining.length === 0) break;

    // Check for negation prefix
    let negated = false;
    if (remaining.startsWith("-") && remaining.length > 1) {
      negated = true;
      remaining = remaining.slice(1);
    }

    // Try to match a typed filter (key:value)
    const colonIdx = findUnquotedColon(remaining);
    if (colonIdx > 0) {
      const key = remaining.slice(0, colonIdx).toLowerCase();
      if (FILTER_TYPES.has(key)) {
        remaining = remaining.slice(colonIdx + 1);
        const { value, rest } = extractValue(remaining);
        tokens.push({ type: key as FilterType, value, negated });
        remaining = rest;
        continue;
      }
    }

    // Plain text token
    const { value, rest } = extractValue(remaining);
    if (value.length > 0) {
      tokens.push({ type: "text", value, negated });
    }
    remaining = rest;
  }

  return tokens;
}

/**
 * Find the index of the first colon that appears before any whitespace.
 * Returns -1 if no colon is found before the first space.
 */
function findUnquotedColon(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ":") return i;
    if (s[i] === " ") return -1;
  }
  return -1;
}

/**
 * Extract a value from the beginning of a string.
 * Handles quoted values (single or double quotes) and unquoted values
 * (terminated by whitespace).
 */
function extractValue(s: string): { value: string; rest: string } {
  if (s.startsWith('"') || s.startsWith("'")) {
    const quote = s[0];
    const endIdx = s.indexOf(quote, 1);
    if (endIdx !== -1) {
      return { value: s.slice(1, endIdx), rest: s.slice(endIdx + 1) };
    }
    // No closing quote — treat the rest as the value
    return { value: s.slice(1), rest: "" };
  }
  // Unquoted: read until whitespace
  const spaceIdx = s.indexOf(" ");
  if (spaceIdx === -1) {
    return { value: s, rest: "" };
  }
  return { value: s.slice(0, spaceIdx), rest: s.slice(spaceIdx) };
}

/**
 * Parse a size string like "1k", "500", "2.5M" into bytes.
 * Supports k/K (kilobytes) and m/M (megabytes) suffixes.
 * Returns NaN if the string is not a valid size.
 */
export function parseSize(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([kmKM])?$/);
  if (!match) return NaN;
  const num = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === "k") return num * 1000;
  if (unit === "m") return num * 1000 * 1000;
  return num;
}

/**
 * Test whether a domain value matches an entry's hostname.
 * Supports glob-style wildcards:
 *   `*.example.com` matches `sub.example.com` and `example.com`
 *   `*.foo.*`       matches `api.foo.com` and `foo.org`
 *   `api.*`         matches `api.example.com`
 */
export function matchDomain(pattern: string, hostname: string): boolean {
  const p = pattern.toLowerCase();
  const h = hostname.toLowerCase();

  if (!p.includes("*")) {
    return h === p;
  }

  // General glob: convert `*` to `.*` for regex matching
  const regexStr =
    "^" +
    p
      .split("*")
      .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*") +
    "$";
  if (new RegExp(regexStr).test(h)) return true;

  // Special case: `*.suffix` should also match the bare `suffix` itself,
  // consistent with how Chrome DevTools treats domain wildcards.
  // e.g. `*.example.com` matches `example.com`, `*.foo.*` matches `foo.com`
  if (p.startsWith("*.")) {
    const suffixPattern = p.slice(2);
    return matchDomain(suffixPattern, h);
  }

  return false;
}

/**
 * Test whether a single filter token matches a HAR entry.
 */
export function matchToken(token: FilterToken, entry: HarEntry): boolean {
  const raw = matchTokenPositive(token, entry);
  return token.negated ? !raw : raw;
}

function matchTokenPositive(token: FilterToken, entry: HarEntry): boolean {
  const valueLower = token.value.toLowerCase();

  switch (token.type) {
    case "text": {
      const url = entry.request.url.toLowerCase();
      const name = getEntryName(entry).toLowerCase();
      return url.includes(valueLower) || name.includes(valueLower);
    }

    case "domain": {
      const hostname = entry._url?.hostname ?? "";
      return matchDomain(token.value, hostname);
    }

    case "method": {
      return entry.request.method.toLowerCase() === valueLower;
    }

    case "status-code": {
      const status = entry.response.status.toString();
      // Support range patterns like "4xx" or "5xx"
      if (valueLower.endsWith("xx")) {
        return status.startsWith(valueLower[0]);
      }
      return status === token.value;
    }

    case "mime-type": {
      const mime = entry.response.content.mimeType?.toLowerCase() ?? "";
      return mime.includes(valueLower);
    }

    case "larger-than": {
      const threshold = parseSize(token.value);
      if (isNaN(threshold)) return false;
      return getTransferSize(entry) > threshold;
    }

    case "scheme": {
      const scheme = entry._url?.protocol?.replace(":", "") ?? "";
      return scheme.toLowerCase() === valueLower;
    }

    case "has-response-header": {
      return entry.response.headers.some(
        (h) => h.name.toLowerCase() === valueLower,
      );
    }

    case "url": {
      return entry.request.url.toLowerCase().includes(valueLower);
    }

    default:
      return true;
  }
}

/**
 * Test whether a HAR entry matches all tokens in a parsed filter query.
 * All tokens are AND'd together.
 */
export function matchEntry(tokens: FilterToken[], entry: HarEntry): boolean {
  return tokens.every((token) => matchToken(token, entry));
}
