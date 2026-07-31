import type { Har, HarEntry, ContentType, SummaryStats } from "../types/har";

export function parseHar(content: string): Har {
  const parsed = JSON.parse(content);
  if (!parsed.log || !Array.isArray(parsed.log.entries)) {
    throw new Error("Invalid HAR file: missing log.entries");
  }
  parsed.log.entries.forEach(normalizeEntry);
  return parsed as Har;
}

// HAR generators in the wild routinely omit fields the spec marks required:
// aborted or blocked requests arrive with no `response`, proxies and
// hand-rolled exporters skip `timings`, `cache`, or the cookie/header arrays,
// and `content` can be missing entirely on a 304. The rest of the app reads
// these through the HarEntry type and would crash on the first access, taking
// the whole window down (an error boundary catches that, but a viewer should
// show the file, not an apology). So patch the entry up to something that
// actually satisfies its type, and let the missing values read as empty.
//
// Sentinels follow the HAR spec's own convention: -1 for "not available"
// sizes and timings, status 0 for a request that never got a response (what
// Chrome itself writes for failures).
function normalizeEntry(entry: HarEntry, index: number) {
  entry._index = index;

  const request = (entry.request ?? {}) as HarEntry["request"];
  request.method ??= "";
  request.url ??= "";
  request.httpVersion ??= "";
  request.headersSize ??= -1;
  request.bodySize ??= -1;
  if (!Array.isArray(request.cookies)) request.cookies = [];
  if (!Array.isArray(request.headers)) request.headers = [];
  if (!Array.isArray(request.queryString)) request.queryString = [];
  entry.request = request;

  const response = (entry.response ?? {}) as HarEntry["response"];
  response.status ??= 0;
  response.statusText ??= "";
  response.httpVersion ??= "";
  response.redirectURL ??= "";
  response.headersSize ??= -1;
  response.bodySize ??= -1;
  if (!Array.isArray(response.cookies)) response.cookies = [];
  if (!Array.isArray(response.headers)) response.headers = [];
  const content = (response.content ?? {}) as HarEntry["response"]["content"];
  content.size ??= -1;
  content.mimeType ??= "";
  response.content = content;
  entry.response = response;

  const timings = (entry.timings ?? {}) as HarEntry["timings"];
  timings.send ??= -1;
  timings.wait ??= -1;
  timings.receive ??= -1;
  entry.timings = timings;

  entry.cache ??= {};
  entry.startedDateTime ??= "";
  if (typeof entry.time !== "number" || !Number.isFinite(entry.time)) {
    entry.time = 0;
  }

  try {
    entry._url = new URL(request.url);
  } catch {
    entry._url = null;
  }
}

export function getContentType(entry: HarEntry): ContentType {
  const mimeType = entry.response.content.mimeType?.toLowerCase() || "";
  const url = entry.request.url.toLowerCase();

  if (mimeType.includes("html")) return "document";
  if (mimeType.includes("css")) return "stylesheet";
  if (mimeType.includes("javascript") || mimeType.includes("ecmascript"))
    return "script";
  if (mimeType.includes("image") || mimeType.includes("svg")) return "image";
  if (
    mimeType.includes("font") ||
    mimeType.includes("woff") ||
    mimeType.includes("ttf") ||
    mimeType.includes("otf")
  )
    return "font";
  if (mimeType.includes("json") || mimeType.includes("xml")) return "xhr";
  if (mimeType.includes("video") || mimeType.includes("audio")) return "media";
  if (mimeType.includes("manifest")) return "manifest";
  if (url.includes(".woff") || url.includes(".ttf") || url.includes(".otf"))
    return "font";
  if (
    url.includes(".png") ||
    url.includes(".jpg") ||
    url.includes(".gif") ||
    url.includes(".svg") ||
    url.includes(".ico") ||
    url.includes(".webp")
  )
    return "image";

  return "other";
}

export function getEntryName(entry: HarEntry): string {
  if (entry._url) {
    const pathname = entry._url.pathname;
    const parts = pathname.split("/");
    return parts[parts.length - 1] || entry._url.hostname + pathname;
  }
  return entry.request.url;
}

export function getEntryDomain(entry: HarEntry): string {
  if (entry._url) {
    return entry._url.hostname;
  }
  return "";
}

export function getTransferSize(entry: HarEntry): number {
  // Chrome exports set headersSize/bodySize to -1 and record the real
  // on-the-wire size in _transferSize; without this, Size/summary/
  // larger-than: read 0 for every modern Chrome capture.
  const transferSize = entry.response._transferSize;
  if (typeof transferSize === "number" && transferSize >= 0) {
    return transferSize;
  }
  const headersSize = Math.max(entry.response.headersSize, 0);
  const bodySize = Math.max(entry.response.bodySize, 0);
  return headersSize + bodySize;
}

export function getResourceSize(entry: HarEntry): number {
  return entry.response.content.size || 0;
}

export function isFromCache(entry: HarEntry): boolean {
  // Chrome records _transferSize: 0 when the response was served from disk cache
  if (
    entry.response._transferSize === 0 &&
    entry.response.status > 0 &&
    (entry.response.content.size > 0 || entry.response.bodySize === 0)
  ) {
    return true;
  }
  // Also check if bodySize is 0 or negative with content present (common in
  // HAR files from various sources)
  if (
    entry.response.bodySize <= 0 &&
    entry.response.headersSize <= 0 &&
    entry.response.status === 304
  ) {
    return true;
  }
  return false;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 0) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function formatTime(ms: number): string {
  if (ms < 0) return "-";
  if (ms < 1) return "< 1 ms";
  if (ms < 1000) return Math.round(ms) + " ms";
  if (ms < 60000) return (ms / 1000).toFixed(2) + " s";
  return (ms / 60000).toFixed(1) + " min";
}

export function formatTimestamp(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    } as Intl.DateTimeFormatOptions);
  } catch {
    return dateString;
  }
}

export function getStatusColor(status: number): string {
  // Status 0 (network error) renders as 4xx per the design spec
  if (status === 0) return "var(--ns-status-4xx)";
  if (status < 300) return "var(--ns-status-2xx)";
  if (status < 400) return "var(--ns-status-3xx)";
  if (status < 500) return "var(--ns-status-4xx)";
  return "var(--ns-status-5xx)";
}

export function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "var(--ns-method-get)";
    case "POST":
      return "var(--ns-method-post)";
    case "PUT":
      return "var(--ns-method-put)";
    case "DELETE":
      return "var(--ns-method-delete)";
    case "PATCH":
      return "var(--ns-method-patch)";
    default:
      return "var(--ns-text-muted)";
  }
}

export function computeTimingOffsets(entry: HarEntry) {
  const timings = entry.timings;
  const phases: {
    name: string;
    start: number;
    duration: number;
    color: string;
  }[] = [];
  let offset = 0;

  if (timings.blocked && timings.blocked > 0) {
    const queueing = timings._blocked_queueing;
    if (queueing != null && queueing > 0) {
      // Chrome-specific: split into Queueing + Stalled
      phases.push({
        name: "Queueing",
        start: offset,
        duration: queueing,
        color: "var(--ns-phase-blocked)",
      });
      offset += queueing;
      const stalled = timings.blocked - queueing;
      if (stalled > 0) {
        phases.push({
          name: "Stalled",
          start: offset,
          duration: stalled,
          color: "var(--ns-phase-blocked)",
        });
        offset += stalled;
      }
    } else {
      phases.push({
        name: "Blocked",
        start: offset,
        duration: timings.blocked,
        color: "var(--ns-phase-blocked)",
      });
      offset += timings.blocked;
    }
  }

  if (timings.dns && timings.dns > 0) {
    phases.push({
      name: "DNS",
      start: offset,
      duration: timings.dns,
      color: "var(--ns-phase-dns)",
    });
    offset += timings.dns;
  }

  if (timings.connect && timings.connect > 0) {
    // SSL is a subset of connect
    if (timings.ssl && timings.ssl > 0) {
      const tcpOnly = timings.connect - timings.ssl;
      if (tcpOnly > 0) {
        phases.push({
          name: "Connect",
          start: offset,
          duration: tcpOnly,
          color: "var(--ns-phase-connect)",
        });
        offset += tcpOnly;
      }
      phases.push({
        name: "TLS",
        start: offset,
        duration: timings.ssl,
        color: "var(--ns-phase-ssl)",
      });
      offset += timings.ssl;
    } else {
      phases.push({
        name: "Connect",
        start: offset,
        duration: timings.connect,
        color: "var(--ns-phase-connect)",
      });
      offset += timings.connect;
    }
  }

  if (timings.send > 0) {
    phases.push({
      name: "Send",
      start: offset,
      duration: timings.send,
      color: "var(--ns-phase-send)",
    });
    offset += timings.send;
  }

  if (timings.wait > 0) {
    phases.push({
      name: "Wait (TTFB)",
      start: offset,
      duration: timings.wait,
      color: "var(--ns-phase-wait)",
    });
    offset += timings.wait;
  }

  if (timings.receive > 0) {
    phases.push({
      name: "Receive",
      start: offset,
      duration: timings.receive,
      color: "var(--ns-phase-receive)",
    });
    offset += timings.receive;
  }

  return phases;
}

export function computeSummary(entries: HarEntry[]): SummaryStats {
  const requestsByType: Record<string, number> = {};
  const requestsByStatus: Record<string, number> = {};
  let totalTransferSize = 0;
  let totalUncompressedSize = 0;

  let minStart = Infinity;
  let maxEnd = -Infinity;

  entries.forEach((entry) => {
    const type = getContentType(entry);
    requestsByType[type] = (requestsByType[type] || 0) + 1;

    const statusBucket =
      entry.response.status === 0
        ? "error"
        : `${Math.floor(entry.response.status / 100)}xx`;
    requestsByStatus[statusBucket] = (requestsByStatus[statusBucket] || 0) + 1;

    totalTransferSize += getTransferSize(entry);
    totalUncompressedSize += getResourceSize(entry);

    const startTime = new Date(entry.startedDateTime).getTime();
    const endTime = startTime + entry.time;
    if (startTime < minStart) minStart = startTime;
    if (endTime > maxEnd) maxEnd = endTime;
  });

  return {
    totalRequests: entries.length,
    totalTransferSize,
    totalUncompressedSize,
    totalTime: maxEnd > minStart ? maxEnd - minStart : 0,
    requestsByType,
    requestsByStatus,
  };
}

export function getContentTypeIcon(type: ContentType): string {
  switch (type) {
    case "document":
      return "doc";
    case "stylesheet":
      return "css";
    case "script":
      return "js";
    case "image":
      return "img";
    case "font":
      return "font";
    case "xhr":
      return "xhr";
    case "fetch":
      return "fetch";
    case "media":
      return "media";
    case "websocket":
      return "ws";
    case "manifest":
      return "manifest";
    default:
      return "other";
  }
}

export function prettyPrintJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function detectLanguage(
  mimeType: string,
): "json" | "html" | "css" | "javascript" | "xml" | "text" {
  const mime = mimeType.toLowerCase();
  if (mime.includes("json")) return "json";
  if (mime.includes("html")) return "html";
  if (mime.includes("css")) return "css";
  if (mime.includes("javascript") || mime.includes("ecmascript"))
    return "javascript";
  if (mime.includes("xml") || mime.includes("svg")) return "xml";
  return "text";
}
