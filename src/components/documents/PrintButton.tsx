"use client";

import { Printer } from "lucide-react";

/** Saves or prints a customer document from the public share page. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg bg-matesther-800 px-3 py-2 text-sm font-semibold text-white hover:bg-matesther-900"
    >
      <Printer className="h-4 w-4" /> Print / Save as PDF
    </button>
  );
}
