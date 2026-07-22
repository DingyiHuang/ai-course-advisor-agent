import { describe, expect, it } from "vitest";
import {
  fixedClock,
  isDeadlineActive,
  shanghaiToday,
  toShanghaiDate,
} from "@/lib/time/shanghai";

describe("Asia/Shanghai business dates", () => {
  it("keeps the UTC instant before 16:00 on July 20 as Shanghai July 20", () => {
    expect(toShanghaiDate("2026-07-20T15:59:59Z")).toBe("2026-07-20");
  });

  it("rolls the UTC instant at 16:00 on July 20 to Shanghai July 21", () => {
    expect(toShanghaiDate("2026-07-20T16:00:00Z")).toBe("2026-07-21");
  });

  it("supports an injected clock and treats the deadline day as active", () => {
    const clock = fixedClock("2026-07-25T15:59:59Z");

    expect(shanghaiToday(clock)).toBe("2026-07-25");
    expect(isDeadlineActive("2026-07-25", clock)).toBe(true);
  });

  it("expires after the Shanghai calendar date crosses the deadline", () => {
    const clock = fixedClock("2026-07-25T16:00:00Z");

    expect(shanghaiToday(clock)).toBe("2026-07-26");
    expect(isDeadlineActive("2026-07-25", clock)).toBe(false);
  });
});
