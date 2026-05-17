#!/usr/bin/env -S npx tsx
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse, stringify } from 'yaml';

const RESERVE_GB = 4;
const EMULATOR_GB = 4;
const MAX_DEVICES = 4;

export function suggestDeviceCount(totalGb: number): number {
  const usable = totalGb - RESERVE_GB;
  const raw = Math.floor(usable / EMULATOR_GB);
  return Math.max(1, Math.min(MAX_DEVICES, raw));
}

export interface DiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

export function mergeConfigSuggestions(
  current: any,
  suggested: any,
  prefix = '',
): DiffEntry[] {
  const diff: DiffEntry[] = [];
  for (const k of Object.keys(suggested)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const sv = suggested[k];
    const cv = current?.[k];
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv)) {
      diff.push(...mergeConfigSuggestions(cv ?? {}, sv, path));
    } else if (cv !== sv) {
      diff.push({ path, from: cv, to: sv });
    }
  }
  return diff;
}

function probeMemoryGb(): number {
  try {
    const bytes = Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim());
    return Math.round(bytes / 1024 / 1024 / 1024);
  } catch {
    return 8;
  }
}

function probeDep(name: string, args: string[]): boolean {
  try {
    execFileSync(name, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const totalGb = probeMemoryGb();
  const suggested = suggestDeviceCount(totalGb);

  console.log(`✓ macOS detected, ${totalGb} GB RAM`);

  const deps: Array<[string, string[]]> = [
    ['java', ['-version']],
    ['adb', ['version']],
    ['emulator', ['-version']],
    ['avdmanager', ['list', 'avd']],
    ['maestro', ['--version']],
  ];
  for (const [name, args] of deps) {
    if (probeDep(name, args)) console.log(`✓ ${name} OK`);
    else console.log(`✗ ${name} MISSING — install before running device-farm`);
  }

  console.log(`✓ Suggesting max_devices = ${suggested} (${totalGb} GB - ${RESERVE_GB} GB reserved / ${EMULATOR_GB} GB per emulator)`);
  console.log(`✓ Suggesting max_concurrent_runs = ${suggested}`);

  const suggestedConfig = {
    pool: { max_devices: suggested },
    pipelines: { max_concurrent_runs: suggested },
  };

  let current: any = {};
  if (existsSync('config.yaml')) {
    current = parse(readFileSync('config.yaml', 'utf8')) ?? {};
  }

  const diff = mergeConfigSuggestions(current, suggestedConfig);
  if (diff.length === 0) {
    console.log('→ config.yaml already matches suggested values; nothing to do.');
    return;
  }

  console.log('→ Diff vs current config:');
  for (const d of diff) {
    console.log(`    ${d.path}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
  }

  writeFileSync('config.yaml.suggested', stringify({ ...current, ...suggestedConfig }));
  console.log('→ Wrote config.yaml.suggested. Review and `mv` over config.yaml to apply.');
  console.log('→ Next steps:');
  console.log('    1. export AZURE_DEVOPS_PAT=<your-pat>');
  console.log('    2. export WEBHOOK_PASSWORD=<random-secret>');
  console.log('    3. Register Azure Service Hook → http://<your-host>:<port>/api/azure/pr-events');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
