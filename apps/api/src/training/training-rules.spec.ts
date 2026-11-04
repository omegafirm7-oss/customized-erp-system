import { addMonthsUtc, batchDayList, computeResult, formatSerial, parseDateOnly, ResultInput } from "./training-rules";

const base: ResultInput = {
  passMarkPercent: 70,
  theoryMaxMarks: 100,
  practicalMaxMarks: 100,
  minAttendancePercent: 100,
  theoryMarks: 80,
  practicalMarks: 75,
  batchDays: 3,
  attendance: { present: 3, recorded: 3 },
};

describe("computeResult", () => {
  it("passes when both components meet the pass mark", () => {
    expect(computeResult(base)).toBe("PASSED");
  });
  it("passes exactly at the pass mark", () => {
    expect(computeResult({ ...base, theoryMarks: 70, practicalMarks: 70 })).toBe("PASSED");
  });
  it("fails when practical is below the pass mark", () => {
    expect(computeResult({ ...base, practicalMarks: 69.5 })).toBe("FAILED");
  });
  it("ignores practical when the course has none", () => {
    expect(computeResult({ ...base, practicalMaxMarks: 0, practicalMarks: null })).toBe("PASSED");
  });
  it("is pending while a mark is missing", () => {
    expect(computeResult({ ...base, theoryMarks: null })).toBe("PENDING");
  });
  it("is absent when attendance was taken but never present", () => {
    expect(computeResult({ ...base, attendance: { present: 0, recorded: 3 } })).toBe("ABSENT");
  });
  it("fails on low attendance", () => {
    expect(computeResult({ ...base, attendance: { present: 2, recorded: 3 } })).toBe("FAILED");
  });
  it("accepts attendance at the minimum", () => {
    expect(computeResult({ ...base, minAttendancePercent: 66, attendance: { present: 2, recorded: 3 } })).toBe("PASSED");
  });
  it("skips the attendance check when attendance was never taken", () => {
    expect(computeResult({ ...base, attendance: null })).toBe("PASSED");
  });
  it("scales marks against non-100 maxima", () => {
    expect(computeResult({ ...base, theoryMaxMarks: 40, theoryMarks: 28, practicalMaxMarks: 20, practicalMarks: 13 })).toBe("FAILED");
    expect(computeResult({ ...base, theoryMaxMarks: 40, theoryMarks: 28, practicalMaxMarks: 20, practicalMarks: 14 })).toBe("PASSED");
  });
});

describe("date helpers", () => {
  it("adds months and clamps to month end", () => {
    expect(addMonthsUtc(parseDateOnly("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonthsUtc(parseDateOnly("2026-11-04"), 24).toISOString().slice(0, 10)).toBe("2028-11-04");
    expect(addMonthsUtc(parseDateOnly("2028-02-29"), 12).toISOString().slice(0, 10)).toBe("2029-02-28");
  });
  it("lists batch days inclusively", () => {
    expect(batchDayList(parseDateOnly("2026-11-29"), parseDateOnly("2026-12-01"))).toEqual(["2026-11-29", "2026-11-30", "2026-12-01"]);
  });
  it("formats serials", () => {
    expect(formatSerial("RD", 2026, 7)).toBe("RD-2026-00007");
  });
});
