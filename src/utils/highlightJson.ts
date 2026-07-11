// Convert (pretty-printed) JSON text into HTML with syntax-tint classes for
// the Response tab. Colors come from the design tokens via CSS classes:
//   .json-key → --ns-method-get      .json-string → --ns-status-2xx
//   .json-number → --ns-method-put   .json-bool → --ns-method-patch
// Punctuation stays unwrapped and takes the container's --ns-text-muted.

const TOKEN_PATTERN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function highlightJson(json: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of json.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    result += escapeHtml(json.slice(lastIndex, index));

    const [full, string, colon, keyword] = match;
    if (string !== undefined) {
      const cls = colon !== undefined ? "json-key" : "json-string";
      result += `<span class="${cls}">${escapeHtml(string)}</span>`;
      if (colon !== undefined) result += escapeHtml(colon);
    } else if (keyword !== undefined) {
      result += `<span class="json-bool">${keyword}</span>`;
    } else {
      result += `<span class="json-number">${escapeHtml(full)}</span>`;
    }
    lastIndex = index + full.length;
  }
  result += escapeHtml(json.slice(lastIndex));
  return result;
}
