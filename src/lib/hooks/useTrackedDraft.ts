// "Track an external source-of-truth, keep a local draft the user can
// edit freely until the source changes." Used where a panel mirrors a
// value also editable through other UI (label input, rotation slider):
// updating the draft on every store change would clobber in-progress
// edits, never updating would show stale data after undo/external change.
//
// Implements the React "set state during render" pattern
// (https://react.dev/learn/you-might-not-need-an-effect). On drift it
// queues a reset and returns `didReset` so the consumer can bail and
// avoid a one-frame flash of stale data.

"use client";

import { useState } from "react";

export type UseTrackedDraftParams<T> = {
  /** External source-of-truth; the draft resets to it on change. */
  source: T;
  /** Identity key; reset when it changes even if `source` is unchanged (pass the entity id). */
  trackKey?: unknown;
  /** Skip drift check during continuous edits (slider drag) to avoid one-frame flicker. */
  skipDriftCheck?: boolean;
};

export type UseTrackedDraftResult<T> = readonly [
  draft: T,
  setDraft: (value: T | ((prev: T) => T)) => void,
  /** True on the render where a reset was queued; consumers typically bail this frame. */
  didReset: boolean,
];

export function useTrackedDraft<T>({
  source,
  trackKey,
  skipDriftCheck = false,
}: UseTrackedDraftParams<T>): UseTrackedDraftResult<T> {
  // Trackers start equal to the inputs so the first render isn't a reset.
  const [draft, setDraft] = useState<T>(source);
  const [trackedSource, setTrackedSource] = useState<T>(source);
  const [trackedKey, setTrackedKey] = useState<unknown>(trackKey);

  // `Object.is` (not `!==`) so NaN compares equal and can't loop
  // re-renders; object sources get reference equality.
  const driftDetected =
    !skipDriftCheck &&
    (!Object.is(trackedSource, source) || !Object.is(trackedKey, trackKey));

  // Reset during render; React queues the updates and re-renders
  // before painting, so this render still returns the old draft and
  // consumers should bail via `didReset`.
  if (driftDetected) {
    setTrackedSource(source);
    setTrackedKey(trackKey);
    setDraft(source);
  }

  return [draft, setDraft, driftDetected] as const;
}
