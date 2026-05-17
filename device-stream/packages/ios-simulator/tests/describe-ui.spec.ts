import { describe, it, expect } from 'vitest';
import { parseWdaSource } from '../src/describe-ui.js';

const SOURCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication name="Test" label="Test" x="0" y="0" width="438" height="954">
  <XCUIElementTypeButton name="Login" label="Log in" enabled="true" x="100" y="200" width="200" height="44"/>
</XCUIElementTypeApplication>`;

describe('parseWdaSource', () => {
  it('produces an AXNode tree from WDA XML', () => {
    const tree = parseWdaSource(SOURCE_XML);
    expect(tree.role).toBe('XCUIElementTypeApplication');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].role).toBe('XCUIElementTypeButton');
    expect(tree.children[0].label).toBe('Log in');
    expect(tree.children[0].frame).toEqual({ x: 100, y: 200, width: 200, height: 44 });
  });

  it('handles missing optional attrs as null', () => {
    const minimal = '<?xml version="1.0"?><XCUIElementTypeApplication/>';
    const tree = parseWdaSource(minimal);
    expect(tree.role).toBe('XCUIElementTypeApplication');
    expect(tree.label).toBeNull();
    expect(tree.frame).toBeNull();
    expect(tree.children).toEqual([]);
  });

  it('handles array-of-siblings (multiple children of same type)', () => {
    const xml = `<?xml version="1.0"?>
<XCUIElementTypeApplication>
  <XCUIElementTypeButton name="A" label="One"/>
  <XCUIElementTypeButton name="B" label="Two"/>
</XCUIElementTypeApplication>`;
    const tree = parseWdaSource(xml);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.map((c) => c.label)).toEqual(['One', 'Two']);
  });
});
