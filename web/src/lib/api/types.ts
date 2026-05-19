/**
 * Client-side TypeScript types mirroring server schemas.
 */

export type Platform = 'android' | 'ios';

export enum DeviceState {
	Booting = 'booting',
	Idle = 'idle',
	Allocated = 'allocated',
	Running = 'running',
	Cleanup = 'cleanup',
	Error = 'error',
	Offline = 'offline'
}

export type JobStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'timeout';

export interface Job {
	id: string;
	status: JobStatus;
	platform: Platform;
	deviceId: string | null;
	metadata: Record<string, unknown> | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	resultSummary: Record<string, unknown> | null;
	errorMessage: string | null;
}

export interface JobStep {
	id: string;
	jobId: string;
	stepIndex: number;
	flowName: string;
	command: string | null;
	status: string;
	durationMs: number | null;
	error: string | null;
}

export interface Artifact {
	id: string;
	jobId: string;
	type: string;
	fileName: string;
	mimeType: string;
	fileSizeBytes: number;
	createdAt: string;
}

export interface Device {
	id: string;
	name: string;
	platform: Platform;
	state: DeviceState;
	emulatorId: string;
	currentJobId: string | null;
	port: number | null;
	pid: number | null;
	metadata: DeviceMetadata | null;
}

export interface DeviceMetadata {
	osVersion: string | null;
	sdkVersion: string | null;
	screenWidth: number | null;
	screenHeight: number | null;
	screenDensity: number | null;
	ramMb: number | null;
	abi: string | null;
	manufacturer: string | null;
	model: string | null;
	locale: string | null;
	timezone: string | null;
	batteryLevel: number | null;
	collectedAt: string;
}

export interface PaginatedResponse<T> {
	data: T[];
	cursor: string | null;
	hasMore: boolean;
}

/** Mirrors GET /api/health response */
export interface HealthResponse {
	status: string;
	uptime: number;
	devices: Device[];
	queue: { android: number; ios: number };
}

// WebSocket message types

// Phase 31 SC1 adds the `'crash-detected'` event for the dashboard
// "Crash detected" badge; Phase 31 SC2 introduces a `'batch'` outer envelope
// at the transport layer that is unwrapped in `job-stream.svelte.ts` before
// inner items reach this union (the wrapper itself is not a JobMessage).
export type WsMessageType =
	| 'log'
	| 'step'
	| 'metrics'
	| 'status'
	| 'crash-detected';

export interface JobMessage {
	type: WsMessageType;
	data: unknown;
	timestamp: string;
}

export interface LogData {
	line: string;
	stream: 'stdout' | 'stderr';
}

export interface StepData {
	flowName: string;
	command: string | null;
	status: string;
	durationMs: number | null;
}

export interface MetricsData {
	totalPss: number;
	nativeHeap: number;
	javaHeap: number;
}

export interface StatusData {
	status: 'running' | 'passed' | 'failed' | 'cancelled' | 'timeout';
}

// --- Hierarchy / Inspector types (mirrors server/maestro/hierarchy-service.ts) ---

/** Source strategy for hierarchy fetching */
export type HierarchySource = 'maestro-cli' | 'device-server' | 'native' | 'appium';

/** Single UI element in the hierarchy tree */
export interface HierarchyNode {
	type: string;
	id: string | null;
	text: string | null;
	description: string | null;
	enabled: boolean;
	visible: boolean;
	focused: boolean;
	clickable: boolean;
	bounds: [number, number, number, number] | null;
	children: HierarchyNode[];
}

/** Result from hierarchy fetch */
export interface HierarchyResult {
	tree: HierarchyNode[];
	source: string;
	fetchTimeMs: number;
	capturedAt: string;
	elementCount: number;
}

/** Result from element query */
export interface QueryResult {
	matches: HierarchyNode[];
	query: string;
	source: string;
}

// --- Hook types (mirrors server/hooks/hook-executor.ts) ---

/** Lifecycle event that triggers a hook */
export type HookEvent = 'device.booted' | 'device.shutdown' | 'test.before' | 'test.after';

/** Hook payload kind. `shell` runs a /bin/sh command; `script` runs a TS snippet via @device-stream/dsl. */
export type HookKind = 'shell' | 'script';

/** A configured lifecycle hook */
export interface HookDefinition {
	/** Unique name for this hook */
	name: string;
	/** Which lifecycle event triggers this hook */
	event: HookEvent;
	/** Payload kind. Defaults to 'shell' for back-compat. */
	kind: HookKind;
	/** Shell command to execute (kind=shell only). Supports {{variable}} templates. */
	command?: string;
	/** TS snippet body (kind=script only). Has `ds`, `vars`, `ctx` in scope. */
	script?: string;
	/** Default vars merged with per-invocation context.vars (script hooks). */
	vars?: Record<string, unknown>;
	/** iOS only — selects between simctl and go-ios paths (defaults 'simulator' in driver). */
	iosKind?: 'simulator' | 'device';
	/** Platform filter: 'android', 'ios', or 'all' */
	platform: 'android' | 'ios' | 'all';
	/** Timeout in ms */
	timeoutMs: number;
	/** If true, a hook failure will abort the pipeline */
	failOnError: boolean;
	/** Whether this hook is active */
	enabled: boolean;
}

/** Result of executing a hook (returned by test-run endpoint) */
export interface HookResult {
	hookName: string;
	event: HookEvent;
	command: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	success: boolean;
	error?: string;
}

// --- Maestro execution options (extracted from job.metadata) ---

export interface MaestroOptions {
	includeTags: string[];
	excludeTags: string[];
	reportFormat: string | null;
	debugOutput: boolean;
	shards: number | null;
}

/**
 * Defensively extract known Maestro option keys from a job's metadata.
 * Returns null if metadata is absent or contains no Maestro-specific keys,
 * which signals the UI to render nothing.
 */
export function extractMaestroOptions(metadata: Record<string, unknown> | null): MaestroOptions | null {
	if (!metadata) return null;
	const includeTags = Array.isArray(metadata.includeTags)
		? metadata.includeTags.filter((t): t is string => typeof t === 'string')
		: [];
	const excludeTags = Array.isArray(metadata.excludeTags)
		? metadata.excludeTags.filter((t): t is string => typeof t === 'string')
		: [];
	const reportFormat = typeof metadata.reportFormat === 'string' ? metadata.reportFormat : null;
	const debugOutput = metadata.debugOutput === true;
	const shards = typeof metadata.shards === 'number' ? metadata.shards : null;
	// Return null if nothing is populated — panel renders nothing
	if (includeTags.length === 0 && excludeTags.length === 0 && !reportFormat && !debugOutput && shards === null) {
		return null;
	}
	return { includeTags, excludeTags, reportFormat, debugOutput, shards };
}

// --- Report bundle types (Phase 4 UI) ---

export interface ReportStepLite {
	id: string;
	flowName: string | null;
	command: string | null;
	status: 'passed' | 'failed' | 'skipped' | 'running';
	durationMs: number | null;
	startedAt: string | null;
	finishedAt: string | null;
	error: string | null;
	screenshotPath: string | null;
	videoOffsetMs: number | null;
}

export interface ReportArtifactLite {
	id: string;
	type: 'video' | 'screenshot' | 'memory' | 'log';
	fileName: string;
	mimeType: string;
	fileSizeBytes: number | null;
	videoStartedAt?: string | null;
	downloadUrl: string;
}

export interface ReportBundle {
	job: {
		id: string; status: string; platform: string;
		createdAt: string; startedAt: string | null; finishedAt: string | null;
		deviceId: string | null; durationMs: number | null;
		summary: { total: number; passed: number; failed: number; skipped: number };
		maestroVersion?: string | null;
		osVersion?: string | null;
	};
	steps: ReportStepLite[];
	artifacts: ReportArtifactLite[];
	failureFocus: null | {
		stepId: string; flowName: string | null; command: string | null;
		error: string; screenshotPath: string | null;
		logTailLines: string[]; videoOffsetMs: number | null;
	};
	reportLinks: { junitXml: string; logsRaw: string };
	history: null | {
		flowName: string | null;
		runs: Array<{ jobId: string; status: string; finishedAt: string | null; durationMs: number | null }>;
		passRate: number; avgDurationMs: number;
	};
}

