import { describe, it, expect } from 'vitest';
import {
  matchString,
  elementMatches,
  findElement,
  flattenTree,
  centerOf,
} from '../src/selectors/matcher';
import type { UIElement } from '../src/types';

function el(partial: Partial<UIElement>): UIElement {
  return {
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    enabled: true,
    selected: false,
    ...partial,
  };
}

describe('matchString', () => {
  it('treats a bare string as exact, case-sensitive equality', () => {
    expect(matchString('Login', 'Login')).toBe(true);
    expect(matchString('login', 'Login')).toBe(false);
    expect(matchString(undefined, 'Login')).toBe(false);
  });

  it('supports { equals }', () => {
    expect(matchString('Login', { equals: 'Login' })).toBe(true);
    expect(matchString('Logout', { equals: 'Login' })).toBe(false);
  });

  it('supports { contains }', () => {
    expect(matchString('Please Login now', { contains: 'Login' })).toBe(true);
    expect(matchString('Register', { contains: 'Login' })).toBe(false);
  });

  it('supports { regex }', () => {
    expect(matchString('item-42', { regex: '^item-\\d+$' })).toBe(true);
    expect(matchString('item-x', { regex: '^item-\\d+$' })).toBe(false);
  });

  it('supports caseInsensitive for equals/contains/regex', () => {
    expect(matchString('LOGIN', { equals: 'login', caseInsensitive: true })).toBe(true);
    expect(matchString('Please LOGIN', { contains: 'login', caseInsensitive: true })).toBe(true);
    expect(matchString('ITEM-9', { regex: 'item-\\d', caseInsensitive: true })).toBe(true);
  });

  it('requires all provided constraints to hold', () => {
    expect(matchString('item-42', { contains: 'item', regex: '\\d+$' })).toBe(true);
    expect(matchString('item-xx', { contains: 'item', regex: '\\d+$' })).toBe(false);
  });
});

describe('elementMatches', () => {
  it('matches by StringMatch on text fields', () => {
    const e = el({ text: 'Sign In', id: 'btn_login', className: 'android.widget.Button' });
    expect(elementMatches(e, { text: { contains: 'Sign' } })).toBe(true);
    expect(elementMatches(e, { id: { regex: 'login$' } })).toBe(true);
    expect(elementMatches(e, { text: 'Sign Out' })).toBe(false);
  });

  it('filters by enabled', () => {
    expect(elementMatches(el({ text: 'X', enabled: false }), { text: 'X', enabled: true })).toBe(false);
    expect(elementMatches(el({ text: 'X', enabled: false }), { text: 'X', enabled: false })).toBe(true);
  });

  it('filters by visible (false only excludes known-invisible)', () => {
    expect(elementMatches(el({ text: 'X', visible: false }), { text: 'X', visible: true })).toBe(false);
    expect(elementMatches(el({ text: 'X', visible: true }), { text: 'X', visible: true })).toBe(true);
    // unknown visibility (Android flat nodes) is permitted
    expect(elementMatches(el({ text: 'X' }), { text: 'X', visible: true })).toBe(true);
  });

  it('supports containsDescendant relative matching', () => {
    const parent = el({
      className: 'Row',
      children: [el({ text: 'Delete', id: 'del' })],
    });
    expect(elementMatches(parent, { className: 'Row', containsDescendant: { text: 'Delete' } })).toBe(true);
    expect(elementMatches(parent, { className: 'Row', containsDescendant: { text: 'Edit' } })).toBe(false);
  });
});

describe('flattenTree', () => {
  it('flattens nested roots in pre-order', () => {
    const tree: UIElement[] = [
      el({ id: 'a', children: [el({ id: 'b' }), el({ id: 'c', children: [el({ id: 'd' })] })] }),
      el({ id: 'e' }),
    ];
    expect(flattenTree(tree).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('findElement', () => {
  it('finds across nested tree and respects index over flattened matches', () => {
    const tree: UIElement[] = [
      el({ text: 'Row', children: [el({ text: 'Cell', id: 'c0' })] }),
      el({ text: 'Cell', id: 'c1' }),
    ];
    expect(findElement(tree, { text: 'Cell' })?.id).toBe('c0');
    expect(findElement(tree, { text: 'Cell', index: 1 })?.id).toBe('c1');
    expect(findElement(tree, { text: 'Nope' })).toBeUndefined();
  });
});

describe('centerOf', () => {
  it('returns the rounded center point of the bounds', () => {
    expect(centerOf(el({ bounds: { x: 10, y: 20, width: 30, height: 40 } }))).toEqual({ x: 25, y: 40 });
  });
});
