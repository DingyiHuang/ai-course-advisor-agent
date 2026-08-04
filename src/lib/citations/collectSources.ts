import type { Source } from "@/lib/domain/knowledge";
import type { KnowledgeDomain } from "@/lib/knowledge";
import { sourcedFact } from "@/lib/knowledge";
import { getKnowledgeChunk } from "@/lib/knowledge";

export type CollectedSource = Source & { factIds: string[] };

export type ChunkCollectedSource = CollectedSource & { chunkIds: string[] };

function parseFactId(factId: string): {
  domain: KnowledgeDomain;
  entityId: string;
  field: string;
} {
  const separator = factId.lastIndexOf(".");
  if (separator <= 0 || separator === factId.length - 1) {
    throw new Error(`Invalid fact ID: ${factId}`);
  }

  const entityId = factId.slice(0, separator);
  const field = factId.slice(separator + 1);
  const domain: KnowledgeDomain = entityId.startsWith("camp-")
    ? "camp"
    : entityId.startsWith("teacher-")
      ? "teacher"
      : entityId.startsWith("platform-")
        ? "platform"
        : (() => {
            throw new Error(`Unknown fact domain: ${factId}`);
          })();

  return { domain, entityId, field };
}

export function collectSources(factIds: string[]): CollectedSource[] {
  const grouped = new Map<string, CollectedSource>();

  for (const factId of [...new Set(factIds)]) {
    const { domain, entityId, field } = parseFactId(factId);
    const { source } = sourcedFact(domain, entityId, field);
    const key = [source.document, source.chapter, source.section ?? ""].join("|");
    const existing = grouped.get(key);

    if (existing) {
      existing.factIds.push(factId);
    } else {
      grouped.set(key, { ...source, factIds: [factId] });
    }
  }

  return [...grouped.values()];
}

export function collectChunkSources(
  chunkIds: string[],
  usedFactIds?: string[],
): CollectedSource[] {
  const allowedFacts = usedFactIds ? new Set(usedFactIds) : undefined;
  const grouped = new Map<string, ChunkCollectedSource>();
  for (const chunkId of [...new Set(chunkIds)]) {
    const chunk = getKnowledgeChunk(chunkId);
    if (!chunk) throw new Error(`Unknown knowledge chunk: ${chunkId}`);
    const source: Source = {
      document: chunk.source.material,
      chapter: chunk.source.chapter,
      ...(chunk.source.section ? { section: chunk.source.section } : {}),
    };
    const key = [source.document, source.chapter, source.section ?? ""].join("|");
    const chunkFacts = allowedFacts
      ? chunk.factIds.filter((factId) => allowedFacts.has(factId))
      : chunk.factIds;
    const existing = grouped.get(key);
    if (existing) {
      existing.chunkIds.push(chunk.id);
      existing.factIds.push(...chunkFacts);
    } else {
      grouped.set(key, {
        ...source,
        chunkIds: [chunk.id],
        factIds: [...chunkFacts],
      });
    }
  }
  return [...grouped.values()].map((item) => ({
    document: item.document,
    chapter: item.chapter,
    ...(item.section ? { section: item.section } : {}),
    factIds: [...new Set(item.factIds)],
  }));
}
