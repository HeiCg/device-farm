/**
 * Formatting utility functions for the dashboard UI.
 */
import { formatDistanceToNow } from 'date-fns';

/**
 * Returns a relative time string like "2 minutes ago".
 */
export function formatRelativeTime(date: string): string {
	return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/**
 * Returns a formatted duration string like "1m 23s" or "--" if not available.
 */
export function formatDuration(startedAt: string | null, finishedAt: string | null): string {
	if (!startedAt || !finishedAt) return '--';

	const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	if (minutes === 0) return `${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

/**
 * Maps a job status to Kinetic Console design-token class names.
 */
export function statusStyle(status: string): { color: string; bg: string; label: string } {
	switch (status) {
		case 'passed':
			return { color: 'text-secondary', bg: 'bg-secondary', label: 'Passed' };
		case 'failed':
			return { color: 'text-tertiary', bg: 'bg-tertiary', label: 'Failed' };
		case 'running':
			return { color: 'text-primary', bg: 'bg-primary', label: 'Running' };
		case 'queued':
			return { color: 'text-on-surface-variant', bg: 'bg-surface-variant', label: 'Queued' };
		case 'cancelled':
			return { color: 'text-on-surface-variant', bg: 'bg-surface-variant', label: 'Cancelled' };
		case 'timeout':
			return { color: 'text-tertiary', bg: 'bg-tertiary', label: 'Timeout' };
		case 'error':
			return { color: 'text-tertiary', bg: 'bg-tertiary', label: 'Error' };
		default:
			return { color: 'text-on-surface-variant', bg: 'bg-surface-variant', label: status };
	}
}

/**
 * Returns a display-friendly platform label.
 */
export function platformLabel(platform: string): string {
	if (platform === 'ios') return 'iOS';
	if (platform === 'android') return 'Android';
	return platform;
}
