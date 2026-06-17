import { app, BrowserWindow, ipcMain, session, Session } from 'electron';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import type { IncomingMessage } from 'http';
import type { Track, YTData, CookieImportResult } from './types';

// ── Constants ────────────────────────────────────────────────────────────────

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── App-level switches (must run before app is ready) ────────────────────────

app.userAgentFallback = CHROME_UA;
app.commandLine.appendSwitch('autoplay-policy',     'no-user-gesture-required');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// ── Session helpers ───────────────────────────────────────────────────────────

function applyYouTubeSession(sess: Session): void {
  sess.setUserAgent(CHROME_UA);
  sess.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'x-frame-options' || lower === 'content-security-policy') {
        delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:  1060,
    height: 720,
    minWidth:  860,
    minHeight: 640,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true,
    },
  });

  applyYouTubeSession(session.defaultSession);
  applyYouTubeSession(session.fromPartition('persist:youtube'));

  // index.html lives at project root, dist/ is one level down
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Window control IPC ───────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-close',    () => mainWindow?.close());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});

// ── Chrome cookie import ──────────────────────────────────────────────────────
// Google blocks Electron from its OAuth login page by design.
// Solution: read the user's existing YouTube session from Chrome/Brave,
// decrypt it using macOS Keychain + AES-128-CBC, and import into our session.

ipcMain.handle('import-chrome-cookies', async (): Promise<CookieImportResult> => {
  try {
    const sess  = session.fromPartition('persist:youtube');
    const count = await importChromeYouTubeCookies(sess);
    return { success: true, count };
  } catch (e) {
    return { success: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
});

// Browser base directories (macOS)
const BROWSER_BASE_DIRS: ReadonlyArray<{ dir: string; keychainService: string; keychainAccount: string }> = [
  { dir: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),            keychainService: 'Chrome Safe Storage',       keychainAccount: 'Chrome' },
  { dir: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome Canary'),     keychainService: 'Chrome Safe Storage',       keychainAccount: 'Chrome' },
  { dir: path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'), keychainService: 'Brave Safe Storage',      keychainAccount: 'Brave'  },
  { dir: path.join(os.homedir(), 'Library', 'Application Support', 'Arc', 'User Data'),            keychainService: 'Arc Safe Storage',          keychainAccount: 'Arc'    },
];

// Profile directories to skip (not user profiles)
const SKIP_PROFILES = new Set([
  'Guest Profile', 'System Profile', 'Crashpad', 'component_crx_cache',
  'extensions_crx_cache', 'GrShaderCache', 'ShaderCache', 'GPUPersistentCache',
]);

function findChromeCookieDbs(): string[] {
  const found: string[] = [];

  for (const { dir } of BROWSER_BASE_DIRS) {
    if (!fs.existsSync(dir)) continue;

    let entries: string[];
    try { entries = fs.readdirSync(dir); }
    catch { continue; }

    // Collect profile dirs: Default, Profile N, Default Profile, etc.
    const profiles = entries.filter(e => {
      if (SKIP_PROFILES.has(e)) return false;
      return e === 'Default' || e === 'Default Profile' || /^Profile\s*\d+$/i.test(e);
    });

    for (const prof of profiles) {
      // Newer Chrome: <profile>/Network/Cookies, older: <profile>/Cookies
      for (const sub of ['Network/Cookies', 'Cookies']) {
        const p = path.join(dir, prof, sub);
        if (fs.existsSync(p)) { found.push(p); break; }
      }
    }
  }

  return found;
}

function getKeychainKey(): Buffer {
  // (service, account) pairs to try — ordered by likelihood
  const entries: ReadonlyArray<readonly [string, string]> = [
    ['Chrome Safe Storage',       'Chrome'],
    ['Chrome Safe Storage',       'Google Chrome'],
    ['Brave Safe Storage',        'Brave'],
    ['Arc Safe Storage',          'Arc'],
    ['Chromium Safe Storage',     'Chromium'],
  ];

  for (const [service, account] of entries) {
    try {
      const pw = execFileSync(
        'security',
        ['find-generic-password', '-w', '-s', service, '-a', account],
        { timeout: 5000 },
      ).toString().trim();
      if (pw) return crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
    } catch { /* try next */ }
  }
  throw new Error(
    'Keychain에서 브라우저 암호화 키를 찾을 수 없습니다.\n' +
    '키체인 접근 허용 팝업이 뜨면 반드시 "허용"을 클릭하세요.',
  );
}

function decryptChromeValue(encrypted: Buffer, key: Buffer): string {
  // v10 = AES-128-CBC, IV = 16 spaces
  if (encrypted.length > 3 && encrypted.subarray(0, 3).toString() === 'v10') {
    const iv       = Buffer.alloc(16, ' ');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString();
  }
  return encrypted.toString();
}

async function importChromeYouTubeCookies(sess: Session): Promise<number> {
  const aesKey = getKeychainKey();
  const dbs    = findChromeCookieDbs();

  if (dbs.length === 0) {
    throw new Error(
      'Chrome/Brave 쿠키 파일을 찾을 수 없습니다.\n' +
      'Chrome이 설치되어 있고 YouTube에 로그인되어 있는지 확인하세요.',
    );
  }

  const sql =
    `SELECT host_key,name,hex(encrypted_value),path,expires_utc,is_secure,is_httponly
     FROM cookies
     WHERE host_key LIKE '%.youtube.com' OR host_key='youtube.com'
        OR host_key LIKE '%.google.com'  OR host_key='google.com'`;

  // Deduplicate across profiles: keep the last value written (latest profile wins)
  const seen  = new Set<string>();
  let   count = 0;

  for (const dbPath of dbs) {
    const tmpPath = path.join(os.tmpdir(), `8bit-ck-${Date.now()}.db`);
    try {
      fs.copyFileSync(dbPath, tmpPath);
    } catch { continue; } // file locked or unreadable

    let rows: string[] = [];
    try {
      const out = execFileSync('sqlite3', [tmpPath, '-separator', '\x01', sql], { timeout: 5000 })
        .toString().trim();
      rows = out ? out.split('\n') : [];
    } catch { /* locked / not a cookie db */ }
    finally   { try { fs.unlinkSync(tmpPath); } catch { /* ignore */ } }

    for (const row of rows) {
      if (!row.trim()) continue;
      const parts = row.split('\x01');
      if (parts.length < 7) continue;
      const [hostKey, name, hex, cookiePath, expiresUtc, isSecure, isHttpOnly] =
        parts as [string, string, string, string, string, string, string];

      let value: string;
      try { value = decryptChromeValue(Buffer.from(hex, 'hex'), aesKey); }
      catch { continue; }

      const key = `${hostKey}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const chromeMicro    = parseInt(expiresUtc, 10);
      const expirationDate = chromeMicro > 0
        ? chromeMicro / 1_000_000 - 11_644_473_600
        : undefined;

      const domain = hostKey.startsWith('.') ? hostKey.slice(1) : hostKey;
      try {
        await sess.cookies.set({
          url:      `https://${domain}`,
          name,
          value,
          domain:   hostKey,
          path:     cookiePath || '/',
          secure:   isSecure  === '1',
          httpOnly: isHttpOnly === '1',
          ...(expirationDate && expirationDate > Date.now() / 1000 ? { expirationDate } : {}),
        });
        count++;
      } catch { /* skip invalid */ }
    }
  }

  return count;
}

// ── Lyrics IPC ───────────────────────────────────────────────────────────────

ipcMain.handle('fetch-lyrics', (_event, artist: string, title: string): Promise<string | null> => {
  return new Promise(resolve => {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const req = https.get(url, { headers: { 'User-Agent': CHROME_UA, 'Accept': 'application/json' } }, (res: IncomingMessage) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as { lyrics?: string; error?: string };
          resolve(json.lyrics?.trim() || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
});

// ── YouTube search IPC ────────────────────────────────────────────────────────

ipcMain.handle('search-youtube', (_event, query: string): Promise<Track[]> => {
  return searchYouTube(query);
});

function searchYouTube(query: string): Promise<Track[]> {
  return new Promise((resolve, reject) => {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    const req = https.get(url, { headers: buildSearchHeaders() }, (res: IncomingMessage) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location;
        if (!location) { reject(new Error('Redirect with no location')); return; }
        https.get(location, (r2: IncomingMessage) => collectHtml(r2, resolve, reject));
        return;
      }
      collectHtml(res, resolve, reject);
    });

    req.on('error', reject);
    req.setTimeout(12_000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function buildSearchHeaders(): Record<string, string> {
  return {
    'User-Agent':      CHROME_UA,
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'identity',
  };
}

function collectHtml(
  res: IncomingMessage,
  resolve: (v: Track[]) => void,
  reject:  (e: Error)   => void,
): void {
  let html = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => { html += chunk; });
  res.on('end', () => {
    try { resolve(parseResults(html)); }
    catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
  });
}

function parseResults(html: string): Track[] {
  const MARKER = 'var ytInitialData = ';
  const start  = html.indexOf(MARKER);
  if (start === -1) throw new Error('YouTube page structure not recognized');

  const jsonStart = start + MARKER.length;
  let depth = 0;
  let end   = jsonStart;

  for (let i = jsonStart; i < html.length; i++) {
    if      (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }

  const data     = JSON.parse(html.substring(jsonStart, end)) as YTData;
  const sections = data?.contents
    ?.twoColumnSearchResultsRenderer
    ?.primaryContents
    ?.sectionListRenderer
    ?.contents ?? [];

  const results: Track[] = [];

  for (const section of sections) {
    for (const item of section?.itemSectionRenderer?.contents ?? []) {
      const v = item?.videoRenderer;
      if (!v?.videoId) continue;

      const thumbs = v.thumbnail?.thumbnails ?? [];
      let   thumb  = thumbs[thumbs.length - 1]?.url ?? thumbs[0]?.url ?? '';
      if (thumb.startsWith('//')) thumb = 'https:' + thumb;

      results.push({
        id:        v.videoId,
        title:     v.title?.runs?.map(r => r.text).join('') ?? 'Unknown',
        thumbnail: thumb,
        duration:  v.lengthText?.simpleText ?? 'LIVE',
        channel:   v.ownerText?.runs?.[0]?.text ?? 'Unknown Channel',
        views:     v.shortViewCountText?.simpleText ?? v.viewCountText?.simpleText ?? '',
        published: v.publishedTimeText?.simpleText ?? '',
      });

      if (results.length >= 20) break;
    }
    if (results.length >= 20) break;
  }

  return results;
}
