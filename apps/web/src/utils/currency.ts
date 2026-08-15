/** Comma-grouped, fixed-2-decimal formatting for financial statement figures. */
export function formatAmount(value: string | number): string {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Same, but negative values render in accounting-style parentheses instead of a minus sign. */
export function formatSigned(value: string | number): string {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const formatted = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${formatted})` : formatted;
}
