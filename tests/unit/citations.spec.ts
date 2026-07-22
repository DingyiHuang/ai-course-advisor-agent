import { describe, expect, it } from "vitest";
import type { BusinessDate } from "@/lib/time/shanghai";
import { collectSources } from "@/lib/citations";
import { getCamp } from "@/lib/knowledge";
import { calculateCampFee } from "@/lib/rules";

describe("programmatic source collection", () => {
  it("collects and deduplicates sources from the facts actually used", () => {
    const fee = calculateCampFee({
      camp: getCamp(1, "bj"),
      currentDate: "2026-07-22" as BusinessDate,
      group: { size: 3, samePeriodAndCamp: true },
      includeLodging: true,
    });
    const sources = collectSources([...fee.factIds, ...fee.factIds]);

    expect(sources).toHaveLength(2);
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document: "A", chapter: "第三章" }),
        expect.objectContaining({ document: "A", chapter: "第五章" }),
      ]),
    );
    expect(
      sources.flatMap((source) => source.factIds).filter(
        (id) => id === "camp-p1-bj.groupDiscount",
      ),
    ).toHaveLength(1);
  });

  it("collects the material-wide teacher refund boundary source", () => {
    expect(
      collectSources(["teacher-l1-intensive.refundPolicyProvided"]),
    ).toEqual([
      {
        document: "B",
        chapter: "全文",
        section: "未提供退款规则",
        factIds: ["teacher-l1-intensive.refundPolicyProvided"],
      },
    ]);
  });

  it("rejects unknown fact domains instead of inventing a chapter", () => {
    expect(() => collectSources(["unknown.price"])).toThrow(
      "Unknown fact domain",
    );
  });
});
