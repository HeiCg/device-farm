/**
 * describe-ui — interim WDA-backed accessibility tree fetch. Phase D will
 * swap the implementation for direct AXPTranslator dispatch (the baguette
 * recipe) without changing the public surface.
 */
import { XMLParser } from 'fast-xml-parser';
import type { AXNode } from '@device-stream/core';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Always materialize repeated child elements as an array so the recursion
  // below can iterate uniformly. fast-xml-parser otherwise emits a single
  // object for a single child and an array for two+.
  isArray: () => false,
  preserveOrder: false,
});

export function parseWdaSource(xml: string): AXNode {
  const root = parser.parse(xml);
  const rootKey = Object.keys(root).find((k) => k !== '?xml');
  if (!rootKey) {
    throw new Error('WDA source: no root element');
  }
  return convert(root[rootKey], rootKey);
}

function convert(node: any, role: string): AXNode {
  if (typeof node !== 'object' || node === null) {
    return emptyNode(role);
  }
  const out: AXNode = {
    role,
    subrole:    null,
    label:      node['@label']      ?? null,
    value:      node['@value']      ?? null,
    identifier: node['@name']       ?? null,
    title:      node['@title']      ?? null,
    help:       node['@hint']       ?? null,
    frame: ('@x' in node && '@y' in node && '@width' in node && '@height' in node)
      ? { x: +node['@x'], y: +node['@y'], width: +node['@width'], height: +node['@height'] }
      : null,
    enabled: node['@enabled'] === 'true' || node['@enabled'] === true,
    focused: node['@focused'] === 'true' || node['@focused'] === true,
    hidden:  node['@visible'] === 'false' || node['@visible'] === false,
    children: [],
  };
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@')) continue;
    if (Array.isArray(v)) {
      for (const item of v) out.children.push(convert(item, k));
    } else if (typeof v === 'object' && v !== null) {
      out.children.push(convert(v, k));
    }
  }
  return out;
}

function emptyNode(role: string): AXNode {
  return {
    role, subrole: null, label: null, value: null, identifier: null,
    title: null, help: null, frame: null,
    enabled: false, focused: false, hidden: false, children: [],
  };
}

export async function fetchDescribeUi(udid: string, wdaPort = 8100): Promise<AXNode> {
  const session = await fetch(`http://localhost:${wdaPort}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilities: { firstMatch: [{ platformName: 'iOS' }] } }),
  });
  if (!session.ok) throw new Error(`WDA session failed: ${session.status}`);
  const sessionBody = await session.json() as { value: { sessionId: string } };
  const xmlRes = await fetch(`http://localhost:${wdaPort}/session/${sessionBody.value.sessionId}/source`);
  if (!xmlRes.ok) throw new Error(`WDA source failed: ${xmlRes.status}`);
  const xml = await xmlRes.text();
  return parseWdaSource(xml);
}
