const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CHINESE_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
};

function parseChineseInteger(value: string): number | undefined {
  let total = 0;
  let current = 0;
  for (const character of value) {
    if (character in CHINESE_DIGITS) {
      current = CHINESE_DIGITS[character];
      continue;
    }
    const unit = CHINESE_UNITS[character];
    if (!unit) return undefined;
    total += (current || 1) * unit;
    current = 0;
  }
  const result = total + current;
  return Number.isFinite(result) ? result : undefined;
}

function parseAmountNumber(value: string): number | undefined {
  const number = /^\d[\d,]*(?:\.\d+)?$/u.test(value)
    ? Number(value.replaceAll(",", ""))
    : parseChineseInteger(value);
  return number !== undefined && Number.isFinite(number) ? number : undefined;
}

function applyUnit(value: number, unit: string | undefined): number {
  if (unit === "万") return value * 10_000;
  if (unit === "千") return value * 1_000;
  return value;
}

const AMOUNT_VALUE = String.raw`(?:\d[\d,]*(?:\.\d+)?|[零〇一二两三四五六七八九十百千]+)`;

export function extractMoneyAmounts(text: string): number[] {
  const amounts = new Set<number>();
  const rangePattern = new RegExp(
    `(${AMOUNT_VALUE})\\s*(万|千)?\\s*[—–~\\-至到]\\s*(${AMOUNT_VALUE})\\s*(万|千)?\\s*元`,
    "gu",
  );
  for (const match of text.matchAll(rangePattern)) {
    const first = parseAmountNumber(match[1]);
    const second = parseAmountNumber(match[3]);
    if (first !== undefined) amounts.add(applyUnit(first, match[2] ?? match[4]));
    if (second !== undefined) amounts.add(applyUnit(second, match[4]));
  }

  const singlePattern = new RegExp(
    `(${AMOUNT_VALUE})\\s*(万|千)?\\s*元`,
    "gu",
  );
  for (const match of text.matchAll(singlePattern)) {
    const value = parseAmountNumber(match[1]);
    if (value !== undefined) amounts.add(applyUnit(value, match[2]));
  }

  for (const match of text.matchAll(/[￥¥]\s*([0-9][0-9,]*(?:\.\d+)?)/gu)) {
    amounts.add(Number(match[1].replaceAll(",", "")));
  }
  return [...amounts].filter(Number.isFinite);
}
