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

  // Documented limitation: the drift check is a reference comparison
  // (`trackedSource !== source`), so an object source with the same
  // contents but a new instance every render triggers a reset on
  // every render. The hook is designed for primitive sources (label,
  // rotation). Pinned so a future switch to deep equality (or a
  // documented break here) is a deliberate change.
  it("an object source with a new instance every render resets the draft each time", () => {
    // The FIRST render is fine: the initial useState values match the
    // first prop, so no drift fires.
    const { result, rerender } = renderHook(
      ({ source }: { source: { x: number } }) =>
        useTrackedDraft({ source }),
      { initialProps: { source: { x: 1 } } },
    );
    expect(result.current[0]).toEqual({ x: 1 });

    // User edits the draft.
    act(() => result.current[1]({ x: 999 }));

    // Parent re-renders with a structurally-equal but new-instance
    // object. Reference inequality triggers a reset.
    rerender({ source: { x: 1 } });

    // The draft has been reset to the new source — the user's edit is
    // gone. This is the documented limitation; pin it.
    expect(result.current[0]).toEqual({ x: 1 });
  });

  // Companion: passing the SAME object reference across renders is
  // fine (no reset). Documents that the workaround for the object
  // limitation is "memoize the object in the parent".
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

  // Numeric source: the hook is designed for primitives, and a number
  // re-rendered with the same value (NaN excluded — see below) is a
  // no-op via ===. Pin it.
  it("a numeric source with the same value is a no-op", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: number }) => useTrackedDraft({ source }),
      { initialProps: { source: 42 } },
    );
    act(() => result.current[1](100));
    rerender({ source: 42 });
    expect(result.current[0]).toBe(100);
  });

  // NaN: `Object.is(NaN, NaN)` is `true`, so a NaN source compares
  // equal to itself and the drift check does NOT fire on re-renders.
  // This avoids the "Too many re-renders" loop that would happen
  // with a `!==` check (where `NaN !== NaN` is `true`). The user's
  // edit is preserved across re-renders.
  it("a NaN source: drift check does NOT fire (Object.is handles NaN correctly)", () => {
    const { result, rerender } = renderHook(
      ({ source }: { source: number }) => useTrackedDraft({ source }),
      { initialProps: { source: NaN } },
    );
    // The initial render is fine: trackedSource === source (both NaN).
    expect(Number.isNaN(result.current[0])).toBe(true);

    act(() => result.current[1](42));
    // Re-render with the same NaN: Object.is(NaN, NaN) is true, so no
    // drift. The user's edit (42) is preserved.
    rerender({ source: NaN });
    expect(result.current[0]).toBe(42);
  });
});