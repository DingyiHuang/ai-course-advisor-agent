import { LlmError } from "./types";

export function isRetryableModelError(error: unknown): boolean {
  if (!(error instanceof LlmError)) return true;
  if (error.code === "configuration_error") return false;
  if (error.code !== "http_error") return true;
  return (
    error.httpStatus === 408 ||
    error.httpStatus === 409 ||
    error.httpStatus === 429 ||
    (error.httpStatus !== undefined && error.httpStatus >= 500)
  );
}

export async function withOneModelRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableModelError(error)) throw error;
    return operation();
  }
}
