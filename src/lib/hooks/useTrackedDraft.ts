// src/lib/hooks/useTrackedDraft.ts
//
// "Track an external source-of-truth, but keep a local draft the user
// can edit freely until the source changes." The pattern shows up
// anywhere a panel mirrors a value the user can also edit through
// other UI (e.g. the property panel's label input, the rotation
// slider). Updating the draft on every store change would clobber
// the user's in-progress edit; *never* updating it would leave the
// panel showing stale data after an undo or external change.
//
// The hook implements the React-recommended "set state during
// render" pattern (https://react.dev/learn/you-might-not-need-an-effect
// — the replacement for `useEffect` that just mirrors props into
// state). On drift it queues the state updates and returns a
// `didReset` flag so the consumer can bail this render and avoid a
// one-frame flash of stale data.

"use client";

import { useState } from "react";

export type UseTrackedDraftParams<T> = {
  // The external source-of-truth value. When this changes (and
  // `skipDriftCheck` is false), the draft is reset to match.
  source: T;
  // Optional identity key. When this changes, the draft is reset
  // to `source` even if `source` itself is unchanged — useful when
  // the same source value could belong to different entities (e.g.
  // two vertices with the same label). Pass the entity id here.
  trackKey?: unknown;
  // Skip the drift check. Pass `true` during continuous edits
  // (slider drag) where the source updates from the same edit;
  // resetting then would force a one-frame bail and cause a brief
  // panel flicker.
  skipDriftCheck?: boolean;
};

export type UseTrackedDraftResult<T> = readonly [
  // The current draft value. Equal to `source` after a reset, equal
  // to whatever the user typed otherwise.
  draft: T,
  // Setter for the draft. Same shape as `useState`'s setter.
  setDraft: (value: T | ((prev: T) => T)) => void,
  // True for the render in which the hook queued a reset. Consumers
  // typically `return null` (or otherwise bail) when this is true
  // so the panel doesn't flash stale data for one frame before the
  // reset takes effect on the next render.
  didReset: boolean,
];

export function useTrackedDraft<T>({
  source,
  trackKey,
  skipDriftCheck = false,
}: UseTrackedDraftParams<T>): UseTrackedDraftResult<T> {
  // `trackedSource` / `trackedKey` are the "last seen" values we use
  // to detect drift. They start equal to the inputs so the very
  // first render isn't a false-positive reset.
  const [draft, setDraft] = useState<T>(source);
  const [trackedSource, setTrackedSource] = useState<T>(source);
  const [trackedKey, setTrackedKey] = useState<unknown>(trackKey);

  const driftDetected =
    !skipDriftCheck &&
    (trackedSource !== source || trackedKey !== trackKey);

  // Reset the draft + trackers during render. React queues these
  // setState calls and re-renders before painting; the current
  // render returns the old `draft` value, so consumers should bail
  // (via `didReset`) to avoid a one-frame flash.
  if (driftDetected) {
    setTrackedSource(source);
    setTrackedKey(trackKey);
    setDraft(source);
  }

  return [draft, setDraft, driftDetected] as const;
}
