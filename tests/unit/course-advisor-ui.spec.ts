import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import CourseAdvisor, {
  LoadingStatus,
} from "@/components/CourseAdvisor";

describe("CourseAdvisor accessible shell", () => {
  it("renders the five quick-entry labels on the home and conversation shell", () => {
    const html = renderToStaticMarkup(
      createElement(CourseAdvisor, { testMode: false }),
    );
    for (const label of [
      "学生课程咨询",
      "教师培训咨询",
      "查看所有班型",
      "费用咨询",
      "报名条件咨询",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("shows Test Mode controls only when test=1 was resolved by the server", () => {
    const normal = renderToStaticMarkup(
      createElement(CourseAdvisor, { testMode: false }),
    );
    const testing = renderToStaticMarkup(
      createElement(CourseAdvisor, { testMode: true }),
    );
    expect(normal).not.toContain("TEST MODE");
    expect(normal).not.toContain("模拟模型失败");
    expect(testing).toContain("TEST MODE");
    expect(testing).toContain("模拟模型失败");
  });

  it("shows the evidence banner only in the explicit evidence mode", () => {
    const normal = renderToStaticMarkup(
      createElement(CourseAdvisor, { testMode: false, evidenceMode: false }),
    );
    const evidence = renderToStaticMarkup(
      createElement(CourseAdvisor, { testMode: false, evidenceMode: true }),
    );
    expect(normal).not.toContain("验收证据模式");
    expect(evidence).toContain("验收证据模式");
    expect(evidence).not.toContain("TEST MODE");
    expect(evidence).not.toContain("模拟模型失败");
    expect(evidence).not.toMatch(/知识块ID|内部错误原因|Prompt全文/u);
  });

  it("keeps expanded mobile quick questions in bounded normal flow", () => {
    const css = readFileSync(
      new URL("../../src/components/CourseAdvisor.module.css", import.meta.url),
      "utf8",
    );
    const block = css.match(/\.mobileQuickPanelContent\s*\{([^}]*)\}/u)?.[1];

    expect(block).toContain("position: static");
    expect(block).toContain("max-height: min(28dvh, 210px)");
    expect(block).toContain("overflow-y: auto");
    expect(block).not.toMatch(/position:\s*(?:fixed|absolute|sticky)/u);
  });

  it("preserves the 44px mobile touch target for quick questions and sending", () => {
    const css = readFileSync(
      new URL("../../src/components/CourseAdvisor.module.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/\.composerFooter button\s*\{[^}]*min-height:\s*44px/u);
    expect(css).toMatch(/\.quickQuestionButton\s*\{[^}]*min-width:\s*104px/u);
  });

  it("renders the restoring state before interaction becomes available", () => {
    const html = renderToStaticMarkup(
      createElement(CourseAdvisor, { testMode: false }),
    );
    expect(html).toContain("正在恢复会话");
    expect(html).toContain('aria-busy="true"');
  });

  it("provides an input label, live log, error relation, and state-panel controls", () => {
    const html = renderToStaticMarkup(
      createElement(CourseAdvisor, { testMode: false }),
    );
    expect(html).toContain('aria-label="输入课程咨询问题"');
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-controls="consulting-state-content"');
    expect(html).toContain('id="composer-disclaimer"');
  });

  it("shows and removes the accessible loading status with request state", () => {
    const active = renderToStaticMarkup(
      createElement(LoadingStatus, { loading: true }),
    );
    const idle = renderToStaticMarkup(
      createElement(LoadingStatus, { loading: false }),
    );
    expect(active).toContain("正在检索资料并核对回答");
    expect(active).toContain('role="status"');
    expect(idle).toBe("");
  });
});
