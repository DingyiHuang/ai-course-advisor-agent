import type {
  StudentConstraints,
  StudentRegion,
} from "@/lib/domain/rules";

export type ConfirmedStudentRegion = Pick<
  StudentConstraints,
  "region" | "regionDisplayName"
> & {
  region: StudentRegion;
};

const BEIJING_DISTRICTS =
  /^(?:东城|西城|朝阳|丰台|石景山|海淀|门头沟|房山|通州|顺义|昌平|大兴|怀柔|平谷|密云|延庆)区$/u;

const GENERIC_OTHER_REGIONS =
  /^(?:其他城市|其他地区|外地|非北上广|您所在地区|所在地区)$/u;

const INVALID_REGION_NAMES =
  /(?:我是|作为|第一期|第二期|第三期|营期|线上|线下|学生班|课程|学校|家长|学生|教师|老师|机构|企业|所在地区|其他城市|其他地区|非北上广|出行|不便|不能|无法|方便|前往|可以|均不|都不)/u;

function compact(value: string): string {
  return value.trim().replace(/\s+/gu, "");
}

function normalizedName(value: string): string {
  return compact(value)
    .replace(/[，,。；;！？!?：:（）()【】[\]]/gu, "")
    .replace(/市$/u, "");
}

export function normalizeStudentRegionName(
  value: string,
): ConfirmedStudentRegion | undefined {
  const name = normalizedName(value);
  const lower = name.toLocaleLowerCase();
  if (!name) return undefined;
  if (name === "北京" || lower === "beijing" || BEIJING_DISTRICTS.test(name)) {
    return { region: "beijing", regionDisplayName: "北京" };
  }
  if (name === "上海" || lower === "shanghai") {
    return { region: "shanghai", regionDisplayName: "上海" };
  }
  if (name === "广州" || lower === "guangzhou") {
    return { region: "guangzhou", regionDisplayName: "广州" };
  }
  if (GENERIC_OTHER_REGIONS.test(name)) {
    return { region: "other" };
  }
  if (
    !/^[\p{Script=Han}·]{2,8}$/u.test(name) ||
    INVALID_REGION_NAMES.test(name)
  ) {
    return undefined;
  }
  return { region: "other", regionDisplayName: name };
}

export function extractExplicitStudentRegion(
  message: string,
): ConfirmedStudentRegion | undefined {
  const text = compact(message);
  const patterns = [
    /(?:我)?(?:目前)?(?:在|住在|住|来自|人在)([\p{Script=Han}·]{2,8}?)(?:市)?(?=[，,。；;！？!?]|(?:想|要|只|偏好|可以|希望|准备|学习|参加|日期|时间|第一|第二|第三|第[一二三123]期)|$)/u,
    /我(?:是|作为)([\p{Script=Han}·]{2,8}?)(?:市)?(?:家长|学生)/u,
    /(?:所在地|城市)(?:是|为|改为|改成)?([\p{Script=Han}·]{2,8}?)(?:市)?(?=[，,。；;！？!?]|(?:想|要|只|偏好|可以|希望|准备|第一|第二|第三|第[一二三123]期)|$)/u,
    /([\p{Script=Han}·]{2,8}?)(?:市)?这边(?=[，,。；;！？!?]|$)/u,
    /^(?:我是|我作为)([\p{Script=Han}·]{2,8}?)(?:市)?(?:的)?(?:家长|学生)(?=[，,。；;！？!?]|$)/u,
    /^([\p{Script=Han}·]{2,8}?)(?:市)?(?:家长|学生)(?=[，,。；;！？!?]|$)/u,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const normalized = match?.[1]
      ? normalizeStudentRegionName(match[1])
      : undefined;
    if (normalized) return normalized;
  }
  if (/^[\p{Script=Han}·]{2,8}(?:市)?$/u.test(text)) {
    return normalizeStudentRegionName(text);
  }
  return undefined;
}

export function regionDisplayNameFor(
  constraints: Pick<StudentConstraints, "region" | "regionDisplayName">,
): string | undefined {
  if (constraints.region === "beijing") return "北京";
  if (constraints.region === "shanghai") return "上海";
  if (constraints.region === "guangzhou") return "广州";
  if (constraints.region !== "other" || !constraints.regionDisplayName) {
    return undefined;
  }
  const normalized = normalizeStudentRegionName(
    constraints.regionDisplayName,
  );
  return normalized?.region === "other"
    ? normalized.regionDisplayName
    : undefined;
}

export function studentOfflineBoundaryStatement(
  constraints: Pick<StudentConstraints, "region" | "regionDisplayName">,
): string {
  const displayName = regionDisplayNameFor(constraints);
  if (constraints.region === "guangzhou") {
    return "素材A没有广州学生线下班。";
  }
  return displayName
    ? `素材A只提供北京和上海学生线下班，未提供${displayName}学生线下班。`
    : "素材A只提供北京和上海学生线下班，未提供您所在地区的学生线下班。";
}

export function studentOfflineReason(
  constraints: Pick<StudentConstraints, "region" | "regionDisplayName">,
): string {
  const displayName = regionDisplayNameFor(constraints);
  if (constraints.region === "guangzhou") {
    return "广州没有学生线下班。";
  }
  return displayName
    ? `学生课程只提供北京和上海线下班，未提供${displayName}学生线下班。`
    : "学生课程只提供北京和上海线下班，未提供您所在地区的学生线下班。";
}

export function displayNameMatchesMessage(input: {
  message: string;
  evidence?: string;
  candidate: string;
}): ConfirmedStudentRegion | undefined {
  const normalized = normalizeStudentRegionName(input.candidate);
  if (!normalized?.regionDisplayName || !input.evidence) return undefined;
  const message = compact(input.message);
  const evidence = compact(input.evidence);
  const candidate = compact(input.candidate).replace(/市$/u, "");
  if (!message.includes(evidence) || !evidence.includes(candidate)) {
    return undefined;
  }
  return normalized;
}
