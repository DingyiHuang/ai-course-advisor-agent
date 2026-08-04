import type {
  KnowledgeChunk,
  KnowledgeChunkDomain,
} from "@/lib/domain/knowledge";
import { RUNTIME_KNOWLEDGE_CHUNKS } from "@/lib/knowledge";
import type { ShortHistoryItem } from "@/lib/domain/conversation";

export type KnowledgeRetrievalInput = {
  message: string;
  domain: KnowledgeChunkDomain | "unknown";
  entityIds: string[];
  confirmedConstraints: Record<string, unknown>;
  pendingQuestionKeys: string[];
  history: ShortHistoryItem[];
  limit?: number;
};

const TOPIC_PATTERNS: Array<[string, RegExp]> = [
  ["schedule", /(?:时间|日期|哪天|哪几天|第[一二三四五六七1234567]天|营期)/u],
  ["location", /(?:地点|哪里|在哪|城市|线上|线下)/u],
  ["price", /(?:价格|费用|多少钱|优惠|早鸟|团报|收费|报价)/u],
  ["registration", /(?:报名|截止|电话|联系)/u],
  ["required_items", /(?:准备|携带|带什么|电脑|设备|网络)/u],
  ["curriculum", /(?:学什么|课程内容|大纲|模块|产出|第[一二三四五六七1234567]天)/u],
  ["refund", /(?:退款|退费|取消)/u],
  ["replay", /(?:回放|录播)/u],
  ["availability", /(?:余位|名额|开班人数)/u],
  ["prerequisite", /(?:前置|基础|先修|零基础|刚开始|刚入门)/u],
  ["service_boundary", /(?:采购|企业培训|项目|会员|订单|服务边界)/u],
];

function normalizedText(input: KnowledgeRetrievalInput): string {
  const history = input.history
    .slice(-8)
    .map(({ content }) => content)
    .join("\n");
  return [
    input.message,
    JSON.stringify(input.confirmedConstraints),
    input.pendingQuestionKeys.join(" "),
    history,
  ]
    .join("\n")
    .toLocaleLowerCase();
}

function requestedTopics(text: string): Set<string> {
  const topics = new Set<string>();
  for (const [topic, pattern] of TOPIC_PATTERNS) {
    if (pattern.test(text)) topics.add(topic);
  }
  if (/l1/iu.test(text)) topics.add("l1");
  if (/l2/iu.test(text)) topics.add("l2");
  if (/l3/iu.test(text)) topics.add("l3");
  if (/(?:周末|平日走不开|工作日不能|不能脱岗)/u.test(text)) {
    topics.add("weekend");
  }
  if (/(?:连续|集训|脱岗)/u.test(text)) topics.add("intensive");
  if (/第五天|第5天/u.test(text)) topics.add("day_5");
  if (/学校采购/u.test(text)) topics.add("school-procurement");
  if (/企业培训/u.test(text)) topics.add("enterprise-training");
  if (/会员/u.test(text)) topics.add("membership");
  if (/知识库|rag/iu.test(text)) topics.add("rag");
  if (/web应用|aiweb/iu.test(text)) topics.add("ai-web");
  if (/agent|智能体/iu.test(text)) topics.add("basic-agent");
  return topics;
}

function isClearlyOutsideMaterial(text: string): boolean {
  return /(?:与其他培训机构相比|哪家培训机构更好|同行比较|竞品比较|报名联系电话|联系电话|联系方式|额外优惠|更多优惠)/u.test(
    text,
  );
}

function scoreChunk(input: {
  chunk: KnowledgeChunk;
  domain: KnowledgeRetrievalInput["domain"];
  entityIds: Set<string>;
  topics: Set<string>;
  text: string;
}): number {
  let score = 0;
  if (input.domain !== "unknown") {
    if (input.chunk.domain !== input.domain) return Number.NEGATIVE_INFINITY;
    score += 20;
  }
  const entityMatches = input.chunk.entityIds.filter((id) =>
    input.entityIds.has(id),
  ).length;
  if (entityMatches) score += 120 + entityMatches;
  const topicMatches = input.chunk.topics.filter((topic) =>
    input.topics.has(topic),
  ).length;
  score += topicMatches * 35;
  if (input.topics.has("day_5") && input.chunk.topics.includes("day_5")) {
    score += 80;
  }
  if (input.chunk.topics.includes("overview")) score += 4;
  if (
    input.chunk.entityIds.some((id) =>
      input.text.includes(id.replaceAll("-", "")),
    )
  ) {
    score += 25;
  }
  return score;
}

export function retrieveKnowledgeChunks(
  input: KnowledgeRetrievalInput,
): KnowledgeChunk[] {
  const limit = Math.min(8, Math.max(5, input.limit ?? 6));
  const text = normalizedText(input);
  if (isClearlyOutsideMaterial(input.message.toLocaleLowerCase())) return [];
  const topics = requestedTopics(text);
  const entityIds = new Set(input.entityIds);
  const ranked = RUNTIME_KNOWLEDGE_CHUNKS.map((chunk, index) => ({
    chunk,
    index,
    score: scoreChunk({
      chunk,
      domain: input.domain,
      entityIds,
      topics,
      text: text.replaceAll("-", ""),
    }),
  }))
    .filter(({ score }) => Number.isFinite(score) && score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const directlyRelevant = ranked.filter(({ chunk }) => {
    const entityMatch = chunk.entityIds.some((id) => entityIds.has(id));
    if (entityIds.size > 0) return entityMatch;
    const topicMatch = chunk.topics.some((topic) => topics.has(topic));
    return topicMatch || chunk.topics.includes("overview");
  });
  if (!directlyRelevant.length) return [];
  return directlyRelevant.slice(0, limit).map(({ chunk }) => chunk);
}
