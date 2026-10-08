"use client";
export default function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return <button type="button" className="btn" onClick={() => window.print()}>{label}</button>;
}
