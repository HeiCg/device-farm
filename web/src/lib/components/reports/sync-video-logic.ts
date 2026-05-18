/**
 * Convert step-marker offsets (ms from video start) to CSS percentage
 * positions for rendering on a fixed-width track under the video.
 * Markers outside the video duration are dropped (not clamped) — they
 * represent steps that occurred after the recording stopped, which would
 * be confusing to display.
 */
export function markerPositionsPercent(markersMs: number[], durationMs: number | null): number[] {
  if (!durationMs || durationMs <= 0) return [];
  return markersMs
    .filter((m) => m >= 0 && m <= durationMs)
    .map((m) => (m / durationMs) * 100);
}
