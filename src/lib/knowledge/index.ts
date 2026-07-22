import type {
  Camp,
  PlatformService,
  Source,
  TeacherProduct,
} from "@/lib/domain/knowledge";
import { factId } from "@/lib/domain/knowledge";
import { CAMPS, CAMP_FIELD_SOURCES } from "./camps";
import {
  PLATFORM_SERVICES,
  PLATFORM_SERVICE_FIELD_SOURCES,
} from "./platform";
import {
  TEACHER_PRODUCTS,
  TEACHER_PRODUCT_FIELD_SOURCES,
} from "./teachers";

export {
  CAMPS,
  CAMP_FIELD_SOURCES,
  getCamp,
} from "./camps";
export {
  PLATFORM_SERVICES,
  PLATFORM_SERVICE_FIELD_SOURCES,
  getPlatformService,
} from "./platform";
export {
  TEACHER_PRODUCTS,
  TEACHER_PRODUCT_FIELD_SOURCES,
  getTeacherProduct,
} from "./teachers";

export type KnowledgeDomain = "camp" | "teacher" | "platform";

export function getFieldSource(
  domain: "camp",
  field: keyof Camp,
): Source | undefined;
export function getFieldSource(
  domain: "teacher",
  field: keyof TeacherProduct,
): Source | undefined;
export function getFieldSource(
  domain: "platform",
  field: keyof PlatformService,
): Source | undefined;
export function getFieldSource(
  domain: KnowledgeDomain,
  field: keyof Camp | keyof TeacherProduct | keyof PlatformService,
): Source | undefined {
  if (domain === "camp") {
    return CAMP_FIELD_SOURCES[field as keyof Camp];
  }

  if (domain === "teacher") {
    return TEACHER_PRODUCT_FIELD_SOURCES[field as keyof TeacherProduct];
  }

  return PLATFORM_SERVICE_FIELD_SOURCES[field as keyof PlatformService];
}

export function sourcedFact(
  domain: KnowledgeDomain,
  entityId: string,
  field: string,
): { id: string; source: Source } {
  const source = getFieldSource(
    domain as "camp",
    field as keyof Camp,
  );

  if (!source) {
    throw new Error(`Source not found: domain=${domain}, field=${field}`);
  }

  return { id: factId(entityId, field), source };
}

export const KNOWLEDGE_COUNTS = {
  camps: CAMPS.length,
  teacherProducts: TEACHER_PRODUCTS.length,
  platformServices: PLATFORM_SERVICES.length,
} as const;
