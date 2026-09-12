"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastData = {
  type: "error" | "info" | "success";
  message: string;
};

const STYLES: Record<
  ToastData["type"],
  { icon: typeof Info; iconClass: string; border: string }
> = {
  error: { icon: AlertCircle, iconClass: "text-red-500", border: "border-red-200" },
  info: { icon: Info, iconClass: "text-amber-600", border: "border-amber-200" },
  success: { icon: CheckCircle2, iconClass: "text-emerald-600", border: "border-emerald-200" },
};

export default function Toast({
  toast,
  onClose,
}: {
  toast: ToastData;
  onClose: () => void;
}) {
  const { icon: Icon, iconClass, border } = STYLES[toast.type];
  return (
    <div
      role="status"
      aria-live="polite"
      className="toast-enter fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2"
    >
      <div
        className={`flex items-start gap-3 rounded-xl border ${border} bg-white px-4 py-3 shadow-lg shadow-stone-900/10`}
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden />
        <p className="min-w-0 flex-1 text-sm leading-snug text-stone-700">
          {toast.message}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss notification"
          className="shrink-0 rounded-md p-0.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
