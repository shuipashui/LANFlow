import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces, hostname } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-generator';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = join(APP_ROOT, 'public');
const DATA_ROOT = resolve(process.env.LANFLOW_DATA_DIR || process.env.LANTERN_DATA_DIR || join(APP_ROOT, 'data'));
const SHARED_ROOT = resolve(process.env.LANFLOW_SHARED_DIR || process.env.LANTERN_SHARED_DIR || join(DATA_ROOT, 'shared'));
const INBOX_ROOT = resolve(process.env.LANFLOW_INBOX_DIR || process.env.LANTERN_INBOX_DIR || join(DATA_ROOT, 'inbox'));
const TRANSFER_ROOT = resolve(process.env.LANFLOW_TRANSFER_DIR || process.env.LANTERN_TRANSFER_DIR || join(DATA_ROOT, 'transfers'));
const SHARED_FOLDERS_FILE = join(DATA_ROOT, 'shared-folders.json');
const SETTINGS_FILE = join(DATA_ROOT, 'settings.json');
const PORT = Number.parseInt(process.env.PORT || '4173', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ENV_ACCESS_CODE = process.env.LANFLOW_ACCESS_CODE || process.env.LANTERN_ACCESS_CODE || '';
const MAX_UPLOAD_BYTES = Number.parseInt(process.env.LANFLOW_MAX_UPLOAD_BYTES || process.env.LANTERN_MAX_UPLOAD_BYTES || String(20 * 1024 ** 3), 10);
const TRANSFER_TTL_MS = Number.parseInt(process.env.LANFLOW_TRANSFER_TTL_MS || process.env.LANTERN_TRANSFER_TTL_MS || String(24 * 60 * 60 * 1000), 10);
const DEVICE_NAME = process.env.LANFLOW_NAME || process.env.LANTERN_NAME || hostname();

const sessions = new Map();
const clients = new Map();
const transfers = new Map();
const sseConnections = new Map();
let sharedFolders = [];
let accessRecord = null;
let autoStopMinutes = 60;
let autoStopDeadline = 0;
let autoStopTimer = null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.zip': 'application/zip'
};

await Promise.all([SHARED_ROOT, INBOX_ROOT, TRANSFER_ROOT].map((path) => mkdir(path, { recursive: true })));
try {
  const saved = JSON.parse(await readFile(SHARED_FOLDERS_FILE, 'utf8'));
  if (Array.isArray(saved)) sharedFolders = saved.filter((item) => item?.id && item?.name && item?.path);
} catch (error) {
  if (error.code !== 'ENOENT') console.error('读取共享文件夹配置失败：', error.message);
}
if (!ENV_ACCESS_CODE) {
  try {
    const settings = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'));
    if (settings.accessCodeSalt && settings.accessCodeHash) accessRecord = { salt: String(settings.accessCodeSalt), hash: String(settings.accessCodeHash) };
    if ([0, 30, 60, 120, 240].includes(Number(settings.autoStopMinutes))) autoStopMinutes = Number(settings.autoStopMinutes);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('读取访问设置失败：', error.message);
  }
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function fail(res, status, message) {
  json(res, status, { error: message });
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON 格式无效'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [decodeURIComponent(part.slice(0, index).trim()), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function isAuthorized(req) {
  if (!accessRequired()) return true;
  const token = cookies(req).lanflow_session || cookies(req).lantern_session;
  return Boolean(token && sessions.has(token));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function safePath(root, requested = '') {
  let decoded;
  try { decoded = decodeURIComponent(requested); } catch { throw Object.assign(new Error('路径编码无效'), { status: 400 }); }
  if (decoded.includes('\0') || decoded.includes('\u0000')) throw Object.assign(new Error('路径无效'), { status: 400 });
  const target = resolve(root, decoded.replace(/^[/\\]+/, ''));
  if (target !== root && !target.startsWith(root + sep)) throw Object.assign(new Error('禁止访问共享目录之外的路径'), { status: 403 });
  return target;
}

function cleanFilename(value) {
  const cleaned = basename(String(value || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
  return cleaned || `file-${Date.now()}`;
}

function isLocalRequest(req) {
  const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (address === '127.0.0.1' || address === '::1') return true;
  return Object.values(networkInterfaces()).some((entries) => (entries || []).some((info) => info.address === address));
}

async function saveSharedFolders() {
  await writeFile(SHARED_FOLDERS_FILE, `${JSON.stringify(sharedFolders, null, 2)}\n`, 'utf8');
}

async function saveSettings() {
  const settings = { autoStopMinutes, ...(accessRecord ? { accessCodeSalt: accessRecord.salt, accessCodeHash: accessRecord.hash } : {}) };
  await writeFile(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function accessRequired() {
  return Boolean(ENV_ACCESS_CODE || accessRecord);
}

function verifyAccessCode(value) {
  if (ENV_ACCESS_CODE) return safeEqual(value, ENV_ACCESS_CODE);
  if (!accessRecord) return true;
  const candidate = scryptSync(String(value), accessRecord.salt, 32).toString('hex');
  return safeEqual(candidate, accessRecord.hash);
}

function chooseWindowsFolder() {
  if (process.platform !== 'win32') throw Object.assign(new Error('当前仅支持在 Windows 主机选择文件夹'), { status: 501 });
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = "选择要通过 LANFlow 共享的文件夹"',
    '$dialog.ShowNewFolderButton = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }'
  ].join('; ');
  return new Promise((resolveFolder, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) return reject(Object.assign(new Error('无法打开文件夹选择窗口'), { status: 500 }));
      resolveFolder(String(stdout || '').trim());
    });
  });
}

async function verifiedPath(root, requested = '') {
  const target = safePath(root, requested);
  const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(canonicalRoot + sep)) {
    throw Object.assign(new Error('禁止通过链接访问共享目录之外的路径'), { status: 403 });
  }
  return canonicalTarget;
}

async function resolveLibraryPath(requested = '') {
  const normalized = String(requested || '').replace(/^[/\\]+/, '').split('\\').join('/');
  if (!normalized.startsWith('@')) {
    const path = await verifiedPath(SHARED_ROOT, normalized);
    return { path, relativePath: relative(SHARED_ROOT, path).split(sep).join('/'), folder: null };
  }
  const [mount, ...rest] = normalized.split('/');
  const folder = sharedFolders.find((item) => `@${item.id}` === mount);
  if (!folder) throw Object.assign(new Error('共享文件夹不存在或已移除'), { status: 404 });
  const path = await verifiedPath(folder.path, rest.join('/'));
  const childPath = relative(folder.path, path).split(sep).join('/');
  return { path, relativePath: [mount, childPath].filter(Boolean).join('/'), folder };
}

function libraryBreadcrumbs(resolved) {
  const segments = resolved.relativePath ? resolved.relativePath.split('/') : [];
  const result = [{ label: '共享空间', path: '' }];
  if (resolved.folder) {
    result.push({ label: resolved.folder.name, path: segments[0] });
    for (let index = 1; index < segments.length; index += 1) result.push({ label: segments[index], path: segments.slice(0, index + 1).join('/') });
  } else {
    for (let index = 0; index < segments.length; index += 1) result.push({ label: segments[index], path: segments.slice(0, index + 1).join('/') });
  }
  return result;
}

async function availablePath(folder, originalName) {
  const name = cleanFilename(originalName);
  const extension = extname(name);
  const stem = basename(name, extension);
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = join(folder, index ? `${stem} (${index})${extension}` : name);
    try { await access(candidate); } catch { return candidate; }
  }
  throw Object.assign(new Error('无法生成可用文件名'), { status: 409 });
}

function formatAddress() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const info of entries || []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(`http://${info.address}:${PORT}`);
    }
  }
  return addresses;
}

function sendEvent(clientId, type, payload) {
  const body = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  if (clientId === '*') {
    for (const connection of sseConnections.values()) connection.res.write(body);
    return;
  }
  sseConnections.get(clientId)?.res.write(body);
}

function devices() {
  const now = Date.now();
  return [...clients.values()].filter((client) => now - client.lastSeen < 90_000).map(({ id, name, platform, lastSeen }) => ({ id, name, platform, lastSeen }));
}

function announceDevices() {
  sendEvent('*', 'devices', { devices: devices() });
}

async function streamUpload(req, destination) {
  const declared = Number.parseInt(req.headers['content-length'] || '0', 10);
  if (declared > MAX_UPLOAD_BYTES) throw Object.assign(new Error('文件超过服务器上传上限'), { status: 413 });
  const temp = `${destination}.${randomBytes(6).toString('hex')}.part`;
  let bytes = 0;
  await new Promise((resolveUpload, reject) => {
    const output = createWriteStream(temp, { flags: 'wx' });
    const abort = (error) => { output.destroy(); reject(error); };
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) abort(Object.assign(new Error('文件超过服务器上传上限'), { status: 413 }));
    });
    req.on('aborted', () => abort(Object.assign(new Error('上传已中断'), { status: 499 })));
    req.on('error', abort);
    output.on('error', reject);
    output.on('finish', resolveUpload);
    req.pipe(output);
  }).catch(async (error) => { await rm(temp, { force: true }).catch(() => {}); throw error; });
  await rename(temp, destination);
  return bytes;
}

async function sendFile(req, res, path, downloadName, cache = false, disposition = 'attachment') {
  const info = await stat(path);
  if (!info.isFile()) return fail(res, 404, '文件不存在');
  const range = req.headers.range;
  const headers = {
    'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Last-Modified': info.mtime.toUTCString(),
    'Cache-Control': cache ? 'public, max-age=3600' : 'no-store',
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(downloadName)}`
  };
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return fail(res, 416, 'Range 无效');
    const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2] || 0));
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return fail(res, 416, 'Range 超出文件范围');
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(path, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const path = safePath(PUBLIC_ROOT, requested);
  let info;
  try { info = await stat(path); } catch { return fail(res, 404, '页面不存在'); }
  if (!info.isFile()) return fail(res, 404, '页面不存在');
  res.writeHead(200, {
    'Content-Type': MIME[extname(path)] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': pathname === '/sw.js' ? 'no-cache' : 'public, max-age=300'
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/info' && req.method === 'GET') {
    return json(res, 200, { name: DEVICE_NAME, version: '0.6.3', isHost: isLocalRequest(req), authRequired: accessRequired(), accessCodeManagedByEnv: Boolean(ENV_ACCESS_CODE), authorized: isAuthorized(req), autoStopMinutes, autoStopAt: autoStopDeadline ? new Date(autoStopDeadline).toISOString() : null, addresses: formatAddress(), maxUploadBytes: MAX_UPLOAD_BYTES, transferTtlMs: TRANSFER_TTL_MS });
  }
  if (url.pathname === '/api/auth' && req.method === 'POST') {
    const body = await readJson(req);
    if (verifyAccessCode(body.code || '')) {
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, Date.now());
      return json(res, 200, { ok: true }, { 'Set-Cookie': `lanflow_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400` });
    }
    return fail(res, 401, '访问口令不正确');
  }
  if (url.pathname === '/api/settings/access-code' && req.method === 'POST') {
    if (!isLocalRequest(req)) return fail(res, 403, '只能在运行服务的电脑上修改访问设置');
    const body = await readJson(req);
    const requestedMinutes = Number(body.autoStopMinutes ?? autoStopMinutes);
    if (![0, 30, 60, 120, 240].includes(requestedMinutes)) return fail(res, 400, '自动断开时长无效');
    let accessChanged = false;
    if (body.updateAccessCode || body.clearAccessCode) {
      if (ENV_ACCESS_CODE) return fail(res, 409, '访问口令由启动环境变量管理，无法在页面修改');
      const code = body.clearAccessCode ? '' : String(body.code || '');
      if (code && code.length < 4) return fail(res, 400, '访问口令至少需要 4 位');
      accessRecord = code ? (() => { const salt = randomBytes(16).toString('hex'); return { salt, hash: scryptSync(code, salt, 32).toString('hex') }; })() : null;
      sessions.clear();
      accessChanged = true;
    }
    autoStopMinutes = requestedMinutes;
    await saveSettings();
    scheduleAutoStop();
    const headers = {};
    if (accessChanged && accessRecord) {
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, Date.now());
      headers['Set-Cookie'] = `lanflow_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
    } else if (accessChanged) headers['Set-Cookie'] = 'lanflow_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
    return json(res, 200, { ok: true, authRequired: accessRequired(), autoStopMinutes, autoStopAt: autoStopDeadline ? new Date(autoStopDeadline).toISOString() : null }, headers);
  }
  if (url.pathname === '/api/shutdown' && req.method === 'POST') {
    if (!isLocalRequest(req)) return fail(res, 403, '只能在运行服务的电脑上结束服务');
    json(res, 200, { ok: true });
    setTimeout(() => {
      console.log('\n  已从网页结束 LANFlow 服务。\n');
      sendEvent('*', 'shutdown', { reason: 'manual' });
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    }, 250).unref();
    return;
  }
  if (!isAuthorized(req)) return fail(res, 401, '需要访问口令');

  if (url.pathname === '/api/qr' && req.method === 'GET') {
    const value = String(url.searchParams.get('text') || '').slice(0, 512);
    if (!value) return fail(res, 400, '缺少二维码内容');
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const svg = code.createSvgTag({ cellSize: 7, margin: 4, scalable: true });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(svg) });
    return res.end(svg);
  }

  if (url.pathname === '/api/shared-folders' && req.method === 'GET') {
    return json(res, 200, { folders: sharedFolders.map((folder) => ({ id: folder.id, name: folder.name, ...(isLocalRequest(req) ? { path: folder.path } : {}) })), isHost: isLocalRequest(req) });
  }
  if (url.pathname === '/api/shared-folders/select' && req.method === 'POST') {
    if (!isLocalRequest(req)) return fail(res, 403, '只能在运行服务的电脑上选择共享文件夹');
    const selected = await chooseWindowsFolder();
    if (!selected) return json(res, 200, { cancelled: true });
    const canonical = await realpath(selected);
    if (!(await stat(canonical)).isDirectory()) return fail(res, 400, '选择的路径不是文件夹');
    const existing = sharedFolders.find((folder) => folder.path.toLowerCase() === canonical.toLowerCase());
    if (existing) return json(res, 200, { folder: existing, existing: true });
    const folder = { id: randomUUID(), name: basename(canonical) || canonical, path: canonical };
    sharedFolders.push(folder);
    await saveSharedFolders();
    sendEvent('*', 'library', { changed: 'folders' });
    return json(res, 201, { folder });
  }
  const sharedFolderMatch = /^\/api\/shared-folders\/([a-f0-9-]+)$/.exec(url.pathname);
  if (sharedFolderMatch && req.method === 'DELETE') {
    if (!isLocalRequest(req)) return fail(res, 403, '只能在运行服务的电脑上移除共享文件夹');
    const index = sharedFolders.findIndex((folder) => folder.id === sharedFolderMatch[1]);
    if (index < 0) return fail(res, 404, '共享文件夹不存在');
    sharedFolders.splice(index, 1);
    await saveSharedFolders();
    sendEvent('*', 'library', { changed: 'folders' });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/files' && req.method === 'GET') {
    const resolved = await resolveLibraryPath(url.searchParams.get('path') || '');
    const entries = await readdir(resolved.path, { withFileTypes: true });
    const items = await Promise.all(entries.filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink()).map(async (entry) => {
      const info = await stat(join(resolved.path, entry.name));
      return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size: entry.isFile() ? info.size : null, modified: info.mtime.toISOString() };
    }));
    if (!resolved.relativePath) {
      for (const folder of sharedFolders) {
        try {
          const info = await stat(folder.path);
          if (info.isDirectory()) items.push({ name: folder.name, type: 'directory', size: null, modified: info.mtime.toISOString(), path: `@${folder.id}`, external: true });
        } catch {}
      }
    }
    items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : a.type === 'directory' ? -1 : 1));
    return json(res, 200, { path: resolved.relativePath, breadcrumbs: libraryBreadcrumbs(resolved), external: Boolean(resolved.folder), items });
  }
  if (url.pathname === '/api/inbox' && req.method === 'GET') {
    const entries = await readdir(INBOX_ROOT, { withFileTypes: true });
    const items = await Promise.all(entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.')).map(async (entry) => {
      const info = await stat(join(INBOX_ROOT, entry.name));
      return { name: entry.name, size: info.size, modified: info.mtime.toISOString() };
    }));
    return json(res, 200, { items: items.sort((a, b) => b.modified.localeCompare(a.modified)) });
  }
  if (url.pathname === '/api/inbox/open' && req.method === 'POST') {
    if (!isLocalRequest(req)) return fail(res, 403, '只能在运行服务的电脑上打开接收箱目录');
    if (process.platform !== 'win32') return fail(res, 501, '当前仅支持在 Windows 主机打开目录');
    execFile('explorer.exe', [INBOX_ROOT], { windowsHide: false }, () => {});
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/inbox/download' && ['GET', 'HEAD'].includes(req.method)) {
    const path = await verifiedPath(INBOX_ROOT, url.searchParams.get('name') || '');
    return sendFile(req, res, path, basename(path));
  }
  if (url.pathname === '/api/inbox/preview' && ['GET', 'HEAD'].includes(req.method)) {
    const path = await verifiedPath(INBOX_ROOT, url.searchParams.get('name') || '');
    return sendFile(req, res, path, basename(path), false, 'inline');
  }
  if (url.pathname === '/api/download' && ['GET', 'HEAD'].includes(req.method)) {
    const resolved = await resolveLibraryPath(url.searchParams.get('path') || '');
    return sendFile(req, res, resolved.path, basename(resolved.path));
  }
  if (url.pathname === '/api/preview' && ['GET', 'HEAD'].includes(req.method)) {
    const resolved = await resolveLibraryPath(url.searchParams.get('path') || '');
    return sendFile(req, res, resolved.path, basename(resolved.path), false, 'inline');
  }
  if (url.pathname === '/api/devices' && req.method === 'GET') return json(res, 200, { devices: devices() });
  if (url.pathname === '/api/presence' && req.method === 'POST') {
    const body = await readJson(req);
    const id = String(body.id || '').slice(0, 80);
    if (!id) return fail(res, 400, '缺少设备 ID');
    clients.set(id, { id, name: String(body.name || '未命名设备').slice(0, 40), platform: String(body.platform || 'browser').slice(0, 160), lastSeen: Date.now() });
    announceDevices();
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/transfers' && req.method === 'GET') {
    const recipientId = String(url.searchParams.get('recipient') || '');
    const now = Date.now();
    const pending = [...transfers.values()].filter((transfer) => transfer.expiresAt > now && transfer.senderId !== recipientId && (transfer.recipientId === '*' || transfer.recipientId === recipientId));
    return json(res, 200, { transfers: pending.sort((a, b) => b.createdAt - a.createdAt) });
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    const id = String(url.searchParams.get('id') || '').slice(0, 80);
    if (!id) return fail(res, 400, '缺少设备 ID');
    const client = { id, name: String(url.searchParams.get('name') || '未命名设备').slice(0, 40), platform: String(url.searchParams.get('platform') || 'browser').slice(0, 40), lastSeen: Date.now() };
    clients.set(id, client);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`event: ready\ndata: ${JSON.stringify({ id })}\n\n`);
    sseConnections.set(id, { res });
    announceDevices();
    const heartbeat = setInterval(() => { client.lastSeen = Date.now(); res.write(': ping\n\n'); }, 25_000);
    req.on('close', () => { clearInterval(heartbeat); if (sseConnections.get(id)?.res === res) sseConnections.delete(id); announceDevices(); });
    return;
  }

  if (url.pathname === '/api/upload' && req.method === 'PUT') {
    const originalName = url.searchParams.get('name') || req.headers['x-file-name'];
    if (!originalName) return fail(res, 400, '缺少文件名');
    const requestedMode = url.searchParams.get('mode');
    const mode = ['inbox', 'shared'].includes(requestedMode) ? 'inbox' : requestedMode === 'library' ? 'library' : 'transfer';
    if (mode === 'inbox') {
      const destination = await availablePath(INBOX_ROOT, originalName);
      const size = await streamUpload(req, destination);
      sendEvent('*', 'inbox', { name: basename(destination), size, receivedAt: new Date().toISOString() });
      return json(res, 201, { ok: true, name: basename(destination), size });
    }
    if (mode === 'library') {
      const folder = await verifiedPath(SHARED_ROOT, url.searchParams.get('path') || '');
      if (!(await stat(folder)).isDirectory()) return fail(res, 400, '共享空间目标不是文件夹');
      const destination = await availablePath(folder, originalName);
      const size = await streamUpload(req, destination);
      sendEvent('*', 'library', { name: basename(destination), size, receivedAt: new Date().toISOString() });
      return json(res, 201, { ok: true, name: basename(destination), size });
    }
    const id = randomUUID();
    const folder = join(TRANSFER_ROOT, id);
    await mkdir(folder, { recursive: true });
    const destination = join(folder, cleanFilename(originalName));
    const size = await streamUpload(req, destination);
    const transfer = {
      id, name: basename(destination), size, senderId: String(url.searchParams.get('sender') || ''),
      senderName: String(url.searchParams.get('senderName') || '局域网设备').slice(0, 40),
      recipientId: String(url.searchParams.get('recipient') || '*'), createdAt: Date.now(), expiresAt: Date.now() + TRANSFER_TTL_MS
    };
    transfers.set(id, transfer);
    if (transfer.recipientId === '*') {
      for (const [clientId, connection] of sseConnections) {
        if (clientId !== transfer.senderId) connection.res.write(`event: transfer\ndata: ${JSON.stringify(transfer)}\n\n`);
      }
    } else sendEvent(transfer.recipientId, 'transfer', transfer);
    return json(res, 201, transfer);
  }
  const transferMatch = /^\/api\/transfers\/([a-f0-9-]+)(\/preview)?$/.exec(url.pathname);
  if (transferMatch && ['GET', 'HEAD'].includes(req.method)) {
    const transfer = transfers.get(transferMatch[1]);
    if (!transfer || transfer.expiresAt < Date.now()) return fail(res, 404, '文件不存在或已过期');
    return sendFile(req, res, join(TRANSFER_ROOT, transfer.id, transfer.name), transfer.name, false, transferMatch[2] ? 'inline' : 'attachment');
  }
  if (transferMatch && !transferMatch[2] && req.method === 'DELETE') {
    const transfer = transfers.get(transferMatch[1]);
    if (!transfer) return fail(res, 404, '传输不存在');
    transfers.delete(transfer.id);
    await rm(join(TRANSFER_ROOT, transfer.id), { recursive: true, force: true });
    return json(res, 200, { ok: true });
  }
  return fail(res, 404, '接口不存在');
}

function scheduleAutoStop() {
  if (autoStopTimer) clearTimeout(autoStopTimer);
  autoStopTimer = null;
  autoStopDeadline = autoStopMinutes ? Date.now() + autoStopMinutes * 60_000 : 0;
  if (!autoStopDeadline) return;
  autoStopTimer = setTimeout(() => {
    console.log(`\n  已到达 ${autoStopMinutes} 分钟自动断开时间，LANFlow 已停止。\n`);
    sendEvent('*', 'shutdown', { reason: 'auto-stop' });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  }, autoStopMinutes * 60_000);
  autoStopTimer.unref();
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (['GET', 'HEAD'].includes(req.method)) await serveStatic(req, res, url.pathname);
    else fail(res, 405, '不支持的请求方法');
  } catch (error) {
    if (!res.headersSent) fail(res, error.status || (error.code === 'ENOENT' ? 404 : 500), error.status ? error.message : '服务器内部错误');
    if (!error.status && error.code !== 'ENOENT') console.error(error);
  }
});

const cleanup = setInterval(async () => {
  const now = Date.now();
  for (const [id, transfer] of transfers) {
    if (transfer.expiresAt <= now) {
      transfers.delete(id);
      await rm(join(TRANSFER_ROOT, id), { recursive: true, force: true }).catch(() => {});
    }
  }
  for (const [token, createdAt] of sessions) if (now - createdAt > 24 * 60 * 60 * 1000) sessions.delete(token);
}, 60_000);
cleanup.unref();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => {
    scheduleAutoStop();
    console.log(`\n  LANFlow · ${DEVICE_NAME}`);
    console.log(`  Local:   http://localhost:${PORT}`);
    for (const address of formatAddress()) console.log(`  Network: ${address}`);
    console.log(`  Shared:  ${SHARED_ROOT}`);
    console.log(`  Inbox:   ${INBOX_ROOT}\n`);
    if ((process.env.LANFLOW_OPEN_BROWSER || process.env.LANTERN_OPEN_BROWSER) === '1' && process.platform === 'win32') {
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', `http://localhost:${PORT}`], { windowsHide: true }, () => {});
    }
  });
}

export { server, safePath, cleanFilename };
