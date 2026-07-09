// src/components/graph-editor/ConfirmationDialog.tsx
//
// The store owns the dialogue state
// (`confirmDialogue: ConfirmDialogueState | null`); this component
// is purely presentational. 
// Must be a client component because it uses React hooks 

"use client";

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmButtonClassName?: string;
}

export function ConfirmationDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  confirmButtonClassName = 'bg-red-600 hover:bg-red-700',
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus management
  useEffect(() => {
    if (isOpen && dialogRef.current) {
      // Focus cancel button by default
      cancelRef.current?.focus();
    }
  }, [isOpen]);

  // Handle keyboard events. Enter is left to the browser so the focused
  // button's native click handler fires exactly once — intercepting Enter
  // here too would double-fire onConfirm / onCancel.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 transition-opacity"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl transition-transform transform"
        onKeyDown={handleKeyDown}
      >
        {/* Close button */}
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 p-1 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>

        {/* Dialog content */}
        <div className="space-y-4">
          <h2
            id="dialog-title"
            className="text-xl font-semibold text-gray-900"
          >
            {title}
          </h2>

          <p
            id="dialog-description"
            className="text-gray-600"
          >
            {message}
          </p>
        </div>

        {/* Dialog buttons */}
        <div className="mt-6 flex justify-end space-x-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors font-medium"
          >
            {cancelText}
          </button>

          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 text-white rounded-md transition-colors font-medium ${confirmButtonClassName}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
