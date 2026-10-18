import { alertTransition, computeStatus, percent } from "./cloud-usage.util";

describe("cloud-usage.util", () => {
  describe("percent", () => {
    it("computes a plain percentage", () => {
      expect(percent(1, 4)).toBe(25);
      expect(percent(24, 24)).toBe(100);
      expect(percent(0, 24)).toBe(0);
    });

    it("returns 0 for a zero or negative cap instead of NaN/Infinity", () => {
      expect(percent(5, 0)).toBe(0);
      expect(percent(5, -1)).toBe(0);
    });
  });

  describe("computeStatus", () => {
    it("is ok below 80% of cap", () => {
      expect(computeStatus(1, 4)).toBe("ok");
      expect(computeStatus(3.1, 4)).toBe("ok");
    });

    it("is warning from 80% up to (not including) the cap", () => {
      expect(computeStatus(3.2, 4)).toBe("warning");
      expect(computeStatus(3.99, 4)).toBe("warning");
    });

    it("is over at or past the cap", () => {
      expect(computeStatus(4, 4)).toBe("over");
      expect(computeStatus(5, 4)).toBe("over");
    });

    it("treats a zero/negative cap as ok rather than dividing by zero", () => {
      expect(computeStatus(5, 0)).toBe("ok");
    });
  });
});

describe("alertTransition", () => {
  it("alerts when a metric first reaches the warning level, and again if it then goes over", () => {
    expect(alertTransition(null, "warning")).toBe("alert");
    expect(alertTransition("ok", "warning")).toBe("alert");
    expect(alertTransition("warning", "over")).toBe("alert");
    expect(alertTransition(null, "over")).toBe("alert");
  });

  it("stays quiet while the level hasn\u0027t got worse", () => {
    expect(alertTransition("warning", "warning")).toBe("none");
    expect(alertTransition("over", "over")).toBe("none");
    expect(alertTransition("over", "warning")).toBe("none");
    expect(alertTransition(null, "ok")).toBe("none");
  });

  it("clears (re-arming the alert) once the metric is back under the threshold", () => {
    expect(alertTransition("warning", "ok")).toBe("clear");
    expect(alertTransition("over", "ok")).toBe("clear");
  });
});
