import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, open, rename, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTICLE_EXTENSIONS, extractArticle } from './lib/articles.mjs';
import { MAX_REFERENCE_BYTES } from './lib/imports.mjs';
import { startWriterServer } from './server.mjs';

const scheme = 'agent-writer';
const workspaceHost = 'workspace';
const workspaceOrigin = `${scheme}://${workspaceHost}`;
protocol.registerSchemesAsPrivileged([{
  scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);
app.setName('Agent Writer');
app.setAppUserModelId('com.agentwriter.desktop');

let window;
let backend;
let pickingArticle = false;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function workspaceDirectory() {
  if (process.env.AGENT_WRITER_DATA_DIR) return resolve(process.env.AGENT_WRITER_DATA_DIR);
  const destination = join(app.getPath('userData'), 'workspace');
  if (await exists(destination)) return destination;
  const adjacent = process.env.PORTABLE_EXECUTABLE_DIR || (!app.isPackaged ? app.getAppPath() : '');
  if (!adjacent) return destination;
  const candidates = [join(adjacent, '.writer-data')];
  if (basename(adjacent).toLowerCase() === 'dist') candidates.push(join(dirname(adjacent), '.writer-data'));
  for (const candidate of candidates) {
    if (!(await exists(join(candidate, 'workspace.json'))) || !(await exists(join(candidate, 'vault.key')))) continue;
    await mkdir(dirname(destination), { recursive: true });
    const temp = await mkdtemp(join(dirname(destination), 'workspace-copy-'));
    try {
      await copyFile(join(candidate, 'workspace.json'), join(temp, 'workspace.json'));
      await copyFile(join(candidate, 'vault.key'), join(temp, 'vault.key'));
      await rename(temp, destination);
    } finally {
      await rm(join(temp, 'workspace.json'), { force: true });
      await rm(join(temp, 'vault.key'), { force: true });
      await rmdir(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    break;
  }
  return destination;
}

function openExternal(url) {
  if (new URL(url).protocol === 'https:') void shell.openExternal(url).catch(() => {});
}

async function previewArticleFile(path) {
  const name = basename(path);
  let bytes;
  try {
    const file = await open(path, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile()) return { name, error: '请选择一个文章文件。' };
      if (info.size > MAX_REFERENCE_BYTES) return { name, error: '单个文章文件不能超过 25 MB。' };
      bytes = Buffer.concat(await file.createReadStream({ autoClose: false, end: MAX_REFERENCE_BYTES }).toArray());
    } finally {
      await file.close();
    }
  } catch {
    return { name, error: '无法读取此文件，请检查文件是否仍可访问。' };
  }
  try {
    return { name, preview: await extractArticle(name, bytes) };
  } catch (error) {
    return { name, error: error.message };
  }
}

async function pickArticle(event) {
  const owner = window;
  const frame = event.senderFrame;
  if (!owner || event.sender !== owner.webContents || !frame ||
      frame !== event.sender.mainFrame || !frame.url.startsWith(`${workspaceOrigin}/`)) {
    throw new Error('无法从当前页面选择文章文件。');
  }
  if (pickingArticle) return null;
  pickingArticle = true;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(owner, {
      title: '选择要导入的文章',
      properties: ['openFile'],
      filters: [{ name: '文章文件', extensions: [...ARTICLE_EXTENSIONS] }],
    });
    return canceled || !filePaths[0] ? null : await previewArticleFile(filePaths[0]);
  } catch {
    return { error: '无法打开文件选择窗口，请重试。' };
  } finally {
    pickingArticle = false;
  }
}

function registerWorkspace(origin, token) {
  protocol.handle(scheme, async request => {
    const original = new URL(request.url);
    if (original.host !== workspaceHost ||
        (request.initiatorOrigin && request.initiatorOrigin !== workspaceOrigin) ||
        !['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
      return new Response(null, { status: 403 });
    }
    const target = new URL(origin);
    target.pathname = original.pathname;
    target.search = original.search;
    const headers = new Headers(request.headers);
    for (const header of ['host', 'origin', 'content-length', 'transfer-encoding']) headers.delete(header);
    headers.set('x-agent-writer-token', token);
    try {
      return await fetch(target, {
        method: request.method,
        headers,
        redirect: 'error',
        signal: request.signal,
        ...(request.body ? { body: request.body, duplex: 'half' } : {}),
      });
    } catch {
      return new Response(JSON.stringify({ error: '本机工作区暂时无法访问。' }), {
        status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  });
}

async function openWindow() {
  window = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 640,
    minHeight: 540,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Agent Writer',
    icon: join(app.getAppPath(), 'desktop-icon.ico'),
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      navigateOnDragDrop: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.protocol !== `${scheme}:` || target.host !== workspaceHost) {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.on('closed', () => { window = null; });
  await window.loadURL(`${workspaceOrigin}/`);
  window?.show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { void backend?.close().catch(() => {}); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const token = randomBytes(32).toString('hex');
    backend = await startWriterServer({ port: 0, directory: await workspaceDirectory(), token });
    registerWorkspace(backend.origin, token);
    ipcMain.handle('article:pick', pickArticle);
    await openWindow();
  }).catch(error => {
    dialog.showErrorBox('Agent Writer 启动失败', `无法打开本地工作区。\n${error.code || error.message}`);
    app.quit();
  });
}
