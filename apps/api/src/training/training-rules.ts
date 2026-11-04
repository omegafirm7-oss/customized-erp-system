// Pure rules for the Training module, kept free of Prisma/Nest so they can be
// unit-tested directly (see training-rules.spec.ts).

export type AutoResult = "PENDING" | "PASSED" | "FAILED" | "ABSENT";

export interface ResultInput {
  passMarkPercent: number;
  theoryMaxMarks: number;
  /** 0 = the course has no practical assessment. */
  practicalMaxMarks: number;
  minAttendancePercent: number;
  theoryMarks: number | null;
  practicalMarks: number | null;
  /** Number of batch days (inclusive start..end). */
  batchDays: number;
  /** Attendance rows recorded for this trainee (null = attendance not taken at all). */
  attendance: { present: number; recorded: number } | null;
}

/**
 * Automatic pass/fail rule:
 *  - attendance taken and the trainee was present on no day → ABSENT
 *  - a required mark still missing → PENDING
 *  - attendance taken and below the course minimum → FAILED
 *  - theory (and practical, when the course has one) at or above the pass mark → PASSED, else FAILED
 * When attendance was never taken for the trainee the attendance check is
 * skipped, so batches that don't track attendance can still be marked.
 */
export function computeResult(input: ResultInput): AutoResult {
  const att = input.attendance;
  if (att && att.recorded > 0 && att.present === 0) return "ABSENT";

  const needsTheory = input.theoryMaxMarks > 0;
  const needsPractical = input.practicalMaxMarks > 0;
  if ((needsTheory && input.theoryMarks == null) || (needsPractical && input.practicalMarks == null)) {
    return "PENDING";
  }

  if (att && att.recorded > 0) {
    const days = Math.max(input.batchDays, 1);
    const pct = (att.present / days) * 100;
    if (pct + 1e-9 < input.minAttendancePercent) return "FAILED";
  }

  const pass = input.passMarkPercent;
  const theoryOk = !needsTheory || ((input.theoryMarks ?? 0) / input.theoryMaxMarks) * 100 + 1e-9 >= pass;
  const practicalOk = !needsPractical || ((input.practicalMarks ?? 0) / input.practicalMaxMarks) * 100 + 1e-9 >= pass;
  return theoryOk && practicalOk ? "PASSED" : "FAILED";
}

/** "YYYY-MM-DD" → UTC midnight Date (the form Prisma stores @db.Date in). */
export function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new Error(`Invalid date: ${value}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Adds calendar months in UTC, clamping to month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

/** Inclusive list of "YYYY-MM-DD" days from start to end. */
export function batchDayList(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    out.push(toDateOnly(new Date(t)));
  }
  return out;
}

export function formatSerial(prefix: string, year: number, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}
