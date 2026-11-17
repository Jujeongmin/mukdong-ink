import { RULE_ERRORS, type RuleCode } from "../shared/types";

/** The rule code inside a failed server call (the platform may wrap the message), or null. */
export function errorCode(error: unknown): RuleCode | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return RULE_ERRORS.find((code) => message.includes(code)) ?? null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A call that never answers gives up after `ms`, so nothing waits on it for ever. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
