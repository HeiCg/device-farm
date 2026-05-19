import type { UIElement } from '../types';

/**
 * Minimal WDA source-XML parser.
 *
 * WDA returns an XML tree where every element is `<XCUIElementType{Kind} ... />`
 * with attributes: name (accessibility id), label, value, type, x, y, width, height,
 * enabled ("true"/"false"), visible, accessible. We only need attributes from each
 * opening tag, so a tag-scan is enough.
 *
 * Swap for `fast-xml-parser` later if we need real entity handling. For now,
 * zero deps.
 */
export function parseWdaSource(xml: string): UIElement[] {
  const elements: UIElement[] = [];
  const tagRe = /<(XCUIElementType[A-Za-z]+)\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const className = m[1];
    const attrs = parseAttrs(m[2]);
    const x = num(attrs.x);
    const y = num(attrs.y);
    const w = num(attrs.width);
    const h = num(attrs.height);
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    elements.push({
      id: attrs.name || undefined,
      text: attrs.value || attrs.label || undefined,
      contentDescription: attrs.label || undefined,
      className,
      bounds: { x, y, width: w, height: h },
      enabled: attrs.enabled !== 'false',
      selected: attrs.selected === 'true',
      focused: attrs.hasFocus === 'true',
    });
  }
  return elements;
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
