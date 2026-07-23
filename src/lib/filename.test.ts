// src/lib/filename.test.ts
//
// `toSafeFilename` sanitizes a document title into a filesystem-safe
// basename. The rules (illegal-char replacement, whitespace collapse,
// length cap) are an implicit contract for JSON export — pin them so a
// change to the sanitizer can't quietly start emitting broken filenames.

import { describe, expect, it } from "vitest";
import { toSafeFilename } from "./filename";

describe("toSafeFilename", () => {
  it("trims leading and trailing whitespace", () => {
    expect(toSafeFilename("  graph-board  ")).toBe("graph-board");
  });

  it("passes through a clean name unchanged", () => {
    expect(toSafeFilename("my-graph")).toBe("my-graph");
  });

  it.each([
    ["<", "-"],
    [">", "-"],
    [":", "-"],
    ['"', "-"],
    ["/", "-"],
    ["\\", "-"],
    ["|", "-"],
    ["?", "-"],
    ["*", "-"],
  ])("replaces illegal char %s with a dash", (input, expected) => {
    expect(toSafeFilename(input)).toBe(expected);
  });

  it("replaces every illegal char in a mixed string", () => {
    expect(toSafeFilename("a<b>c:d\"e/f\\g|h?i*j")).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("collapses runs of internal whitespace to a single space", () => {
    expect(toSafeFilename("my  \t graph")).toBe("my graph");
  });

  it("truncates to 80 characters", () => {
    const long = "x".repeat(120);
    expect(toSafeFilename(long)).toHaveLength(80);
    expect(toSafeFilename(long)).toBe("x".repeat(80));
  });

  it("truncates after sanitizing, so a replaced dash still counts", () => {
    // 79 legal chars + one illegal char: sanitize first (80 chars), then
    // slice(0,80) keeps all 80.
    const input = "y".repeat(79) + "<";
    expect(toSafeFilename(input)).toBe("y".repeat(79) + "-");
    expect(toSafeFilename(input)).toHaveLength(80);
  });

  it("returns the empty string for an empty input (pinned)", () => {
    // No fallback here — the caller guards with `state.title || "graph-board"`.
    // Pin the current behavior so a future change is intentional.
    expect(toSafeFilename("")).toBe("");
  });

  it("returns dashes for an all-illegal-char input (pinned)", () => {
    expect(toSafeFilename("<>:")).toBe("---");
  });
});
