import { collectSources } from "./collectSources";

const DOCUMENT_TITLES = {
  A: "2026暑期AI素养夏令营课程手册",
  B: "初高中教师AI素养培训体系介绍",
  C: "OPC超级个体赋能平台产品白皮书",
} as const;

export function formatSourceFootnotes(factIds: string[]): string {
  const sources = collectSources(factIds);
  if (!sources.length) return "";
  const labels = sources.map((source) => {
    const section = source.section ? `（${source.section}）` : "";
    return `素材${source.document}《${DOCUMENT_TITLES[source.document]}》${source.chapter}${section}`;
  });
  return `\n\n来源：${labels.join("；")}`;
}
