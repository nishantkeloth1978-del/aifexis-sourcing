// Demo data only (from Reference Scenarios). Replaced by real queries once login is wired.
export interface DemoEvent { ref: string; title: string; owner: string; closes: string; currency: string; status: "Draft" | "Open" | "Evaluating" | "Awarded" | "Cancelled"; value: string; saving: string }
export const DEMO_EVENTS: DemoEvent[] = [
  { ref: "EV-2026-014", title: "Process pump set API 610", owner: "Procurement", closes: "21 Oct 2026", currency: "AED", status: "Open", value: "AED 1,240,000.00", saving: "AED 0.00" },
  { ref: "EV-2026-013", title: "Maintenance services RFP", owner: "Maintenance", closes: "14 Oct 2026", currency: "AED", status: "Evaluating", value: "AED 860,000.00", saving: "AED 42,500.00" },
  { ref: "EV-2026-012", title: "Valve spares RFQ", owner: "Warehouse", closes: "2 Oct 2026", currency: "AED", status: "Awarded", value: "AED 215,400.00", saving: "AED 18,900.00" },
  { ref: "EV-2026-011", title: "Cable tray supply", owner: "Projects", closes: "28 Sept 2026", currency: "AED", status: "Awarded", value: "AED 98,300.00", saving: "AED 7,120.00" },
  { ref: "EV-2026-010", title: "Safety PPE annual rate contract", owner: "HSE", closes: "18 Sept 2026", currency: "AED", status: "Draft", value: "AED 0.00", saving: "AED 0.00" },
  { ref: "EV-2026-009", title: "Pipe fittings tender", owner: "Projects", closes: "9 Sept 2026", currency: "AED", status: "Cancelled", value: "AED 410,000.00", saving: "AED 0.00" },
];
