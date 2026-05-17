#!/usr/bin/env node
// scripts/extract-ws-schemas.mjs
// Phase 17 Plan 17-04 — normalize contracts/ws-messages.json into a flat JSON Schema
// that atombender/go-jsonschema can consume. Handles Zod 4 registry emission shapes
// where schemas are nested under `schemas`, `$defs`, or `definitions` keys.
//
// Input:  contracts/ws-messages.json (emitted by server/scripts/build-openapi.ts)
// Output: /tmp/df-ws-schemas.json   (consumed by cli/Makefile `types` target)
//
// Current Zod 4 emission shape (observed 2026-04-20):
//   {
//     "schemas": {
//       "JobLogMessage": { "type": "object", "properties": { ..., "$ref": "__shared#/$defs/schemaN" } },
//       ...6 more variants...,
//       "WsEnvelope": { ... },
//       "__shared": { "$defs": { "schema0": { "type": "string", "const": "log" }, ... } }
//     }
//   }
//
// The `__shared#/$defs/schemaN` refs are NOT standard JSON Schema — go-jsonschema
// cannot resolve them. This extractor rewrites refs to local `#/$defs/schemaN`
// paths and hoists the __shared definitions to the top-level `$defs`. Each named
// schema (JobLogMessage, JobStepMessage, …) becomes an entry under `$defs` as well,
// giving go-jsonschema one consistent ref-resolvable document.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INPUT_PATH = resolve('contracts/ws-messages.json');
const OUTPUT_PATH = process.env.WS_SCHEMA_OUT || '/tmp/df-ws-schemas.json';

const raw = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));

// Accept either `schemas`, `$defs`, `definitions`, or a top-level dict as the
// root container of named schemas.
let container;
if (raw.schemas && typeof raw.schemas === 'object') {
  container = raw.schemas;
} else if (raw.$defs && typeof raw.$defs === 'object') {
  container = raw.$defs;
} else if (raw.definitions && typeof raw.definitions === 'object') {
  container = raw.definitions;
} else {
  container = raw;
}

// Split the container: real named schemas vs the `__shared` ref-target bucket.
const named = {};
let sharedDefs = {};
for (const [id, schema] of Object.entries(container)) {
  if (id === '__shared' && schema && typeof schema === 'object' && schema.$defs) {
    sharedDefs = schema.$defs;
  } else {
    named[id] = schema;
  }
}

// Rewrite `$ref` values that point at `__shared#/$defs/...` to local
// `#/definitions/...`. Walk every object recursively. We unify everything
// under one `definitions` table (the JSON Schema draft-07 keyword that
// go-jsonschema has supported longest; draft-2020-12 `$defs` also works
// but `definitions` keeps the extracted file compatible with older tool
// versions too).
function rewriteRefs(node) {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item);
    return;
  }
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string' && node.$ref.startsWith('__shared#/$defs/')) {
      node.$ref = node.$ref.replace('__shared#/$defs/', '#/definitions/');
    }
    for (const key of Object.keys(node)) {
      rewriteRefs(node[key]);
    }
  }
}
for (const schema of Object.values(named)) rewriteRefs(schema);
for (const schema of Object.values(sharedDefs)) rewriteRefs(schema);

// Drop per-schema `$schema` keys on named entries — they are only valid at the
// root of a JSON Schema document. go-jsonschema complains about nested ones.
for (const schema of Object.values(named)) {
  if (schema && typeof schema === 'object' && '$schema' in schema) {
    delete schema.$schema;
  }
}

// Strip `format: date-time` from shared defs. go-jsonschema v0.23 maps
// `"format": "date-time"` to a named type aliased to `time.Time`, e.g.
//   type Schema5 time.Time
// Aliasing a struct type without re-declaring its JSON methods DROPS the
// underlying time.Time.UnmarshalJSON — the default decoder then errors on
// any RFC-3339 string ("cannot unmarshal string into Go struct field"). The
// existing `pattern` keyword (full RFC-3339 regex) already enforces the
// wire shape at the JSON Schema level, so stripping `format` keeps
// validation intact while letting the Go side stay as `string`.
for (const schema of Object.values(sharedDefs)) {
  if (schema && typeof schema === 'object' && schema.format === 'date-time') {
    delete schema.format;
  }
}

// Flat JSON Schema document: all named schemas + their shared refs share one
// `definitions` table. go-jsonschema resolves `#/definitions/<id>` natively.
const out = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  definitions: {
    ...sharedDefs,
    ...named,
  },
};

writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n');
console.log(
  `wrote ${OUTPUT_PATH} with ${Object.keys(named).length} named schemas (+${Object.keys(sharedDefs).length} shared definitions)`
);
