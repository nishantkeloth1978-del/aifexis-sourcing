/** Client-safe: the text a buyer starts from, built from a checked draft. */
export const noteFrom = (d: { note: string; points: string[] }) => (d.points.length ? `${d.note}\n\nTo check: ${d.points.join(" ")}` : d.note);
