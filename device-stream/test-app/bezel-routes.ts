/**
 * Bezel HTTP routes — serves DeviceKit chrome.json and rasterized bezel PNG.
 * macOS only (uses sips); returns 501 elsewhere.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export async function handleChromeJson(
  req: IncomingMessage,
  res: ServerResponse,
  chromeId: string,
): Promise<void> {
  if (process.platform !== 'darwin') {
    res.writeHead(501, { 'Content-Type': 'text/plain' });
    res.end('bezels are macOS-only');
    return;
  }
  try {
    const { loadChromeJson } = await import('@device-stream/ios-simulator');
    const json = await loadChromeJson(chromeId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`chrome not found: ${(e as Error).message}`);
  }
}

export async function handleBezelPng(
  req: IncomingMessage,
  res: ServerResponse,
  chromeId: string,
): Promise<void> {
  if (process.platform !== 'darwin') {
    res.writeHead(501, { 'Content-Type': 'text/plain' });
    res.end('bezels are macOS-only');
    return;
  }
  try {
    const { rasterizeComposite } = await import('@device-stream/ios-simulator');
    const png = await rasterizeComposite(chromeId);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(png);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`bezel not found: ${(e as Error).message}`);
  }
}
