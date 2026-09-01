import type { UIElement } from '../types';

/**
 * WDA source-XML parser that preserves hierarchy.
 *
 * WDA returns a tree where every element is `<XCUIElementType{Kind} ... >` with
 * attributes: name (accessibility id), label, value, type, x, y, width, height,
 * enabled ("true"/"false"), visible, accessible. We build a nested
 * {@link UIElement} forest so relative selectors (`containsDescendant`) and
 * `visible` filtering work. Self-closing tags (`/>`) are leaves; open tags push
 * onto a stack and their matching `</...>` pops.
 *
 * Zero-dep on purpose (the tree is regular, no entities beyond the basic five).
 */
export function parseWdaSource(xml: string): UIElement[] {
  const roots: UIElement[] = [];
  const stack: UIElement[] = [];
  // Match an opening/self-closing element tag OR a closing tag.
  const tagRe = /<(\/?)(XCUIElementType[A-Za-z]+)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;

  const attach = (node: UIElement): void => {
    const parent = stack[stack.length - 1];
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  };

  while ((m = tagRe.exec(xml)) !== null) {
    const isClose = m[1] === '/';
    const className = m[2];
    const selfClosing = m[4] === '/';

    if (isClose) {
      stack.pop();
      continue;
    }

    const node = toElement(className, parseAttrs(m[3]));
    if (!node) {
      // Element without geometry: still maintain stack depth for open tags.
      if (!selfClosing) stack.push(placeholder());
      continue;
    }
    attach(node);
    if (!selfClosing) stack.push(node);
  }

  return roots;
}

function toElement(className: string, attrs: Record<string, string>): UIElement | undefined {
  const x = num(attrs.x);
  const y = num(attrs.y);
  const w = num(attrs.width);
  const h = num(attrs.height);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return {
    id: attrs.name || undefined,
    text: attrs.value || attrs.label || undefined,
    contentDescription: attrs.label || undefined,
    className,
    bounds: { x, y, width: w, height: h },
    enabled: attrs.enabled !== 'false',
    selected: attrs.selected === 'true',
    focused: attrs.hasFocus === 'true',
    visible: attrs.visible === undefined ? undefined : attrs.visible === 'true',
  };
}

/** A geometry-less open element we still need to track for stack balance. */
function placeholder(): UIElement {
  return { bounds: { x: 0, y: 0, width: 0, height: 0 }, enabled: true, selected: false };
}

const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(raw)) !== null) {
    out[m[1]] = decodeXml(m[2]);
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
