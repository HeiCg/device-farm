/**
 * Phase 37 Plan 37-01 — skeleton viewer route loader.
 *
 * Fetches GET /api/builds/<id>/skeleton. Sets `notFound:true` on 404 so
 * the page renders an empty-state with a CLI command rather than a hard
 * error — uploaded skeletons are optional per-build.
 */
import { ApiError, apiFetch } from '$lib/api/client.js';
import type { PageLoad } from './$types.js';

export interface SkeletonPayload {
	schema_version: 1;
	platform: 'ios';
	app: {
		bundle_id: string;
		version?: string | null;
		executable?: string | null;
	};
	react_native_bundle: {
		detected: boolean;
		hermes: boolean;
		bundle_path?: string | null;
	} | null;
	stats: {
		total_classes: number;
		total_swift_types: number;
	};
	candidate_screens: Array<{
		name: string;
		source: 'objc_classlist' | 'swift5_types' | 'hermes_strings';
		confidence: 'high' | 'medium' | 'low';
		module?: string | null;
	}>;
	deep_link_entries: Array<{
		scheme: string;
		host?: string | null;
		path?: string | null;
		source: 'info_plist' | 'associated_domains';
	}>;
	known_gaps: Array<{ kind: string; message: string }>;
}

export interface AnalysisResponse {
	id: string;
	jobId: string | null;
	buildArtifactId: string | null;
	platform: 'android' | 'ios';
	payload: SkeletonPayload;
	createdAt: string;
}

export interface SkeletonPageData {
	buildId: string;
	skeleton: AnalysisResponse | null;
	notFound: boolean;
}

export const load: PageLoad = async ({
	params
}: {
	params: { id: string };
}): Promise<SkeletonPageData> => {
	try {
		const skeleton = await apiFetch<AnalysisResponse>(`/builds/${params.id}/skeleton`);
		return { buildId: params.id, skeleton, notFound: false };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			return { buildId: params.id, skeleton: null, notFound: true };
		}
		throw err;
	}
};
