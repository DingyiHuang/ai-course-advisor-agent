export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

export type BusinessDate = `${number}-${number}-${number}`;

export type Clock = {
  now: () => Date;
};

export const systemClock: Clock = {
  now: () => new Date(),
};

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertBusinessDate(value: string): asserts value is BusinessDate {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    throw new Error(`Invalid business date: ${value}`);
  }
}

export function toShanghaiDate(
  input: Date | string | number,
): BusinessDate {
  const instant = input instanceof Date ? input : new Date(input);

  if (Number.isNaN(instant.getTime())) {
    throw new Error(`Invalid instant: ${String(input)}`);
  }

  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to format instant in ${SHANGHAI_TIME_ZONE}`);
  }

  const businessDate = `${year}-${month}-${day}`;
  assertBusinessDate(businessDate);
  return businessDate;
}

export function shanghaiToday(clock: Clock = systemClock): BusinessDate {
  return toShanghaiDate(clock.now());
}

export function isOnOrBefore(
  currentDate: BusinessDate,
  deadline: BusinessDate,
): boolean {
  return currentDate <= deadline;
}

export function isDeadlineActive(
  deadline: string,
  clock: Clock = systemClock,
): boolean {
  assertBusinessDate(deadline);
  return isOnOrBefore(shanghaiToday(clock), deadline);
}

export function fixedClock(instant: string | Date): Clock {
  const fixedInstant = instant instanceof Date ? instant : new Date(instant);

  if (Number.isNaN(fixedInstant.getTime())) {
    throw new Error(`Invalid fixed clock instant: ${String(instant)}`);
  }

  return { now: () => new Date(fixedInstant.getTime()) };
}
