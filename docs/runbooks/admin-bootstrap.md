# Runbook — Admin Claim Bootstrap

> Phase 26 (DEFERRED-23-A resolution). Operator-facing procedure for granting
> the FIRST admin claim on an API key after migration `0026_api_keys_claims.sql`
> has been applied.

## When to use this

Run AFTER:

1. Server upgraded to Phase 26 (the `apiKeys.claims` JSONB column exists per migration 0026).
2. At least one API key exists in `api_keys` table (created via `POST /admin/keys` or seeded).

Required to grant the FIRST admin so subsequent admin grants can flow through
the `POST /api/keys/:id/claims/admin` route (which itself requires an existing
admin to authorize new grants — chicken-and-egg). Phase 28 will provide
a CLI command (`device-farm admin-grant <keyId>`) — DEFERRED-26-A.

## Prerequisites

- Direct DB access (`psql` or equivalent).
- The `api_keys.id` UUID of the key to elevate. Find via:
  ```sql
  SELECT id, name, key_prefix, claims, revoked FROM api_keys ORDER BY created_at DESC LIMIT 10;
  ```

## Procedure

1. Identify target key:
   ```sql
   SELECT id, name FROM api_keys WHERE name = 'your-bootstrap-key';
   ```

2. Grant admin claim (preserves any other JSONB keys via `jsonb_set`):
   ```sql
   UPDATE api_keys
     SET claims = jsonb_set(coalesce(claims, '{}'::jsonb), '{admin}', 'true'::jsonb, true)
     WHERE id = '<key-uuid>';
   ```

3. Verify:
   ```sql
   SELECT id, name, claims FROM api_keys WHERE id = '<key-uuid>';
   -- Expect: claims = {"admin": true}
   ```

4. Test via HTTP — the bootstrapped key should now succeed against `/admin/drain`:
   ```bash
   curl -X POST -H "Authorization: Bearer <raw-key>" http://localhost:3000/admin/drain?timeout=10
   # Expect 200 with {drained: true|false, in_flight, ...}
   # NOT 403 (which would indicate claim absent or column missing)
   ```

## Rollback (revoke admin)

To DEMOTE a key (set `claims.admin = false` while preserving other JSONB keys):

```sql
UPDATE api_keys
  SET claims = jsonb_set(coalesce(claims, '{}'::jsonb), '{admin}', 'false'::jsonb, true)
  WHERE id = '<key-uuid>';
```

Or use the HTTP route (requires another admin to authorize):

```bash
curl -X POST -H "Authorization: Bearer <other-admin-key>" \
     -H "Content-Type: application/json" \
     -d '{"admin": false}' \
     http://localhost:3000/api/keys/<key-uuid>/claims/admin
```

## Why SQL bootstrap, not HTTP

`POST /api/keys/:id/claims/admin` is gated on `requireAdmin` middleware, which
asserts `request.apiKey?.claims?.admin === true` on the CALLER. With ZERO
admins existing post-migration, no caller can pass the gate — hence the SQL
bootstrap. This is intentional: privilege escalation should require operator
DB access.

## Forward pointer

DEFERRED-26-A: Phase 28 (CLI Refactor) ships `device-farm admin-grant <keyId>`
Go subcommand wrapping the same SQL operation with safety prompts. Phase 26
server-side endpoint is the substrate; CLI is the ergonomic surface.

## Related

- `docs/runbooks/drain.md` — drain endpoint procedure (now gated on `requireAdmin`).
- `server/auth/internal/require-admin.ts` — middleware enforcing `claims.admin === true`.
- `server/auth/internal/auth-service.ts` — `grantAdminClaim` method backing the HTTP route.
