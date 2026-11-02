export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  /** Return true to retry after this result. */
  shouldRetry: (result: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Small retry helper for operations that report failure through their return value (never throw).
 * Exponential backoff with full jitter: delay = rand(0, base * 2^attempt).
 */
export async function withRetry<T>(op: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let result = await op(0);
  for (let attempt = 1; attempt <= opts.retries && opts.shouldRetry(result); attempt++) {
    await sleep(Math.random() * opts.baseDelayMs * 2 ** (attempt - 1));
    result = await op(attempt);
  }
  return result;
}

/** fetch with an AbortController timeout. Rejects with an Error whose name is 'TimeoutError' on timeout. */
export async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (controller.signal.aborted) {
      const e = new Error(`Request timed out after ${timeoutMs} ms`);
      e.name = 'TimeoutError';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
