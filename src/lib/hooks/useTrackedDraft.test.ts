// `useTrackedDraft` tracks an external source and resets the local draft only
// when the source drifts (or `trackKey` flips). The `didReset` flag is only
// observable on the render React discards ("set state during render"), so
// tests assert the outcome: does the draft converge to the new source or
// keep the user's edit?

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

    // React's retry render applies the queued setState, so the draft
    // converges to the new source.
    expect(result.current[0]).toBe("b");
  });

  it("preserves a same-reference source update (no reset)", () => {
    // An unchanged reference must not reset, or continuous selector
    // reads would blow away the draft.
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
    // Slider drag: the source updates because of the edit, so resetting would
    // blow away the draft mid-gesture.
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
    // Two vertices can share a label but be different entities; id-as-trackKey
    // resets on selection change so the draft doesn't bleed across vertices.
    const { result, rerender } = renderHook(
      ({ trackKey }: { trackKey: string }) =>
        useTrackedDraft({ source: "same", trackKey }),
      { initialProps: { trackKey: "vertex-a" } },
    );
    act(() => result.current[1]("draft for a"));
    rerender({ trackKey: "vertex-b" });
    // After the retry, the draft has reset to the source.
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

  // Documented limitation: the drift check is a reference comparison, so a
  // structurally-equal object passed as a new instance every render triggers a
  // reset each time. The hook targets primitives (label, rotation). Pinned so a
  // switch to deep equality is a deliberate change.
  it("an object source with a new instance every render resets the draft each time", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: { x: number } }) =>
        useTrackedDraft({ source }),
      { initialProps: { source: { x: 1 } } },
    );
    expect(result.current[0]).toEqual({ x: 1 });

    act(() => result.current[1]({ x: 999 }));

    // A new-instance but structurally-equal object: reference inequality resets.
    rerender({ source: { x: 1 } });

    // The draft reset to the source; the user's edit is gone.
    expect(result.current[0]).toEqual({ x: 1 });
  });

  // Companion: the same reference across renders is fine (no reset). The
  // workaround for the limitation above is "memoize the object in the parent".
  it("an object source that is the SAME reference across renders does not reset", () => {
    const shared = { x: 1 };
    const { result, rerender } = renderHook(
      ({ source }: { source: { x: number } }) =>
        useTrackedDraft({ source }),
      { initialProps: { source: shared } },
    );
    act(() => result.current[1]({ x: 999 }));
    rerender({ source: shared });
    expect(result.current[0]).toEqual({ x: 999 });
  });

  // Numeric source: a number re-rendered with the same value is a no-op via ===.
  it("a numeric source with the same value is a no-op", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: number }) => useTrackedDraft({ source }),
      { initialProps: { source: 42 } },
    );
    act(() => result.current[1](100));
    rerender({ source: 42 });
    expect(result.current[0]).toBe(100);
  });

  // `Object.is(NaN, NaN)` is true, so a NaN source compares equal to itself
  // and the drift check does NOT fire (avoiding the "Too many re-renders" loop
  // a `!==` check would cause). The user's edit is preserved.
  it("a NaN source: drift check does NOT fire (Object.is handles NaN correctly)", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: number }) => useTrackedDraft({ source }),
      { initialProps: { source: NaN } },
    );
    // Initial render: trackedSource === source (both NaN).
    expect(Number.isNaN(result.current[0])).toBe(true);

    act(() => result.current[1](42));
    // Re-render with the same NaN: Object.is is true → no drift, edit preserved.
    rerender({ source: NaN });
    expect(result.current[0]).toBe(42);
  });
});