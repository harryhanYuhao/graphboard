// src/components/graph-editor/TabBar.tsx
//
// The tab strip: one chip per tab (click to switch, double-click to rename,
// × to close), plus a "+" button. Tab state lives in the store (the bar is a
// pure projection), so this component is thin.

"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useGraphStore } from "@/store/graph-store";

// Inline rename input. Commits on Enter/blur (only when the name actually
// changed), cancels on Escape. The `done` ref stops the blur-after-Enter
// double commit.
function TabRenameInput(props: {
  tabId: string;
  initialName: string;
  onDone: () => void;
}) {
  const renameTab = useGraphStore((state) => state.renameTab);
  const [value, setValue] = useState(props.initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== props.initialName) {
      renameTab(props.tabId, trimmed);
    }
    props.onDone();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") props.onDone();
      }}
      onClick={(event) => event.stopPropagation()}
      aria-label="Tab name"
      className="w-28 rounded border border-slate-400 px-1 py-0.5 text-xs font-normal text-white outline-none focus:ring-2 focus:ring-slate-300"
    />
  );
}

export function TabBar() {
  const tabs = useGraphStore(useShallow((state) => state.tabs));
  const activeTabId = useGraphStore((state) => state.activeTabId);
  const switchTab = useGraphStore((state) => state.switchTab);
  const addTab = useGraphStore((state) => state.addTab);
  const closeTab = useGraphStore((state) => state.closeTab);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div
      role="tablist"
      aria-label="Graph tabs"
      className="flex h-10 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={tab.name}
            onClick={() => {
              if (!active) switchTab(tab.id);
            }}
            onDoubleClick={() => setEditingId(tab.id)}
            className={[
              "group flex h-7 max-w-44 cursor-pointer select-none items-center gap-1 rounded-md border px-2.5 text-xs font-medium",
              active
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-900 hover:bg-slate-100",
            ].join(" ")}
          >
            {editingId === tab.id ? (
              <TabRenameInput
                tabId={tab.id}
                initialName={tab.name}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <span className="truncate">{tab.name}</span>
            )}
            <button
              type="button"
              title="Close tab"
              aria-label={`Close tab ${tab.name}`}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              className={[
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm",
                active
                  ? "text-slate-300 hover:bg-slate-700 hover:text-white"
                  : "text-slate-400 hover:bg-slate-200 hover:text-slate-900",
              ].join(" ")}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        title="New tab"
        aria-label="New tab"
        onClick={addTab}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
