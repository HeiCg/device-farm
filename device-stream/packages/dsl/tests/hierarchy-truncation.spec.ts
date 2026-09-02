import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { AndroidDriver } from '../src/drivers/android';
import { buildElementNotFoundDiagnostics } from '../src/selectors/describe';
import { ElementNotFoundError } from '../src/types';
import type { HierarchyTree, UIElement } from '../src/types';

function node(index: number, over: Record<string, unknown> = {}) {
  return {
    index,
    className: 'android.widget.TextView',
    resourceId: `n${index}`,
    text: `n${index}`,
    bounds: { x1: 0, y1: index * 10, x2: 100, y2: index * 10 + 10 },
    enabled: true,
    ...over,
  };
}

/** Fake newline-delimited JSON-RPC server that records the params it received. */
function startFakeServer(
  respond: (req: { method: string; params: any; id: number }) => object,
): Promise<{ port: number; close: () => Promise<void>; lastParams: () => any }> {
  let last: any;
  const server = net.createServer((socket) => {
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const req = JSON.parse(line);
        last = req.params;
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, ...respond(req) }) + '\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        lastParams: () => last,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const drivers: AndroidDriver[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const d of drivers.splice(0)) await d.close();
  for (const s of servers.splice(0)) await s.close();
});

describe('AndroidDriver.hierarchy truncation (B5)', () => {
  it('defaults maxElements to 500', async () => {
    const srv = await startFakeServer(() => ({ result: { tree: [node(1)], truncated: false } }));
    servers.push(srv);
    const d = new AndroidDriver('emu', `127.0.0.1:${srv.port}`);
    drivers.push(d);

    await d.hierarchy();
    expect(srv.lastParams()).toEqual({ maxElements: 500 });
  });

  it('honors a configured maxElements and flags the tree when the server reports truncated', async () => {
    const srv = await startFakeServer(() => ({
      result: { tree: [node(1), node(2), node(3)], truncated: true },
    }));
    servers.push(srv);
    const d = new AndroidDriver('emu', `127.0.0.1:${srv.port}`, { maxElements: 3 });
    drivers.push(d);

    const tree = (await d.hierarchy()) as HierarchyTree;
    expect(srv.lastParams()).toEqual({ maxElements: 3 });
    expect(tree.truncated).toBe(true);
    expect(tree.maxElements).toBe(3);
  });

  it('falls back to "node count hit the cap" when the server omits truncated', async () => {
    const srv = await startFakeServer(() => ({ result: { tree: [node(1), node(2)] } }));
    servers.push(srv);
    const d = new AndroidDriver('emu', `127.0.0.1:${srv.port}`, { maxElements: 2 });
    drivers.push(d);

    const tree = (await d.hierarchy()) as HierarchyTree;
    expect(tree.truncated).toBe(true);
    expect(tree.maxElements).toBe(2);
  });

  it('does not flag a tree that fits under the cap', async () => {
    const srv = await startFakeServer(() => ({ result: { tree: [node(1)], truncated: false } }));
    servers.push(srv);
    const d = new AndroidDriver('emu', `127.0.0.1:${srv.port}`, { maxElements: 10 });
    drivers.push(d);

    const tree = (await d.hierarchy()) as HierarchyTree;
    expect(tree.truncated).toBeUndefined();
  });
});

describe('ElementNotFoundError truncation hint (B5)', () => {
  it('adds a "raise maxElements" hint when the polled tree was truncated', () => {
    const tree = [] as HierarchyTree;
    (tree as UIElement[]).push({
      bounds: { x: 0, y: 0, width: 5, height: 5 },
      enabled: true,
      selected: false,
      id: 'other',
    });
    tree.truncated = true;
    tree.maxElements = 200;

    const diag = buildElementNotFoundDiagnostics(tree, { id: 'missing' });
    expect(diag.truncated).toBe(true);
    expect(diag.maxElements).toBe(200);

    const err = new ElementNotFoundError({ id: 'missing' }, 1000, diag);
    expect(err.message).toMatch(/truncated at 200 elements/);
    expect(err.message).toMatch(/androidMaxElements/);
  });

  it('omits the hint for a complete tree', () => {
    const tree = [] as HierarchyTree;
    const diag = buildElementNotFoundDiagnostics(tree, { id: 'missing' });
    expect(diag.truncated).toBeUndefined();
    const err = new ElementNotFoundError({ id: 'missing' }, 1000, diag);
    expect(err.message).not.toMatch(/truncated/);
  });
});
