/**
 * Phase 37 Plan 37-04 Wave 1 Track D — runParallelDeploy (Build-Once-Deploy-N).
 *
 * Direct port of kittyfarm/Lifecycle/BuildPlayRunner.swift:118-141 (iOS) and
 * :185-200 (Android) — both use `withThrowingTaskGroup` for fan-out post-build.
 *
 * Algorithm:
 *   1. Pre-allocate N devices via PoolManager.allocateMany (all-or-nothing —
 *      raises AggregateError if fewer than N devices are healthy idle; the
 *      caller wraps that as 503 Retry-After per Pitfall 9).
 *   2. The artifact (apk/ipa) has already been uploaded ONCE by the existing
 *      multipart submit path — `job.artifactPath` points to it. SKIP rebuild.
 *      That's the "Build Once" half: one upload, N deploys.
 *   3. Run installAndLaunch(device, artifact, flow, env) in parallel via
 *      Promise.allSettled. A failing device does NOT cancel the others
 *      (kittyfarm parity — error: <name> + continue;
 *      BuildPlayRunner.swift:130-135).
 *   4. Aggregate per-device results into ParallelDeployResult. No rollback
 *      on partial failure — successful devices keep their state.
 *
 * The function is intentionally dependency-injected for testability:
 *   - `pool`: PoolModule (provides allocateMany + release)
 *   - `installAndLaunch`: per-device install + launch primitive (real
 *     production wiring calls executor.installApk + Maestro launch; tests
 *     inject mocks)
 *   - `logger`: pino logger
 */
import type pino from 'pino';
import type { DeviceInfo, Platform } from '../../types/index.js';
import type { PoolModule } from '../../pool/index.js';

// ---------- Public types ----------

export interface ParallelDeployJobInput {
  jobId: string;
  platform: Platform;
  parallelism: number;
  /**
   * Filesystem path to the .apk (Android) or .ipa (iOS) uploaded once via
   * the existing multipart submit path. The same path is consumed by every
   * device in the fan-out — "build once, deploy N" semantics.
   */
  artifactPath: string;
  /** Maestro flow YAML content (single multi-document string). */
  maestroFlow: string;
  envVars?: Record<string, string>;
}

export interface ParallelDeployPerDeviceResult {
  deviceId: string;
  status: 'passed' | 'failed';
  error?: string;
  durationMs?: number;
}

export interface ParallelDeployResult {
  jobId: string;
  deviceCount: number;
  devices: ParallelDeployPerDeviceResult[];
}

/**
 * Per-device install + launch primitive. The deps abstraction lets tests
 * inject mocks without spinning up the full executor / Maestro stack.
 *
 * Production wiring: see server/jobs/internal/executor.ts parallel-deploy
 * branch — calls JobExecutor.installApk + executor.execute against the
 * allocated device.
 */
export type InstallAndLaunch = (
  device: DeviceInfo,
  artifactPath: string,
  flow: string,
  envVars?: Record<string, string>,
) => Promise<void>;

export interface RunParallelDeployDeps {
  pool: Pick<PoolModule, 'allocateMany'>;
  installAndLaunch: InstallAndLaunch;
  logger: pino.Logger;
}

// ---------- Implementation ----------

export async function runParallelDeploy(
  deps: RunParallelDeployDeps,
  job: ParallelDeployJobInput,
): Promise<ParallelDeployResult> {
  const log = deps.logger.child({
    component: 'parallel-deploy',
    jobId: job.jobId,
    platform: job.platform,
    parallelism: job.parallelism,
  });

  // 1. Pre-allocate N devices. All-or-nothing — if fewer than N healthy idle
  //    devices exist, allocateMany throws AggregateError and the caller surfaces
  //    503 + Retry-After. Pitfall 9 is enforced at the route layer BEFORE we
  //    get here, but allocateMany also throws on races for defense-in-depth.
  const devices = await deps.pool.allocateMany(job.platform, job.parallelism);
  log.info({ deviceIds: devices.map((d) => d.id) }, 'parallel-deploy: devices allocated');

  // 2. Build artifact already uploaded once via the existing multipart submit
  //    path. Skip rebuild — that's the "Build Once" half.

  // 3. Fan-out install + launch via Promise.allSettled (the TS translation of
  //    Swift withThrowingTaskGroup). A failing device does NOT cancel the
  //    other devices — kittyfarm BuildPlayRunner.swift:130-135 parity.
  const perDeviceResults = await Promise.allSettled(
    devices.map(async (d) => {
      const start = Date.now();
      try {
        await deps.installAndLaunch(d, job.artifactPath, job.maestroFlow, job.envVars);
        return { deviceId: d.id, durationMs: Date.now() - start };
      } catch (err) {
        // Re-throw so Promise.allSettled captures it as rejected; we attach
        // device id + duration in the aggregator below.
        const wrap = err instanceof Error ? err : new Error(String(err));
        (wrap as Error & { __deviceId?: string; __durationMs?: number }).__deviceId = d.id;
        (wrap as Error & { __deviceId?: string; __durationMs?: number }).__durationMs = Date.now() - start;
        throw wrap;
      }
    }),
  );

  // 4. Aggregate per-device results. NO rollback on partial failure —
  //    successful devices keep their state (kittyfarm parity).
  const aggregated: ParallelDeployPerDeviceResult[] = perDeviceResults.map((r, i) => {
    if (r.status === 'fulfilled') {
      return {
        deviceId: devices[i].id,
        status: 'passed' as const,
        durationMs: r.value.durationMs,
      };
    }
    const wrap = r.reason as Error & { __deviceId?: string; __durationMs?: number };
    return {
      deviceId: wrap.__deviceId ?? devices[i].id,
      status: 'failed' as const,
      error: wrap instanceof Error ? wrap.message : String(wrap),
      durationMs: wrap.__durationMs,
    };
  });

  const failed = aggregated.filter((d) => d.status === 'failed').length;
  log.info(
    { deviceCount: devices.length, failed, passed: devices.length - failed },
    'parallel-deploy: completed',
  );

  return {
    jobId: job.jobId,
    deviceCount: devices.length,
    devices: aggregated,
  };
}
