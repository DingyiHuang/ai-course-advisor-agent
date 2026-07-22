import type { Source } from "@/lib/domain/knowledge";
import type { KnowledgeDomain } from "@/lib/knowledge";
import { sourcedFact } from "@/lib/knowledge";

export type CollectedSource = Source & { factIds: string[] };

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
