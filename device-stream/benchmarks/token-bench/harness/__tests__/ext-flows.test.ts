import { describe, it, expect } from 'vitest';
import {
  parseTree,
  parseElements,
  elementById,
  hasId,
  F1_ANDROID_SCRIPT,
  F2_IOS_SCRIPT,
} from '../ext-flows.js';

describe('ext-flows — describe parsing', () => {
  // A direct `describe` call returns a JSON object whose `description` field holds
  // the tree, with escaped quotes and \n. This is the format both platforms return.
  const jsonDescribe = JSON.stringify({
    description:
      'Source: ax-service\nMode: flat\n\nROOT  AXGroup (0.000, 0.000, 1.000, 1.000)\n\n' +
      '  AXButton "Geral" id="com.apple.settings.general"  (0.040, 0.456, 0.920, 0.059)\n' +
      '  AXButton "Ajustes" id="BackButton"  (0.040, 0.071, 0.109, 0.050)\n',
    source: 'ax-service',
  });

  it('parseTree unwraps the JSON description field into a plain tree', () => {
    const tree = parseTree(jsonDescribe);
    expect(tree).toContain('ROOT  AXGroup');
    expect(tree).toContain('id="com.apple.settings.general"');
    expect(tree).not.toContain('"description"');
  });

  it('parseTree passes a plain (auto-capture) tree through unchanged', () => {
    const plain = '--- Elements after action (describe) ---\nROOT  AXGroup (0,0,1,1)\n';
    expect(parseTree(plain)).toBe(plain);
  });

  it('parseElements extracts label, id and normalized frame', () => {
    const els = parseElements(parseTree(jsonDescribe));
    const general = els.find((e) => e.id === 'com.apple.settings.general');
    expect(general).toBeDefined();
    expect(general!.label).toBe('Geral');
    expect(general!.x).toBeCloseTo(0.04);
    expect(general!.w).toBeCloseTo(0.92);
  });

  it('elementById / hasId locate elements by accessibility id', () => {
    const tree = parseTree(jsonDescribe);
    expect(hasId(tree, 'BackButton')).toBe(true);
    expect(hasId(tree, 'com.apple.settings.camera')).toBe(false);
    expect(elementById(tree, 'BackButton')!.label).toBe('Ajustes');
  });

  it('handles a value= attribute between the label and the id', () => {
    const tree =
      'ROOT  AXGroup (0,0,1,1)\n  AXGroup "carga" value="100%" id="battery"  (0.8, 0.03, 0.06, 0.01)\n';
    const el = elementById(tree, 'battery');
    expect(el).toBeDefined();
    expect(el!.label).toBe('carga');
  });

  it('the run-script bodies drive all navigation steps of each scenario', () => {
    // F1 (Android): search + navigate; F2 (iOS): identifier navigation.
    expect(F1_ANDROID_SCRIPT).toContain("ui.tap({ text: 'Network & internet' })");
    expect(F1_ANDROID_SCRIPT).toContain('android-flow-complete');
    expect(F2_IOS_SCRIPT).toContain("identifier: 'com.apple.settings.general'");
    expect(F2_IOS_SCRIPT).toContain('ios-flow-complete');
  });
});
