export type UsageStatus = "ok" | "warning" | "over";

const WARNING_THRESHOLD = 0.8;

/** Percentage of `cap` that `used` represents, 0 when `cap` is 0 (avoids a NaN/Infinity from a 0-cap edge case). */
export function percent(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return (used / cap) * 100;
}

/** ok below 80% of cap, warning from 80% up to (not including) the cap, over at or past it. */
export function computeStatus(used: number, cap: number): UsageStatus {
  if (cap <= 0) return "ok";
  if (used >= cap) return "over";
  if (used / cap >= WARNING_THRESHOLD) return "warning";
  return "ok";
}
