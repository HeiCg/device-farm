import { describe, it, expect } from 'vitest';
import { describeElements, renderDescription } from '../src/selectors/describe';
import type { UIElement } from '../src/types';

function uiel(partial: Partial<UIElement>): UIElement {
  return { bounds: { x: 0, y: 0, width: 10, height: 10 }, enabled: true, selected: false, ...partial };
}

const TREE: UIElement[] = [
  uiel({
    className: 'XCUIElementTypeWindow',
    visible: true,
    children: [
      uiel({ id: 'login', text: 'Log In', className: 'Button', bounds: { x: 20, y: 700, width: 350, height: 50 }, visible: true }),
      uiel({ text: 'Hidden', className: 'StaticText', visible: false }),
      uiel({ className: 'Spacer', visible: true }), // no text/id/desc -> structural
    ],
  }),
];

describe('describeElements', () => {
  it('keeps only visible, interesting nodes and normalizes their fields', () => {
    const nodes = describeElements(TREE);
    // window kept (has visible children), login kept; Hidden dropped (invisible);
    // anonymous Spacer dropped (no identifying text/id/desc and no kept children)
    const flatTexts = JSON.stringify(nodes);
    expect(flatTexts).toContain('Log In');
    expect(flatTexts).not.toContain('Hidden');
    expect(flatTexts).not.toContain('Spacer');
  });

  it('captures center coordinates for tappable elements', () => {
    const nodes = describeElements(TREE);
    const login = findByText(nodes, 'Log In');
    expect(login).toBeDefined();
    expect(login!.center).toEqual({ x: 195, y: 725 });
    expect(login!.id).toBe('login');
  });
});

describe('renderDescription', () => {
  it('renders a compact indented outline an agent can read', () => {
    const text = renderDescription(describeElements(TREE));
    expect(text).toContain('Button');
    expect(text).toContain('"Log In"');
    expect(text).toContain('#login');
    // nesting is shown via indentation
    expect(text.split('\n').some((l) => l.startsWith('  '))).toBe(true);
  });
});

function findByText(nodes: any[], text: string): any {
  for (const n of nodes) {
    if (n.text === text) return n;
    const inner = findByText(n.children ?? [], text);
    if (inner) return inner;
  }
  return undefined;
}
