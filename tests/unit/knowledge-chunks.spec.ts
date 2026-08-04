import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_CHUNKS,
  RUNTIME_KNOWLEDGE_CHUNKS,
  hasCompleteChunkSource,
} from "@/lib/knowledge";
import { retrieveKnowledgeChunks } from "@/lib/retrieval/knowledgeRetriever";
import { validateUsedChunkIds } from "@/lib/validation/grounding";

function retrieval(overrides: Partial<Parameters<typeof retrieveKnowledgeChunks>[0]> = {}) {
  return retrieveKnowledgeChunks({
    message: "课程信息",
    domain: "unknown",
    entityIds: [],
    confirmedConstraints: {},
    pendingQuestionKeys: [],
    history: [],
    ...overrides,
  });
}

describe("TASK-B02 typed knowledge chunks", () => {
  it("keeps stable unique IDs and complete typed sources", () => {
    const ids = KNOWLEDGE_CHUNKS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RUNTIME_KNOWLEDGE_CHUNKS).toHaveLength(KNOWLEDGE_CHUNKS.length);
    for (const chunk of KNOWLEDGE_CHUNKS) {
      expect(chunk.id).toMatch(/^[a-z0-9-]+$/u);
      expect(chunk.title.trim()).not.toBe("");
      expect(chunk.content.trim()).not.toBe("");
      expect(chunk.topics.length).toBeGreaterThan(0);
      expect(chunk.entityIds.length).toBeGreaterThan(0);
      expect(chunk.factIds.length).toBeGreaterThan(0);
      expect(hasCompleteChunkSource(chunk)).toBe(true);
      expect(chunk.source.documentTitle).not.toMatch(/\.docx$/iu);
      expect(chunk.content).not.toMatch(/(?:minimumPeople|standardPrice|field|字段名)\s*[:：=]/iu);
    }
  });

  it("retrieves five to eight student chunks with the current entity first", () => {
    const chunks = retrieval({
      message: "第五天学什么？",
      domain: "student",
      entityIds: ["camp-p1-bj"],
      confirmedConstraints: { availablePeriods: [1] },
      history: [{ role: "assistant", content: "已选择第一期北京线下班" }],
    });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(chunks[0].id).toBe("student-camp-daily-outline");
    expect(chunks.every((chunk) => chunk.domain === "student")).toBe(true);
    expect(chunks.every((chunk) => chunk.entityIds.includes("camp-p1-bj"))).toBe(true);
  });

  it("retrieves five to eight teacher chunks for the selected L2 weekend class", () => {
    const chunks = retrieval({
      message: "L2周末研修班哪几天上课？",
      domain: "teacher",
      entityIds: ["teacher-l2-weekend"],
    });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(chunks[0].id).toBe("teacher-l2-weekend-schedule");
    expect(chunks.every((chunk) => chunk.domain === "teacher")).toBe(true);
    expect(
      chunks.every((chunk) => chunk.entityIds.includes("teacher-l2-weekend")),
    ).toBe(true);
  });

  it("retrieves only school-procurement chunks for the current institution entity", () => {
    const chunks = retrieval({
      message: "学校采购20人的教师培训怎么收费？",
      domain: "platform",
      entityIds: ["platform-school-procurement"],
      confirmedConstraints: { institutionNeed: "school_procurement" },
    });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(
      chunks.every((chunk) =>
        chunk.entityIds.includes("platform-school-procurement"),
      ),
    ).toBe(true);
    expect(JSON.stringify(chunks)).not.toContain("teacher-l2");
  });

  it("inherits the current entity for an elliptical follow-up", () => {
    const chunks = retrieval({
      message: "需要准备什么？",
      domain: "student",
      entityIds: ["camp-p1-online"],
      history: [
        { role: "user", content: "第一期线上班" },
        { role: "assistant", content: "已选择第一期线上直播班" },
      ],
    });
    expect(chunks.some(({ id }) => id === "student-camp-required-items")).toBe(
      true,
    );
    expect(
      chunks.every((chunk) => chunk.entityIds.includes("camp-p1-online")),
    ).toBe(true);
  });

  it("does not pad an out-of-material comparison with unrelated chunks", () => {
    expect(
      retrieval({
        message: "与其他培训机构相比哪家更好？",
        domain: "teacher",
        entityIds: ["teacher-l1-weekend"],
      }),
    ).toEqual([]);
  });

  it("accepts legal chunk IDs and rejects an ID not injected this turn", () => {
    const chunks = retrieval({
      message: "学校采购怎么收费？",
      domain: "platform",
      entityIds: ["platform-school-procurement"],
    });
    expect(validateUsedChunkIds([chunks[0].id], chunks, true)).toEqual([
      chunks[0].id,
    ]);
    expect(() =>
      validateUsedChunkIds(["not-injected"], chunks, true),
    ).toThrow("outside this response");
    expect(() => validateUsedChunkIds([], chunks, true)).toThrow(
      "omitted all injected chunks",
    );
  });
});
