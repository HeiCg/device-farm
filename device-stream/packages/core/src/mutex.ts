/**
 * Simple async mutex implementation for thread-safety
 * Prevents race conditions in concurrent operations
 */
export class AsyncMutex {
  private locked = false;
  private waitQueue: Array<() => void> = [];

  /**
   * Acquire the lock
   * Waits if lock is already held by another operation
   */
  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.waitQueue.push(resolve);
      }
    });
  }

  /**
   * Release the lock
   * Allows next waiting operation to proceed
   */
  release(): void {
    if (!this.locked) {
      throw new Error('AsyncMutex: release() called without a matching acquire()');
    }
    const nextResolve = this.waitQueue.shift();
    if (nextResolve) {
      nextResolve();
    } else {
      this.locked = false;
    }
  }

  /**
   * Execute a function with the lock held
   * Automatically releases the lock when done
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if lock is currently held
   */
  isLocked(): boolean {
    return this.locked;
  }
}

/**
 * Per-device mutex manager
 * Creates separate mutexes for each device to allow parallel operations across devices
 */
export class DeviceMutexManager {
  private mutexes: Map<string, AsyncMutex> = new Map();

  /**
   * Get or create mutex for a specific device
   */
  getMutex(deviceId: string): AsyncMutex {
    let mutex = this.mutexes.get(deviceId);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.mutexes.set(deviceId, mutex);
    }
    return mutex;
  }

  /**
   * Execute a function with device-specific lock
   */
  async withDeviceLock<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    const mutex = this.getMutex(deviceId);
    return mutex.withLock(fn);
  }

  /**
   * Clean up mutex for a device (when device is removed)
   */
  removeMutex(deviceId: string): void {
    const mutex = this.mutexes.get(deviceId);
    if (mutex?.isLocked()) {
      throw new Error(`Cannot remove mutex for device ${deviceId}: lock is currently held`);
    }
    this.mutexes.delete(deviceId);
  }

  /**
   * Get number of active mutexes
   */
  get size(): number {
    return this.mutexes.size;
  }
}
