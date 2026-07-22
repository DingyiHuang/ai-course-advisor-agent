export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

export function validateUserMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InputValidationError("请输入问题后再发送");
  }
  const message = value.trim();
  if (message.length > 500) {
    throw new InputValidationError("单次输入不能超过500字");
  }
  if (/\p{C}/u.test(message.replace(/[\n\r\t]/gu, ""))) {
    throw new InputValidationError("输入包含无法处理的控制字符");
  }
  if (!/[\p{L}\p{N}\u3400-\u9fff]/u.test(message)) {
    throw new InputValidationError("请补充可识别的文字或数字");
  }
  return message;
}
