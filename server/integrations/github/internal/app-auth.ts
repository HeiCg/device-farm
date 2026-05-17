/**
 * Phase 37 Plan 37-03 Track C — GitHub App authentication.
 *
 * Wraps `@octokit/app` for installation-token flow. Per Pitfall 4 in
 * 37-RESEARCH.md: @octokit/auth-app handles TTL (1h) + caching + auto-refresh
 * transparently. Callers MUST request a fresh Octokit instance at the start
 * of every webhook handler — NEVER store an instance across event boundaries.
 *
 * Per Pitfall 4 invariant: never log installation tokens.
 */

import { App } from '@octokit/app';

export interface CreateGithubAppOpts {
  appId: number;
  /** PEM-encoded RSA private key (BEGIN RSA PRIVATE KEY / BEGIN PRIVATE KEY). */
  privateKey: string;
  /** Webhook secret used by routes.ts for HMAC verify; not used by App itself
   *  for outbound API calls, but kept paired here so the module factory has
   *  a single auth surface to consume. */
  webhookSecret: string;
}

export function createGithubApp(opts: CreateGithubAppOpts): App {
  return new App({
    appId: opts.appId,
    privateKey: opts.privateKey,
    webhooks: { secret: opts.webhookSecret },
  });
}

/**
 * Fetch an installation-scoped Octokit. Auth-app caches the install token and
 * auto-refreshes ~5 min before expiry. Caller invariant: do not store the
 * returned instance across webhook deliveries — fetch fresh per handler.
 */
export async function getInstallationOctokit(app: App, installationId: number) {
  // Returns Octokit (typed by @octokit/app as ReturnType<App['getInstallationOctokit']>).
  // We intentionally do NOT log here — token material would surface in pino output.
  return app.getInstallationOctokit(installationId);
}

export type InstallationOctokit = Awaited<ReturnType<typeof getInstallationOctokit>>;
