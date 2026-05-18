import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

// ---------------------------------------------------------------------------
// Share-token URL allowlist helpers (used by auth/plugin.ts + api/plugin.ts)
// ---------------------------------------------------------------------------

/**
 * Routes on which a valid ?t=<jwt> share token bypasses bearer auth.
 * Patterns match both /jobs/... and /api/jobs/... to be prefix-agnostic.
 */
export const TOKEN_ALLOWED_PATTERNS: RegExp[] = [
  /^\/(api\/)?jobs\/[^/]+$/,                      // /jobs/:id
  /^\/(api\/)?jobs\/[^/]+\/report$/,              // /jobs/:id/report
  /^\/(api\/)?jobs\/[^/]+\/artifacts(\/.*)?$/,    // /jobs/:id/artifacts*
  /^\/(api\/)?jobs\/[^/]+\/logs$/,                // /jobs/:id/logs
  /^\/(api\/)?jobs\/[^/]+\/reports\/junit\.xml$/, // /jobs/:id/reports/junit.xml
];

export function extractJobId(url: string): string | null {
  const m = url.match(/^\/(?:api\/)?jobs\/([^/]+)/);
  return m ? m[1] : null;
}

export function isTokenAllowedPath(pathname: string): boolean {
  return TOKEN_ALLOWED_PATTERNS.some((re) => re.test(pathname));
}

export interface ReportTokenServiceOpts {
  secret: string;
}

export interface MintArgs {
  jobId: string;
  ttlDays: 5 | 15 | 30;
  nowMs?: number;
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'expired' | 'invalid-signature' | 'subject-mismatch' | 'malformed';
  expiresAt?: Date;
}

export interface ReportTokenService {
  mint(args: MintArgs): Promise<{ token: string; expiresAt: Date }>;
  verify(token: string, jobId: string): Promise<VerifyResult>;
}

export function createReportTokenService(opts: ReportTokenServiceOpts): ReportTokenService {
  const key = new TextEncoder().encode(opts.secret);

  return {
    async mint({ jobId, ttlDays, nowMs }) {
      const iat = Math.floor((nowMs ?? Date.now()) / 1000);
      const exp = iat + ttlDays * 24 * 60 * 60;
      const token = await new SignJWT({ scope: 'read' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(`job:${jobId}`)
        .setIssuedAt(iat)
        .setExpirationTime(exp)
        .sign(key);
      return { token, expiresAt: new Date(exp * 1000) };
    },

    async verify(token, jobId) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        if (payload.sub !== `job:${jobId}`) {
          return { ok: false, reason: 'subject-mismatch' };
        }
        return { ok: true, expiresAt: payload.exp ? new Date(payload.exp * 1000) : undefined };
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: 'expired' };
        if (err instanceof joseErrors.JWSSignatureVerificationFailed) return { ok: false, reason: 'invalid-signature' };
        if (err instanceof joseErrors.JWSInvalid) return { ok: false, reason: 'invalid-signature' };
        return { ok: false, reason: 'malformed' };
      }
    },
  };
}
