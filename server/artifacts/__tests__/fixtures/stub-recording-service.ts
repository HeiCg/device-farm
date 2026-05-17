/**
 * Phase 21 / Plan 21-04 — Shared fixture per RESEARCH §Open Questions Q5.
 *
 * Stub RecordingService-shaped object with no real adb/scrcpy dependency.
 * Consumed by Plan 21-05's subscriber.spec + correlation.spec (DB-gated specs
 * that boot the artifacts plugin against a real bus but want to avoid the
 * emulator/scrcpy side-effect chain).
 *
 * Conforms to the public RecordingService surface (Phase 21 Plan 21-01 added
 * getRecordingMethod). startRecording resolves after 1ms; stopRecording returns
 * a canonical RecordingResult shape; killRecording is a no-op; isRecording
 * tracks an internal Set; getRecordingMethod returns 'scrcpy' by default.
 *
 * Usage:
 *   const { makeStubRecordingService } = await import('./fixtures/stub-recording-service.js');
 *   const stub = makeStubRecordingService();
 *   // Monkey-patch onto artifacts module:
 *   (artifactsModule as any).recordingService = stub;
 */
import type { RecordingResult } from '@device-stream/core';

export interface StubRecordingService {
  startRecording: (
    jobId: string,
    outputPath: string,
    platform: string,
    adbSerial: string,
    services: unknown,
  ) => Promise<void>;
  stopRecording: (jobId: string) => Promise<RecordingResult | null>;
  killRecording: (jobId: string) => void;
  isRecording: (jobId: string) => boolean;
  getRecordingMethod: (
    jobId: string,
  ) => 'scrcpy' | 'adb-screenrecord' | 'capture-service' | null;
}

export function makeStubRecordingService(): StubRecordingService {
  const active = new Set<string>();
  const paths = new Map<string, string>();
  return {
    startRecording: async (jobId, outputPath) => {
      await new Promise((r) => setTimeout(r, 1));
      active.add(jobId);
      paths.set(jobId, outputPath);
    },
    stopRecording: async (jobId) => {
      if (!active.has(jobId)) return null;
      active.delete(jobId);
      return {
        outputPath: paths.get(jobId) ?? `/tmp/${jobId}.mp4`,
        duration: 1,
        frameCount: 30,
        codec: 'h264',
        errors: [],
      };
    },
    killRecording: (jobId) => {
      active.delete(jobId);
    },
    isRecording: (jobId) => active.has(jobId),
    getRecordingMethod: (jobId) => (active.has(jobId) ? 'scrcpy' : null),
  };
}
