/**
 * Phase 35 Plan 35-02 — prompts/exploration.md + prompts-loader spec.
 *
 * Verifies:
 *   - File exists on disk at `prompts/exploration.md`.
 *   - loadExplorationPrompt() returns substantive content (> 5000 chars).
 *   - Substitutions applied (device_tap_by_description, explore_save_screen
 *     present; reference-repo strings revyl / app-explorer screen absent).
 *   - Algorithm + Rules sections present.
 *   - Second call returns cached identical reference.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadExplorationPrompt, _resetPromptCache } from '../internal/prompts-loader.js';

describe('explorations/prompts', () => {
  beforeEach(() => {
    _resetPromptCache();
  });

  it('prompts/exploration.md exists on disk', () => {
    expect(existsSync(resolve(process.cwd(), 'prompts/exploration.md'))).toBe(true);
  });

  it('loadExplorationPrompt returns content > 5000 chars', async () => {
    const content = await loadExplorationPrompt();
    expect(content.length).toBeGreaterThan(5000);
  });

  it('contains the agent persona heading', async () => {
    const content = await loadExplorationPrompt();
    expect(content).toContain('# App Explorer Agent');
  });

  it('contains the device_tap_by_description substitution (proves substitution applied)', async () => {
    const content = await loadExplorationPrompt();
    expect(content).toContain('device_tap_by_description');
  });

  it('does NOT contain `revyl device` (proves no reference-repo leak)', async () => {
    const content = await loadExplorationPrompt();
    expect(content).not.toContain('revyl device');
  });

  it('does NOT contain `app-explorer screen` (proves no reference-repo leak)', async () => {
    const content = await loadExplorationPrompt();
    expect(content).not.toContain('app-explorer screen');
  });

  it('contains explore_save_screen tool reference', async () => {
    const content = await loadExplorationPrompt();
    expect(content).toContain('explore_save_screen');
  });

  it('contains explore_finish tool reference', async () => {
    const content = await loadExplorationPrompt();
    expect(content).toContain('explore_finish');
  });

  it('contains "## Exploration Algorithm" section header', async () => {
    const content = await loadExplorationPrompt();
    expect(content).toMatch(/##\s+Exploration Algorithm/);
  });

  it('contains "## Rules" section header', async () => {
    const content = await loadExplorationPrompt();
    expect(content).toMatch(/##\s+Rules/);
  });

  it('contains "## Stop Conditions" section header (Phase 35 addition)', async () => {
    const content = await loadExplorationPrompt();
    expect(content).toMatch(/##\s+Stop Conditions/);
  });

  it('second call returns cached identical reference', async () => {
    const first = await loadExplorationPrompt();
    const second = await loadExplorationPrompt();
    expect(second).toBe(first); // referential equality — proves cache
  });
});
