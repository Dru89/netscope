import { describe, it, expect } from "vitest";
import { highlightJson } from "./highlightJson";

describe("highlightJson", () => {
  it("wraps object keys and string values differently", () => {
    const html = highlightJson('{ "name": "value" }');
    expect(html).toContain('<span class="json-key">&quot;name&quot;</span>');
    expect(html).toContain(
      '<span class="json-string">&quot;value&quot;</span>',
    );
  });

  it("wraps numbers, booleans, and null", () => {
    const html = highlightJson('{ "a": 1.5e-3, "b": true, "c": null }');
    expect(html).toContain('<span class="json-number">1.5e-3</span>');
    expect(html).toContain('<span class="json-bool">true</span>');
    expect(html).toContain('<span class="json-bool">null</span>');
  });

  it("treats negative numbers as numbers", () => {
    expect(highlightJson("[-42]")).toContain(
      '<span class="json-number">-42</span>',
    );
  });

  it("escapes HTML inside strings", () => {
    const html = highlightJson('{ "x": "<script>&" }');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;&amp;");
  });

  it("does not treat string contents that look like keywords as keywords", () => {
    const html = highlightJson('{ "s": "true story" }');
    expect(html).toContain(
      '<span class="json-string">&quot;true story&quot;</span>',
    );
  });

  it("handles escaped quotes inside strings", () => {
    const html = highlightJson('{ "quote": "she said \\"hi\\"" }');
    expect(html).toContain("json-string");
    expect(html).toContain("\\&quot;hi\\&quot;");
  });

  it("leaves punctuation unwrapped", () => {
    const html = highlightJson("[1]");
    expect(html.startsWith("[")).toBe(true);
    expect(html.endsWith("]")).toBe(true);
  });
});
