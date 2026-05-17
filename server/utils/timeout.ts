/**
 * Timeout utility — wraps a promise with a race against a timer.
 */

export class TimeoutError extends Error {
  constructor(ms: number, label?: string) {
    super(`${label ?? 'Operation'} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(ms: number, fn: () => Promise<T>, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
    fn().then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
