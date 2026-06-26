import { describe, expect, it } from "vitest";
import { htmlToText, truncateText } from "../src/lib/html.js";

describe("html helpers", () => {
  it("strips html to plain text", () => {
    expect(htmlToText("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  it("handles empty html", () => {
    expect(htmlToText(null)).toBe("");
  });

  it("truncates long text", () => {
    expect(truncateText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi...");
  });

  it("keeps short text as-is", () => {
    expect(truncateText("short", 10)).toBe("short");
  });
});
