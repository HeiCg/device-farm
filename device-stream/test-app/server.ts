/**
 * device-stream test app v2
 *
 * Uses on-device HTTP servers for fast control:
 *   - Android: device-server on port 9008 (NanoHTTPD + UiAutomator)
 *   - iOS:     WebDriverAgent on port 8100 (XCUITest)
 *
 * Fallback to ADB/simctl if device servers aren't running.
 *
 * Usage:
 *   cd device-stream && npx tsx test-app/server.ts
 *   Open http://localhost:3456
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3456;
const ANDROID_SERVER = 'http://localhost:9008';
const WDA_SERVER = 'http://localhost:8100';

const DEVICE_ID_RE = /^[\w.:-]+$/;

// ─── Fast HTTP helpers ───

async function httpGet(url: string, timeout = 5000): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeout) });
}

async function httpPost(url: string, body: any, timeout = 5000): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
}

// ─── Android: device-server (port 9008) ───

async function androidServerAvailable(): Promise<boolean> {
  try {
    const r = await httpGet(`${ANDROID_SERVER}/ping`, 1000);
    return r.ok;
  } catch { return false; }
}

async function androidScreenshot(): Promise<Buffer | null> {
  try {
    const r = await httpGet(`${ANDROID_SERVER}/screenshot?quality=60&scale=2`, 3000);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

async function androidInfo(): Promise<any> {
  try {
    const r = await httpGet(`${ANDROID_SERVER}/info`, 2000);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function androidTap(x: number, y: number): Promise<any> {
  const r = await httpPost(`${ANDROID_SERVER}/tap`, { x: Math.round(x), y: Math.round(y) });
  return r.json();
}

async function androidSwipe(x1: number, y1: number, x2: number, y2: number, steps: number): Promise<any> {
  const r = await httpPost(`${ANDROID_SERVER}/swipe`, {
    startX: Math.round(x1), startY: Math.round(y1),
    endX: Math.round(x2), endY: Math.round(y2),
    steps: Math.max(5, Math.round(steps)),
  });
  return r.json();
}

async function androidType(text: string): Promise<any> {
  const r = await httpPost(`${ANDROID_SERVER}/type`, { text });
  return r.json();
}

async function androidKey(key: string): Promise<any> {
  const r = await httpPost(`${ANDROID_SERVER}/key`, { key });
  return r.json();
}

// ─── iOS: WebDriverAgent (port 8100) ───

let wdaSessionId: string | null = null;

async function wdaAvailable(): Promise<boolean> {
  try {
    const r = await httpGet(`${WDA_SERVER}/status`, 1000);
    return r.ok;
  } catch { return false; }
}

async function wdaEnsureSession(): Promise<string> {
  if (wdaSessionId) {
    // Validate session still exists
    try {
      const r = await httpGet(`${WDA_SERVER}/session/${wdaSessionId}/window/size`, 2000);
      if (r.ok) return wdaSessionId;
    } catch { /* session expired */ }
  }
  const r = await httpPost(`${WDA_SERVER}/session`, { capabilities: { alwaysMatch: {} } });
  const data = await r.json() as any;
  wdaSessionId = data.value.sessionId;
  console.log(`[WDA] New session: ${wdaSessionId}`);
  return wdaSessionId!;
}

async function wdaScreenshot(): Promise<Buffer | null> {
  try {
    const r = await httpGet(`${WDA_SERVER}/screenshot`, 3000);
    if (!r.ok) return null;
    const data = await r.json() as any;
    return Buffer.from(data.value, 'base64');
  } catch { return null; }
}

async function wdaWindowSize(): Promise<{ width: number; height: number } | null> {
  try {
    const sid = await wdaEnsureSession();
    const r = await httpGet(`${WDA_SERVER}/session/${sid}/window/size`, 2000);
    const data = await r.json() as any;
    return data.value;
  } catch { return null; }
}

async function wdaTap(x: number, y: number): Promise<any> {
  const sid = await wdaEnsureSession();
  const r = await httpPost(`${WDA_SERVER}/session/${sid}/actions`, {
    actions: [{
      type: 'pointer', id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 50 },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
  return r.json();
}

async function wdaSwipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<any> {
  const sid = await wdaEnsureSession();
  const r = await httpPost(`${WDA_SERVER}/session/${sid}/actions`, {
    actions: [{
      type: 'pointer', id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(x1), y: Math.round(y1) },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: Math.max(durationMs, 100), x: Math.round(x2), y: Math.round(y2) },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
  return r.json();
}

async function wdaType(text: string): Promise<any> {
  const sid = await wdaEnsureSession();
  // Find focused element and send keys
  const r = await httpPost(`${WDA_SERVER}/session/${sid}/element/active`, {});
  const elemData = await r.json() as any;
  const elemId = elemData.value?.ELEMENT || Object.values(elemData.value || {})[0];
  if (elemId) {
    const r2 = await httpPost(`${WDA_SERVER}/session/${sid}/element/${elemId}/value`, { text });
    return r2.json();
  }
  // Fallback: use keys endpoint
  const r3 = await httpPost(`${WDA_SERVER}/session/${sid}/keys`, { value: text.split('') });
  return r3.json();
}

async function wdaKey(key: string): Promise<any> {
  const sid = await wdaEnsureSession();
  if (key === 'home') {
    return (await httpPost(`${WDA_SERVER}/wda/homescreen`, {})).json();
  }
  if (key === 'lock') {
    return (await httpPost(`${WDA_SERVER}/wda/lock`, {})).json();
  }
  if (key === 'unlock') {
    return (await httpPost(`${WDA_SERVER}/wda/unlock`, {})).json();
  }
  return { ok: false, error: 'unknown key' };
}

// ─── Device discovery ───

interface DeviceInfo {
  serial: string;
  model: string;
  platform: 'android' | 'ios';
  width: number;
  height: number;
  serverAvailable: boolean;
}

async function listDevices(): Promise<{ android: DeviceInfo[]; ios: DeviceInfo[] }> {
  const android: DeviceInfo[] = [];
  const ios: DeviceInfo[] = [];

  // Android
  const androidUp = await androidServerAvailable();
  if (androidUp) {
    const info = await androidInfo();
    if (info) {
      android.push({
        serial: 'device-server',
        model: `Android (${info.screenWidth}x${info.screenHeight})`,
        platform: 'android',
        width: info.screenWidth,
        height: info.screenHeight,
        serverAvailable: true,
      });
    }
  } else {
    try {
      const out = execFileSync('adb', ['devices', '-l'], { encoding: 'utf-8', timeout: 3000 });
      for (const line of out.split('\n')) {
        const m = line.match(/^(\S+)\s+device\s+/);
        if (m) {
          const modelMatch = line.match(/model:(\S+)/);
          android.push({
            serial: m[1], model: modelMatch?.[1] || m[1],
            platform: 'android', width: 1080, height: 2400, serverAvailable: false,
          });
        }
      }
    } catch { /* no adb */ }
  }

  // iOS
  const wdaUp = await wdaAvailable();
  if (wdaUp) {
    const size = await wdaWindowSize();
    ios.push({
      serial: 'wda',
      model: `iOS Simulator (WDA ${size?.width || 393}x${size?.height || 852})`,
      platform: 'ios',
      width: size?.width || 393,
      height: size?.height || 852,
      serverAvailable: true,
    });
  } else {
    try {
      const out = execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf-8', timeout: 3000 });
      const data = JSON.parse(out);
      for (const rt of Object.keys(data.devices)) {
        for (const d of data.devices[rt]) {
          if (d.state === 'Booted') {
            ios.push({
              serial: d.udid, model: d.name,
              platform: 'ios', width: 393, height: 852, serverAvailable: false,
            });
          }
        }
      }
    } catch { /* no simctl */ }
  }

  return { android, ios };
}

// ─── JSON helpers ───

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ─── HTTP Server ───

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    return;
  }

  if (req.url === '/api/devices' && req.method === 'GET') {
    json(res, 200, await listDevices());
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { platform } = body;

      if (req.url === '/api/tap') {
        const { x, y } = body;
        console.log(`[tap] ${platform} (${Math.round(x)}, ${Math.round(y)})`);
        const result = platform === 'android' ? await androidTap(x, y) : await wdaTap(x, y);
        json(res, 200, result);
        return;
      }

      if (req.url === '/api/swipe') {
        const { x1, y1, x2, y2, duration } = body;
        console.log(`[swipe] ${platform} (${Math.round(x1)},${Math.round(y1)})->(${Math.round(x2)},${Math.round(y2)})`);
        const result = platform === 'android'
          ? await androidSwipe(x1, y1, x2, y2, (duration || 300) / 5)
          : await wdaSwipe(x1, y1, x2, y2, duration || 300);
        json(res, 200, result);
        return;
      }

      if (req.url === '/api/key') {
        const { key } = body;
        console.log(`[key] ${platform} ${key}`);
        const result = platform === 'android' ? await androidKey(key) : await wdaKey(key);
        json(res, 200, result);
        return;
      }

      if (req.url === '/api/type') {
        const { text } = body;
        console.log(`[type] ${platform} "${text}"`);
        const result = platform === 'android' ? await androidType(text) : await wdaType(text);
        json(res, 200, result);
        return;
      }
    } catch (err: any) {
      console.error('[Input]', err?.message);
      json(res, 500, { error: err?.message });
      return;
    }
  }

  // ─── Bezel routes (C2) ───
  // GET /bezel/:chromeId/chrome.json
  // GET /bezel/:chromeId/bezel.png
  const bezelMatch = req.url?.match(/^\/bezel\/([\w,_-]+)\/(chrome\.json|bezel\.png)$/);
  if (req.method === 'GET' && bezelMatch) {
    const [, chromeId, kind] = bezelMatch;
    const { handleChromeJson, handleBezelPng } = await import('./bezel-routes.js');
    if (kind === 'chrome.json') {
      await handleChromeJson(req, res, chromeId);
    } else {
      await handleBezelPng(req, res, chromeId);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ─── WebSocket streaming ───

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', `http://${req.headers.host}`).pathname;

  if (pathname === '/stream') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const platform = url.searchParams.get('platform') as 'android' | 'ios';
      const deviceId = url.searchParams.get('deviceId');
      if (!platform || !deviceId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing params' }));
        ws.close();
        return;
      }
      console.log('[stream] %s connected', platform);
      streamLoop(ws, platform);
    });
    return;
  }

  if (pathname === '/logs') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const platform = url.searchParams.get('platform') as 'android' | 'ios';
      const deviceId = url.searchParams.get('deviceId') ?? '';
      handleLogsWs(ws, platform, deviceId).catch((err) => {
        console.error('[logs] error:', err);
        try { ws.close(); } catch {}
      });
    });
    return;
  }

  if (pathname === '/describe-ui') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const platform = url.searchParams.get('platform') as 'android' | 'ios';
      const deviceId = url.searchParams.get('deviceId') ?? '';
      handleDescribeUiWs(ws, platform, deviceId).catch((err) => {
        console.error('[describe-ui] error:', err);
        try { ws.close(); } catch {}
      });
    });
    return;
  }

  // /camera and /cameras/:udid/camera (E4)
  const cameraMatch = pathname.match(/^\/cameras\/([\w.:-]+)\/camera$/) ?? null;
  if (pathname === '/camera' || cameraMatch) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const udid = cameraMatch ? cameraMatch[1]! : (url.searchParams.get('udid') ?? 'default');
      handleCameraWs(ws, udid).catch((err) => {
        console.error('[camera %s] handler error: %s', udid, err?.message ?? String(err));
        try { ws.close(1011, 'camera handler error'); } catch {}
      });
    });
    return;
  }

  socket.destroy();
});

async function streamLoop(ws: WebSocket, platform: 'android' | 'ios') {
  let running = true;
  ws.on('close', () => { running = false; });
  ws.on('error', () => { running = false; });

  // Send device size
  let width = 1080, height = 2400;
  if (platform === 'ios') {
    const sz = await wdaWindowSize();
    if (sz) { width = sz.width; height = sz.height; }
  } else {
    const info = await androidInfo();
    if (info) { width = info.screenWidth; height = info.screenHeight; }
  }
  ws.send(JSON.stringify({ type: 'metadata', width, height }));

  let frames = 0;
  while (running && ws.readyState === WebSocket.OPEN) {
    const start = Date.now();
    try {
      const buf = platform === 'android' ? await androidScreenshot() : await wdaScreenshot();
      if (buf && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'frame', data: buf.toString('base64') }));
        frames++;
        if (frames === 1) console.log('[stream] %s first frame (%d bytes, %dms)', platform, buf.length, Date.now() - start);
      }
    } catch (err) {
      console.error('[stream] %s error:', platform, err);
    }

    // Throttle: aim for ~5-8 fps to avoid overwhelming
    const elapsed = Date.now() - start;
    const wait = Math.max(10, 130 - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }

  console.log('[stream] %s disconnected (%d frames)', platform, frames);
}

async function handleLogsWs(ws: WebSocket, platform: 'android' | 'ios', deviceId: string): Promise<void> {
  const { AndroidLogStream } = await import('@device-stream/android');
  const { IOSSimulatorLogStream } = await import('@device-stream/ios-simulator');
  const stream = platform === 'android' ? new AndroidLogStream() : new IOSSimulatorLogStream();

  ws.on('message', async (raw: Buffer | string) => {
    let env: any;
    try { env = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')); }
    catch { return; }

    if (env?.type === 'subscribe_logs') {
      try {
        await stream.start(deviceId, {
          priority: env.level,
          predicate: env.predicate,
          bundleId: env.bundleId,
        });
        ws.send(JSON.stringify({ type: 'log_started' }));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', error: err?.message ?? 'log start failed' }));
      }
    } else if (env?.type === 'stop_logs') {
      await stream.stop();
      ws.send(JSON.stringify({ type: 'log_stopped', reason: 'client request' }));
    }
  });

  stream.on('line', (line: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'log', line }));
    }
  });

  ws.on('close', async () => { await stream.stop(); });
}

// ─── /camera WebSocket (E4) ───
// Lazily import the ios-simulator package so the test-app stays
// runnable without the dylib + sim-cam binary at boot.
let _cameraSessionPromise: Promise<any> | null = null;
async function getCameraSession(): Promise<any> {
  if (!_cameraSessionPromise) {
    _cameraSessionPromise = (async () => {
      // Dynamic import keeps the import side-effect lazy so the rest
      // of the test-app works even when @device-stream/ios-simulator
      // hasn't been rebuilt yet.
      const mod: any = await import('@device-stream/ios-simulator' as any);
      const Ctor = mod.CameraSession ?? (await import(
        '../packages/ios-simulator/src/camera-session.js' as any
      )).CameraSession;
      return new Ctor();
    })();
  }
  return _cameraSessionPromise;
}

async function handleCameraWs(ws: WebSocket, udid: string): Promise<void> {
  const { parseCameraMessage } = await import(
    '../packages/ios-simulator/src/camera-message.js' as any
  );
  const session: any = await getCameraSession();

  const sendJson = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  };

  const onState = (event: { udid: string; phase: 'idle' | 'streaming'; device?: string; fps?: number }) => {
    if (event.udid !== udid) return;
    const msg: Record<string, unknown> = { type: 'camera_state', phase: event.phase };
    if (event.device !== undefined) msg.device = event.device;
    if (event.fps !== undefined) msg.fps = event.fps;
    sendJson(msg);
  };
  session.on('state', onState);

  // Send the initial device list on connect.
  try {
    const devices = await session.list();
    sendJson({ type: 'camera_devices', devices });
  } catch (err: any) {
    sendJson({ type: 'camera_error', error: err?.message ?? 'camera_list failed' });
  }

  ws.on('message', async (raw: Buffer | string) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
    const parsed = parseCameraMessage(text);
    if (!parsed.ok) {
      sendJson({ type: 'camera_error', error: parsed.error });
      return;
    }
    const msg = parsed.value;
    try {
      switch (msg.type) {
        case 'camera_list': {
          const devices = await session.list();
          sendJson({ type: 'camera_devices', devices });
          break;
        }
        case 'camera_start': {
          await session.start(udid, {
            deviceUID: msg.deviceUID,
            fit: msg.fit,
            mirror: msg.mirror,
          });
          break;
        }
        case 'camera_stop': {
          await session.stop(udid);
          break;
        }
        case 'camera_set_flags': {
          await session.setFlags(udid, { fit: msg.fit, mirror: msg.mirror });
          break;
        }
      }
    } catch (err: any) {
      console.error('[camera %s] %s', udid, err?.message ?? String(err));
      sendJson({ type: 'camera_error', error: err?.message ?? 'camera dispatch failed' });
      try { ws.close(1011, 'camera dispatch error'); } catch {}
    }
  });

  ws.on('close', () => {
    session.off?.('state', onState);
    session.stop?.(udid).catch((err: any) => {
      console.error('[camera %s] cleanup stop failed: %s', udid, err?.message ?? String(err));
    });
  });
}

async function handleDescribeUiWs(ws: WebSocket, platform: 'android' | 'ios', deviceId: string): Promise<void> {
  ws.on('message', async (raw: Buffer | string) => {
    let env: any;
    try { env = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')); }
    catch { return; }
    if (env?.type !== 'describe_ui') return;

    if (platform !== 'ios') {
      ws.send(JSON.stringify({
        type: 'describe_ui_result',
        ok: false,
        error: 'describe_ui currently iOS-only (Android via /hierarchy)',
      }));
      return;
    }

    try {
      const { fetchDescribeUi } = await import('@device-stream/ios-simulator');
      const tree = await fetchDescribeUi(deviceId);
      ws.send(JSON.stringify({ type: 'describe_ui_result', ok: true, tree }));
    } catch (err: any) {
      ws.send(JSON.stringify({
        type: 'describe_ui_result', ok: false,
        error: err?.message ?? 'describe_ui failed',
      }));
    }
  });
}

// ─── Start ───

server.listen(PORT, async () => {
  console.log(`\n  device-stream test app v2 (fast servers)`);
  console.log(`  http://localhost:${PORT}\n`);

  const androidUp = await androidServerAvailable();
  const wdaUp = await wdaAvailable();

  console.log(`  Android device-server (port 9008): ${androidUp ? 'ONLINE' : 'offline'}`);
  console.log(`  iOS WDA (port 8100):               ${wdaUp ? 'ONLINE' : 'offline'}`);
  console.log('');
});
