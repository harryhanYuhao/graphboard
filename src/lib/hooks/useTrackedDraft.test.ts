// src/lib/hooks/useTrackedDraft.test.ts
//
// The hook's contract is small but easy to break — it tracks an
// external source of truth and resets a local draft only when the
// source drifts (or when an explicit `trackKey` flips). The
// `didReset` flag is only observable on the intermediate render
// that React discards ("set state during render" pattern), so the
// tests below focus on the observable outcome: does the draft
// converge to the new source after a re-render, or does it stay
// at the user's edit?

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTrackedDraft } from "./useTrackedDraft";

describe("useTrackedDraft", () => {
  it("returns the source as the initial draft", () => {
    const { result } = renderHook(() =>
      useTrackedDraft<string>({ source: "hello" }),
    );
    expect(result.current[0]).toBe("hello");
  });

  it("lets the user edit the draft locally without source changes", () => {
    const { result } = renderHook(() =>
      useTrackedDraft<string>({ source: "hello" }),
    );
    act(() => result.current[1]("edited"));
    expect(result.current[0]).toBe("edited");
  });

  it("accepts a functional updater in the setter", () => {
    const { result } = renderHook(() =>
      useTrackedDraft<number>({ source: 1 }),
    );
    act(() => result.current[1]((prev) => prev + 10));
    expect(result.current[0]).toBe(11);
  });

  it("resets the draft to the new source after a source change", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: string }) => useTrackedDraft({ source }),
      { initialProps: { source: "a" } },
    );
    expect(result.current[0]).toBe("a");

    act(() => result.current[1]("user edit"));

    rerender({ source: "b" });

    // React's "set state during render" pattern retries the render
    // with the queued setStates applied, so the final draft is the
    // new source (the intermediate render is discarded).
    expect(result.current[0]).toBe("b");
  });

  it("preserves a same-reference source update (no reset)", () => {
    // React props/state that didn't change should not trigger a
    // reset; otherwise continuous reads (e.g. an unchanged selector
    // subscription) would constantly blow away the user's draft.
    const shared = "stable";
    const { result, rerender } = renderHook(
      ({ source }: { source: string }) => useTrackedDraft({ source }),
      { initialProps: { source: shared } },
    );
    act(() => result.current[1]("user edit"));
    rerender({ source: shared });
    expect(result.current[0]).toBe("user edit");
  });

  it("does not reset when skipDriftCheck is true even if source drifted", () => {
    // Slider drag: the source updates *because* of the edit, so
    // resetting would force a re-render and reset the user's draft
    // to whatever the source became (which is what the user just
    // typed — so it would be a no-op write, but we want to verify
    // the draft isn't blown away).
    const { result, rerender } = renderHook(
      ({ source }: { source: number }) =>
        useTrackedDraft({ source, skipDriftCheck: true }),
      { initialProps: { source: 0 } },
    );
    act(() => result.current[1](5));
    rerender({ source: 5 });
    expect(result.current[0]).toBe(5);
  });

  it("resets when trackKey changes even if source value is unchanged", () => {
    // Two vertices could carry the same label but represent
    // different entities. The id-as-trackKey makes the reset fire on
    // selection change so the draft doesn't bleed across vertices.
    const { result, rerender } = renderHook(
      ({ trackKey }: { trackKey: string }) =>
        useTrackedDraft({ source: "same", trackKey }),
      { initialProps: { trackKey: "vertex-a" } },
    );
    act(() => result.current[1]("draft for a"));
    rerender({ trackKey: "vertex-b" });
    // After the React retry, the draft has been reset to the source.
    expect(result.current[0]).toBe("same");
  });

  it("does not reset when both source and trackKey are unchanged", () => {
    const { result, rerender } = renderHook(
      ({ source, trackKey }: { source: string; trackKey: string }) =>
        useTrackedDraft({ source, trackKey }),
      { initialProps: { source: "x", trackKey: "k" } },
    );
    act(() => result.current[1]("edited"));
    rerender({ source: "x", trackKey: "k" });
    expect(result.current[0]).toBe("edited");
  });
});