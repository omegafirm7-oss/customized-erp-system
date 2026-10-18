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

/** The share of a free-tier limit at which the "getting close" email goes out. */
export const ALERT_THRESHOLD_PERCENT = 80;

const LEVEL: Record<UsageStatus, number> = { ok: 0, warning: 1, over: 2 };

/**
 * Decides what to do when a metric's status changes between two checks:
 * "alert" only when it has got worse than the level last emailed about (so a
 * metric sitting at 85% is emailed once, not on every run), "clear" when it
 * is back under the threshold (re-arming the next alert), otherwise "none".
 */
export function alertTransition(prev: UsageStatus | null, next: UsageStatus): "alert" | "clear" | "none" {
  const before = prev ?? "ok";
  if (next === "ok") return before === "ok" ? "none" : "clear";
  return LEVEL[next] > LEVEL[before] ? "alert" : "none";
}
