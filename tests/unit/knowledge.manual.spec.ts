import { describe, expect, it } from "vitest";
import {
  CAMPS,
  getCamp,
  getPlatformService,
  getTeacherProduct,
  TEACHER_PRODUCTS,
} from "@/lib/knowledge";

// Expected values below were supplied directly by the participant on
// 2026-07-22 after manual comparison with materials A, B and C.
// They are intentionally independent from the generated knowledge constants.
describe("participant-authored knowledge goldens", () => {
  it("matches all student period dates", () => {
    const periods = [
      {
        period: 1 as const,
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        registrationDeadline: "2026-07-25",
        earlyBirdDeadline: "2026-07-11",
      },
      {
        period: 2 as const,
        startDate: "2026-08-10",
        endDate: "2026-08-16",
        registrationDeadline: "2026-08-03",
        earlyBirdDeadline: "2026-07-20",
      },
      {
        period: 3 as const,
        startDate: "2026-08-20",
        endDate: "2026-08-26",
        registrationDeadline: "2026-08-13",
        earlyBirdDeadline: "2026-07-30",
      },
    ];

    for (const expected of periods) {
      const camp = getCamp(expected.period, "bj");
      expect(camp.startDate).toBe(expected.startDate);
      expect(camp.endDate).toBe(expected.endDate);
      expect(camp.registrationDeadline).toBe(expected.registrationDeadline);
      expect(camp.earlyBirdDeadline).toBe(expected.earlyBirdDeadline);
    }
  });

  it("matches student campuses, fees, services and refund rules", () => {
    const beijing = getCamp(1, "bj");
    const shanghai = getCamp(1, "sh");
    const online = getCamp(1, "online");

    expect(beijing.standardPrice).toBe(6980);
    expect(beijing.earlyBirdPrice).toBe(5980);
    expect(beijing.addressOrPlatform).toBe(
      "北京市海淀区中关村南大街5号，AI教育中心北京教学基地（模拟地址）",
    );
    expect(beijing.capacity).toBe(30);
    expect(beijing.minimumToOpen).toBe(15);

    expect(shanghai.standardPrice).toBe(6980);
    expect(shanghai.earlyBirdPrice).toBe(5980);
    expect(shanghai.addressOrPlatform).toBe(
      "上海市浦东新区张江路1000号，AI教育中心上海教学基地（模拟地址）",
    );
    expect(shanghai.capacity).toBe(30);
    expect(shanghai.minimumToOpen).toBe(15);

    expect(online.standardPrice).toBe(3980);
    expect(online.earlyBirdPrice).toBe(3280);
    expect(online.addressOrPlatform).toBe(
      "腾讯会议直播（会议号缴费确认后发送）",
    );
    expect(online.capacity).toBe(50);
    expect(online.minimumToOpen).toBe(20);
    expect(online.replayDays).toBe(30);

    expect(CAMPS.every((camp) => camp.groupMinimum === 3)).toBe(true);
    expect(CAMPS.every((camp) => camp.groupDiscount === 300)).toBe(true);
    expect(beijing.lodgingPrice).toBe(2360);
    expect(beijing.accommodationPrice).toBe(1800);
    expect(beijing.mealPrice).toBe(560);

    const day5 = beijing.dailyOutline.find((day) => day.day === 5);
    expect(day5?.theme).toBe("智能体搭建");
    expect(day5?.output).toBe("个人学习助手Bot");
    expect(
      beijing.requiredItems.some((item) => item.includes("笔记本电脑")),
    ).toBe(true);
    expect(beijing.refundRules.map((rule) => rule.refundRate)).toEqual([
      0.9,
      0.5,
      0,
    ]);
  });

  it("matches all teacher products and high-risk schedules", () => {
    const l1Intensive = getTeacherProduct("L1", "intensive");
    const l1Weekend = getTeacherProduct("L1", "weekend");
    const l2Intensive = getTeacherProduct("L2", "intensive");
    const l2Weekend = getTeacherProduct("L2", "weekend");
    const l3Intensive = getTeacherProduct("L3", "intensive");
    const l3Weekend = getTeacherProduct("L3", "weekend");

    expect([
      l1Intensive.startDate,
      l1Intensive.registrationDeadline,
      l1Intensive.earlyBirdDeadline,
    ]).toEqual(["2026-08-01", "2026-07-25", "2026-07-18"]);
    expect([
      l1Weekend.startDate,
      l1Weekend.registrationDeadline,
      l1Weekend.earlyBirdDeadline,
    ]).toEqual(["2026-08-02", "2026-07-26", "2026-07-19"]);
    expect(`${l1Weekend.cities.join("、")}（线上为腾讯会议）`).toBe(
      "北京、上海、广州（线上为腾讯会议）",
    );

    expect([
      l2Intensive.startDate,
      l2Intensive.registrationDeadline,
      l2Intensive.earlyBirdDeadline,
    ]).toEqual(["2026-08-03", "2026-07-27", "2026-07-20"]);
    expect(l2Intensive.schedule[0]).toBe(
      "8月3日8课时、8月4日8课时、8月5日上午4课时，共20课时",
    );
    expect([
      l2Weekend.startDate,
      l2Weekend.registrationDeadline,
      l2Weekend.earlyBirdDeadline,
    ]).toEqual(["2026-08-08", "2026-08-01", "2026-07-25"]);
    expect(l2Weekend.schedule[0]).toBe(
      "8月8日线上8课时、8月9日线下8课时、8月15日上午线上4课时，共20课时",
    );

    expect([
      l3Intensive.startDate,
      l3Intensive.registrationDeadline,
      l3Intensive.earlyBirdDeadline,
    ]).toEqual(["2026-08-10", "2026-08-03", "2026-07-27"]);
    expect(l3Intensive.schedule[0]).toBe("8月10-12日每天8课时，共24课时");
    expect([
      l3Weekend.startDate,
      l3Weekend.registrationDeadline,
      l3Weekend.earlyBirdDeadline,
    ]).toEqual(["2026-08-16", "2026-08-09", "2026-08-02"]);
    expect(l3Weekend.schedule[0]).toBe(
      "8月16日线下、8月22日线上、8月23日线下，每天8课时，共24课时",
    );
  });

  it("matches teacher prices, discounts, equipment, replay and prerequisites", () => {
    const l1 = getTeacherProduct("L1", "intensive");
    const l2 = getTeacherProduct("L2", "intensive");
    const l3 = getTeacherProduct("L3", "intensive");

    expect([l1.standardPrice, l2.standardPrice, l3.standardPrice]).toEqual([
      2980,
      6980,
      12800,
    ]);
    expect([
      l1.earlyBirdDiscount,
      l2.earlyBirdDiscount,
      l3.earlyBirdDiscount,
    ]).toEqual([500, 1000, 2000]);
    expect(
      TEACHER_PRODUCTS.every(
        (product) =>
          product.groupMinimum === 3 && product.groupDiscount === 300,
      ),
    ).toBe(true);
    expect(
      l1.deviceRequirements.some((requirement) =>
        requirement.includes("笔记本电脑"),
      ),
    ).toBe(true);
    expect(l1.replayPolicy).toContain("30天回放");
    expect(l2.prerequisite).toBe("完成L1或通过同等能力测评");
    expect(l3.prerequisite).toBe("完成L2或提交同等项目作品");
  });

  it("matches platform and institution service boundaries", () => {
    const enterprise = getPlatformService("platform-enterprise-training");
    const school = getPlatformService("platform-school-procurement");
    const agent = getPlatformService("platform-basic-agent");
    const web = getPlatformService("platform-ai-web");
    const rag = getPlatformService("platform-rag");
    const membership = getPlatformService("platform-membership");
    const contest = getPlatformService("platform-contest");

    expect([
      enterprise.minimumPeople,
      enterprise.minimumPricePerPerson,
      enterprise.maximumPricePerPerson,
    ]).toEqual([50, 500, 1500]);
    expect([school.minimumPeople, school.minimumTotalPrice]).toEqual([
      20,
      50000,
    ]);
    expect([agent.minimumPrice, agent.maximumPrice]).toEqual([10000, 30000]);
    expect([web.minimumPrice, web.maximumPrice]).toEqual([30000, 80000]);
    expect(rag.minimumPrice).toBe(80000);
    expect(membership.grantsOrderPermission).toBe(false);
    expect(contest.grantsDirectOrderPermission).toBe(false);
  });
});
