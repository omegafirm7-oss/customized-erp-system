/**
 * Fiscal periods are month-aligned in practice, so leading a dropdown with
 * "Period 7" makes the user do arithmetic to find the month they want.
 * Month name first, period number after it as the secondary detail.
 */
export function formatPeriodLabel(period: { periodNumber: number; startDate: string; endDate: string }): string {
  const month = new Date(period.startDate).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const start = new Date(period.startDate).toLocaleDateString();
  const end = new Date(period.endDate).toLocaleDateString();
  return `${month} · Period ${period.periodNumber} (${start} – ${end})`;
}

/** Compact form for headings, where the date range is just noise. */
export function formatPeriodShort(period: { periodNumber: number; startDate: string }): string {
  const month = new Date(period.startDate).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `${month} · Period ${period.periodNumber}`;
}
