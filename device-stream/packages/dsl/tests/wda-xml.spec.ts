import { describe, it, expect } from 'vitest';
import { parseWdaSource } from '../src/selectors/wda-xml';
import { flattenTree, findElement } from '../src/selectors/matcher';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication name="MyApp" x="0" y="0" width="390" height="844" enabled="true" visible="true">
  <XCUIElementTypeWindow x="0" y="0" width="390" height="844" enabled="true" visible="true">
    <XCUIElementTypeButton name="login" label="Log In" x="20" y="700" width="350" height="50" enabled="true" visible="true"/>
    <XCUIElementTypeOther x="0" y="0" width="390" height="100" enabled="true" visible="false">
      <XCUIElementTypeStaticText value="Hidden" x="10" y="10" width="100" height="20" enabled="true" visible="false"/>
    </XCUIElementTypeOther>
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`;

describe('parseWdaSource (nested)', () => {
  it('returns a nested tree rooted at the application element', () => {
    const roots = parseWdaSource(SAMPLE);
    expect(roots).toHaveLength(1);
    const app = roots[0];
    expect(app.className).toBe('XCUIElementTypeApplication');
    expect(app.children?.[0].className).toBe('XCUIElementTypeWindow');
    // window has 2 children: button + other
    expect(app.children?.[0].children).toHaveLength(2);
  });

  it('captures id/label/value/visibility and bounds', () => {
    const btn = findElement(parseWdaSource(SAMPLE), { id: 'login' });
    expect(btn).toBeDefined();
    expect(btn!.text).toBe('Log In');
    expect(btn!.visible).toBe(true);
    expect(btn!.bounds).toEqual({ x: 20, y: 700, width: 350, height: 50 });
  });

  it('preserves nesting so containsDescendant works', () => {
    const other = findElement(parseWdaSource(SAMPLE), {
      className: 'XCUIElementTypeOther',
      containsDescendant: { text: 'Hidden' },
    });
    expect(other).toBeDefined();
  });

  it('marks known-invisible elements so visible:true filters them out', () => {
    const all = flattenTree(parseWdaSource(SAMPLE));
    expect(all.find((e) => e.text === 'Hidden')!.visible).toBe(false);
    expect(findElement(parseWdaSource(SAMPLE), { text: 'Hidden', visible: true })).toBeUndefined();
  });
});
