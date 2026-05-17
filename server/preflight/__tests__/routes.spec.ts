/**
 * Phase 37 Plan 37-02 Wave 1 — preflight HTTP routes spec.
 *
 * Covers:
 *   - POST /api/preflight multipart with synthetic IPA → 200 + report
 *   - missing file → 400 with RFC 7807 problem+json
 *   - unsupported extension → 400
 *   - malformed archive → 400 (problem+json type: about:blank#malformed-archive)
 *
 * Uses Fastify app.inject() with a multipart payload built via FormData.
 * Module is stubbed (no DB) — repo.create is a vi.fn() returning a fake row.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { registerPreflightRoutes } from '../routes.js';
import type { PreflightReport } from '../internal/rule-engine.js';

function buildSyntheticIpa(opts: {
  bundleName: string;
  hasPrivacyManifest: boolean;
  hasUserDefaultsSymbol: boolean;
}): { ipaPath: string; cleanupDir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-route-'));
  const appDir = join(dir, 'Payload', `${opts.bundleName}.app`);
  execFileSync('mkdir', ['-p', appDir]);
  const infoXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.example.${opts.bundleName}</string>
<key>CFBundleName</key><string>${opts.bundleName}</string>
<key>CFBundleExecutable</key><string>${opts.bundleName}</string>
</dict></plist>
`;
  writeFileSync(join(appDir, 'Info.plist'), infoXml);
  if (opts.hasPrivacyManifest) {
    const pm = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>NSPrivacyAccessedAPITypes</key><array><dict>
<key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryUserDefaults</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array><string>CA92.1</string></array>
</dict></array>
</dict></plist>
`;
    writeFileSync(join(appDir, 'PrivacyInfo.xcprivacy'), pm);
  }
  // The "executable" is a placeholder. `nm` either runs (returns empty on a
  // shell script) or fails gracefully — both paths produce an empty symbol
  // list, so we manually patch via module.scan's parsed result if needed.
  writeFileSync(join(appDir, opts.bundleName), Buffer.from('#!/bin/sh\necho hi\n'));
  const ipaPath = join(dir, `${opts.bundleName}.ipa`);
  execFileSync('zip', ['-r', '-q', ipaPath, 'Payload'], { cwd: dir });
  return { ipaPath, cleanupDir: dir };
}

interface ScanStub {
  scan: ReturnType<typeof vi.fn>;
  repo: { create: ReturnType<typeof vi.fn>; getById: ReturnType<typeof vi.fn> };
  events: { completed: ReturnType<typeof vi.fn> };
}

function makeScanStub(report: PreflightReport): ScanStub {
  return {
    scan: vi.fn().mockResolvedValue({ runId: 'run-stub-1', report }),
    repo: {
      create: vi.fn().mockResolvedValue({ id: 'run-stub-1' }),
      getById: vi.fn(),
    },
    events: { completed: vi.fn() },
  };
}

async function buildApp(stub: ScanStub) {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 300_000_000, files: 5 } });
  registerPreflightRoutes(app, { module: stub as never });
  return app;
}

function makeMultipartBody(
  filename: string,
  fileBytes: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----PreflightTest' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, fileBytes, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('POST /api/preflight', () => {
  it('200 + report when multipart .ipa uploaded', async () => {
    const stub = makeScanStub({
      status: 'blocked',
      rules_version: '2026-05-17',
      platform: 'ios',
      blockers: [{ rule_id: 'ITMS-91053-USERDEFAULTS', severity: 'blocker', message: 'x' }],
      warnings: [],
    });
    const app = await buildApp(stub);

    const { ipaPath, cleanupDir } = buildSyntheticIpa({
      bundleName: 'BadApp',
      hasPrivacyManifest: false,
      hasUserDefaultsSymbol: true,
    });
    try {
      const ipaBytes = readFileSync(ipaPath);
      const mp = makeMultipartBody('BadApp.ipa', ipaBytes);
      const res = await app.inject({
        method: 'POST',
        url: '/api/preflight',
        payload: mp.payload,
        headers: mp.headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('blocked');
      expect(body.blockers[0].rule_id).toBe('ITMS-91053-USERDEFAULTS');
      expect(stub.scan).toHaveBeenCalledOnce();
    } finally {
      rmSync(cleanupDir, { recursive: true, force: true });
      await app.close();
    }
  }, 30_000);

  it('400 when no file is uploaded', async () => {
    const stub = makeScanStub({
      status: 'pass',
      rules_version: '2026-05-17',
      platform: 'ios',
      blockers: [],
      warnings: [],
    });
    const app = await buildApp(stub);
    try {
      const mp = makeMultipartBody('', Buffer.alloc(0));
      // missing file: send empty multipart with no parts
      const boundary = '----Empty' + Math.random().toString(36).slice(2);
      const res = await app.inject({
        method: 'POST',
        url: '/api/preflight',
        payload: Buffer.from(`--${boundary}--\r\n`, 'utf8'),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.type).toMatch(/missing-file|about:blank/);
      expect(body.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('400 when extension is not .ipa or .apk', async () => {
    const stub = makeScanStub({
      status: 'pass',
      rules_version: '2026-05-17',
      platform: 'ios',
      blockers: [],
      warnings: [],
    });
    const app = await buildApp(stub);
    try {
      const mp = makeMultipartBody('foo.txt', Buffer.from('not an archive'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/preflight',
        payload: mp.payload,
        headers: mp.headers,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.type).toMatch(/unsupported|about:blank/);
      expect(body.status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('400 when archive is malformed', async () => {
    const stub: ScanStub = {
      scan: vi.fn().mockRejectedValue(new Error('Invalid zip: malformed archive')),
      repo: { create: vi.fn(), getById: vi.fn() },
      events: { completed: vi.fn() },
    };
    const app = await buildApp(stub);
    try {
      const mp = makeMultipartBody('bad.ipa', Buffer.from('this is not a zip'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/preflight',
        payload: mp.payload,
        headers: mp.headers,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.type).toContain('malformed-archive');
      expect(body.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});
