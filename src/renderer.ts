// renderer.ts — no import/export → TypeScript "script" mode → plain JS output
// DOM types come from tsconfig lib:["DOM"], no CommonJS wrapper generated.

// ── Inline types (mirrored from types.ts, kept local to avoid module imports) ─

interface Track {
  id:        string;
  title:     string;
  thumbnail: string;
  duration:  string;
  channel:   string;
  views:     string;
  published?: string;
}

interface BookmarkGroup { id: string; name: string; tracks: Track[] }
interface BookmarkData  { groups: BookmarkGroup[] }

interface CookieImportResult { success: boolean; count: number; error?: string }

interface ElectronAPI {
  search:               (query: string) => Promise<Track[]>;
  importChromeCookies:  ()              => Promise<CookieImportResult>;
  minimize:             ()              => void;
  maximize:             ()              => void;
  close:                ()              => void;
}

// Electron webview element (not in standard DOM types)
interface WebviewElement extends HTMLElement {
  src: string;
  insertCSS(css: string):                Promise<string>;
  executeJavaScript<T = unknown>(code: string): Promise<T>;
}

// Augment global Window with context-bridge API
interface Window { api: ElectronAPI }

// ── Strict element query helper ───────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} not found`);
  return e as T;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const ytPlayer     = el<WebviewElement>('yt-player');
const placeholder  = el<HTMLElement>('placeholder');
const npTitle      = el<HTMLElement>('np-title');
const npChannel    = el<HTMLElement>('np-channel');
const npDuration   = el<HTMLElement>('np-duration');
const resultsList  = el<HTMLElement>('results-list');
const searchInput  = el<HTMLInputElement>('search-input');
const searchBtn    = el<HTMLButtonElement>('search-btn');
const resultCount  = el<HTMLElement>('result-count');
const btnLogin     = el<HTMLButtonElement>('btn-login');
const playerPanel  = el<HTMLElement>('player-panel');
const resizeHandle = el<HTMLElement>('resize-handle');
const bmPopupEl    = el<HTMLElement>('bm-popup');
const ctrlPlay     = el<HTMLButtonElement>('ctrl-play');

// ── Window controls ───────────────────────────────────────────────────────────

el<HTMLButtonElement>('btn-min').addEventListener('click',   () => window.api.minimize());
el<HTMLButtonElement>('btn-max').addEventListener('click',   () => window.api.maximize());
el<HTMLButtonElement>('btn-close').addEventListener('click', () => window.api.close());

// ── State ─────────────────────────────────────────────────────────────────────

let searchResults:  Track[]        = [];
let currentId:      string | null  = null;
let currentIndex:   number         = -1;
let activeBmTrack:  Track | null   = null;
let currentBmGroup: string | null  = null;
let playStateSync:  ReturnType<typeof setInterval> | null = null;

// ── YouTube CSS injection ─────────────────────────────────────────────────────
// Hides YouTube chrome (header/sidebar/comments) inside the webview.

const YT_HIDE_CSS = `
  ytd-masthead,#masthead-container,
  #secondary,ytd-watch-next-secondary-results-renderer,
  #below,ytd-watch-metadata,ytd-mini-guide-renderer,
  tp-yt-app-drawer,#guide,ytd-rich-metadata-renderer,
  ytd-structured-description-content-renderer,
  ytd-feed-nudge-renderer,ytd-comments,#chips-wrapper{display:none!important}
  html,body{overflow:hidden!important;background:#000!important;margin:0!important}
  ytd-app,#app{background:#000!important}
  #content.ytd-app{margin-top:0!important}
  #player-container,#player-container-inner{
    position:fixed!important;inset:0!important;
    width:100vw!important;height:100vh!important;
    max-width:100%!important;z-index:9999!important;background:#000!important}
  .html5-video-player,#movie_player{width:100%!important;height:100%!important}
`;

ytPlayer.addEventListener('dom-ready', () => {
  ytPlayer.insertCSS(YT_HIDE_CSS).catch(() => undefined);
});

// ── Login: import Chrome/Brave YouTube cookies ────────────────────────────────
// Google blocks OAuth in Electron by design. Instead, we borrow the session
// from Chrome (which the user is already logged into) via macOS Keychain + SQLite.

btnLogin.addEventListener('click', () => { void syncChromeCookies(); });

async function syncChromeCookies(): Promise<void> {
  btnLogin.disabled     = true;
  btnLogin.textContent  = '⟳ SYNCING';

  try {
    const res = await window.api.importChromeCookies();
    if (res.success && res.count > 0) {
      showToast(`✓ ${res.count}개 쿠키 동기화 완료`, 'ok');
      btnLogin.textContent = '✓ SYNCED';
      // Reload current video so it picks up the new authenticated session
      if (currentId) ytPlayer.src = `https://www.youtube.com/watch?v=${currentId}`;
    } else if (res.success && res.count === 0) {
      showToast('유튜브 쿠키를 찾지 못했습니다. Chrome에서 YouTube에 먼저 로그인하세요.', 'warn');
      btnLogin.textContent = '♥ LOGIN';
    } else {
      showToast(res.error ?? '알 수 없는 오류', 'err');
      btnLogin.textContent = '♥ LOGIN';
    }
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'err');
    btnLogin.textContent = '♥ LOGIN';
  } finally {
    btnLogin.disabled = false;
    setTimeout(() => { if (btnLogin.textContent !== '♥ LOGIN') btnLogin.textContent = '♥ LOGIN'; }, 4000);
  }
}

// ── Toast notification ────────────────────────────────────────────────────────
function showToast(msg: string, type: 'ok' | 'warn' | 'err' = 'ok'): void {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ── Resize handle ─────────────────────────────────────────────────────────────

let isResizing = false;
let rsStartX   = 0;
let rsStartW   = 0;

resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
  isResizing = true;
  rsStartX   = e.clientX;
  rsStartW   = playerPanel.offsetWidth;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor     = 'ew-resize';
  document.body.style.userSelect = 'none';
  (ytPlayer as HTMLElement).style.pointerEvents = 'none';
});

document.addEventListener('mousemove', (e: MouseEvent) => {
  if (!isResizing) return;
  const w = Math.max(260, Math.min(window.innerWidth * 0.65, rsStartW + (e.clientX - rsStartX)));
  playerPanel.style.width = `${w}px`;
});

document.addEventListener('mouseup', () => {
  if (!isResizing) return;
  isResizing = false;
  resizeHandle.classList.remove('dragging');
  document.body.style.cursor     = '';
  document.body.style.userSelect = '';
  (ytPlayer as HTMLElement).style.pointerEvents = '';
});

// ── Tabs ──────────────────────────────────────────────────────────────────────

const tabSearch  = el<HTMLButtonElement>('tab-search');
const tabBm      = el<HTMLButtonElement>('tab-bookmarks');
const viewSearch = el<HTMLElement>('view-search');
const viewBm     = el<HTMLElement>('view-bookmarks');

tabSearch.addEventListener('click', () => switchTab('search'));
tabBm.addEventListener('click',     () => switchTab('bookmarks'));

function switchTab(name: 'search' | 'bookmarks'): void {
  const isSearch = name === 'search';
  tabSearch.classList.toggle('active',  isSearch);
  tabBm.classList.toggle('active',     !isSearch);
  viewSearch.classList.toggle('active', isSearch);
  viewBm.classList.toggle('active',    !isSearch);
  resultCount.textContent = isSearch && searchResults.length
    ? `[${searchResults.length} TRACKS]` : '';
  if (!isSearch) renderGroupBar();
}

// ── Search ────────────────────────────────────────────────────────────────────

searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') void doSearch();
});
searchBtn.addEventListener('click', () => void doSearch());

async function doSearch(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) return;

  searchBtn.disabled    = true;
  searchBtn.textContent = '… LOADING';
  resultCount.textContent = '';
  resultsList.innerHTML = `
    <div class="loading-state">
      <p>✦ SEARCHING YOUTUBE<span class="loading-dots"></span></p>
      <p class="dim">${escHtml(query)}</p>
    </div>`;

  try {
    const results   = await window.api.search(query);
    searchResults   = results;
    currentIndex    = -1;
    renderResults(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'UNKNOWN ERROR';
    resultsList.innerHTML = `
      <div class="error-state">
        <p>SEARCH ERROR</p><p>${escHtml(msg)}</p>
        <p class="dim">CHECK YOUR CONNECTION</p>
      </div>`;
    resultCount.textContent = '';
  } finally {
    searchBtn.disabled    = false;
    searchBtn.textContent = '♥ SEARCH';
  }
}

// ── Render results ────────────────────────────────────────────────────────────

function renderResults(results: Track[]): void {
  if (!results.length) {
    resultsList.innerHTML = `
      <div class="empty-state">
        <p>NO RESULTS FOUND</p><p class="dim">TRY DIFFERENT KEYWORDS</p>
      </div>`;
    resultCount.textContent = '';
    return;
  }

  resultCount.textContent = `[${results.length} TRACKS]`;
  resultsList.innerHTML   = results.map((r, i) => {
    const bm = isBookmarked(r.id);
    return `
    <div class="result-item${r.id === currentId ? ' is-playing' : ''}" data-index="${i}">
      <img class="result-thumb" src="${escHtml(r.thumbnail)}" alt="" loading="lazy"
           onerror="this.classList.add('hidden')">
      <div class="result-info">
        <div class="result-title">${escHtml(r.title)}</div>
        <div class="result-meta">
          <span>${escHtml(r.channel)}</span>
          <span class="result-dur">⏱ ${escHtml(r.duration)}</span>
          ${r.views ? `<span>${escHtml(r.views)}</span>` : ''}
        </div>
      </div>
      <button class="bm-btn${bm ? ' active' : ''}" data-bm-index="${i}"
              title="${bm ? 'Bookmarked ♥' : 'Add bookmark'}">♥</button>
    </div>`;
  }).join('');
}

resultsList.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;

  const bmBtn = target.closest<HTMLButtonElement>('.bm-btn');
  if (bmBtn) {
    e.stopPropagation();
    const idx = parseInt(bmBtn.dataset['bmIndex'] ?? '', 10);
    if (!isNaN(idx)) showBmPopup(searchResults[idx]!, bmBtn);
    return;
  }

  const item = target.closest<HTMLElement>('.result-item');
  if (!item) return;
  const idx = parseInt(item.dataset['index'] ?? '', 10);
  if (!isNaN(idx)) playTrack(searchResults[idx]!, item, idx);
});

// ── Playback ──────────────────────────────────────────────────────────────────

function playTrack(track: Track, clickedEl: HTMLElement | null, idx: number): void {
  currentId    = track.id;
  currentIndex = idx >= 0 ? idx : searchResults.findIndex(r => r.id === track.id);

  ytPlayer.src              = `https://www.youtube.com/watch?v=${track.id}`;
  placeholder.style.display = 'none';

  npTitle.textContent    = track.title;
  npChannel.textContent  = track.channel;
  npDuration.textContent = track.duration;
  ctrlPlay.textContent   = '⏸';

  document.querySelectorAll<HTMLElement>('.result-item').forEach(el => el.classList.remove('is-playing'));
  if (clickedEl) {
    clickedEl.classList.add('is-playing');
  } else {
    const el = resultsList.querySelector<HTMLElement>(`[data-index="${currentIndex}"]`);
    el?.classList.add('is-playing');
    el?.scrollIntoView({ block: 'nearest' });
  }

  renderBookmarkList();
  startPlaySync();
}

function playPrev(): void {
  if (!searchResults.length) return;
  const idx = currentIndex > 0 ? currentIndex - 1 : searchResults.length - 1;
  playTrack(searchResults[idx]!, null, idx);
}

function playNext(): void {
  if (!searchResults.length) return;
  const idx = currentIndex < searchResults.length - 1 ? currentIndex + 1 : 0;
  playTrack(searchResults[idx]!, null, idx);
}

// ── Controls ──────────────────────────────────────────────────────────────────

el<HTMLButtonElement>('ctrl-prev').addEventListener('click', playPrev);
el<HTMLButtonElement>('ctrl-next').addEventListener('click', playNext);

ctrlPlay.addEventListener('click', () => {
  void ytPlayer.executeJavaScript(`(function(){
    const v=document.querySelector('.html5-main-video');
    if(v) v.paused?v.play():v.pause();
  })()`);
  setTimeout(syncPlayBtn, 300);
});

function startPlaySync(): void {
  if (playStateSync) clearInterval(playStateSync);
  playStateSync = setInterval(syncPlayBtn, 1500);
}

async function syncPlayBtn(): Promise<void> {
  try {
    const paused = await ytPlayer.executeJavaScript<boolean>(
      '(document.querySelector(".html5-main-video")?.paused??true)',
    );
    ctrlPlay.textContent = paused ? '▶' : '⏸';
  } catch { /* webview not ready */ }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (document.activeElement === searchInput) return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      void ytPlayer.executeJavaScript(`(function(){
        const v=document.querySelector('.html5-main-video');
        if(v) v.paused?v.play():v.pause();
      })()`);
      setTimeout(syncPlayBtn, 300);
      break;
    case 'ArrowLeft':  e.preventDefault(); playPrev(); break;
    case 'ArrowRight': e.preventDefault(); playNext(); break;
    case 'ArrowUp':
      e.preventDefault();
      void ytPlayer.executeJavaScript(
        '(function(){const v=document.querySelector(".html5-main-video");if(v)v.volume=Math.min(1,v.volume+0.1)})()',
      );
      break;
    case 'ArrowDown':
      e.preventDefault();
      void ytPlayer.executeJavaScript(
        '(function(){const v=document.querySelector(".html5-main-video");if(v)v.volume=Math.max(0,v.volume-0.1)})()',
      );
      break;
    case 'KeyM':
      void ytPlayer.executeJavaScript(
        '(function(){const v=document.querySelector(".html5-main-video");if(v)v.muted=!v.muted})()',
      );
      break;
  }
});

// ── Bookmark data (localStorage) ──────────────────────────────────────────────

const BM_KEY = 'magical_player_bookmarks';

function loadBm(): BookmarkData {
  try { return JSON.parse(localStorage.getItem(BM_KEY) ?? '{"groups":[]}') as BookmarkData; }
  catch { return { groups: [] }; }
}
function saveBm(data: BookmarkData): void {
  localStorage.setItem(BM_KEY, JSON.stringify(data));
}
function isBookmarked(id: string): boolean {
  return loadBm().groups.some(g => g.tracks.some(t => t.id === id));
}
function addToGroup(groupId: string, track: Track): void {
  const data = loadBm();
  const g    = data.groups.find(g => g.id === groupId);
  if (!g || g.tracks.some(t => t.id === track.id)) return;
  g.tracks.push({ id: track.id, title: track.title, channel: track.channel,
                  duration: track.duration, thumbnail: track.thumbnail, views: track.views });
  saveBm(data);
}
function createGroup(name: string): string {
  const data = loadBm();
  const g: BookmarkGroup = { id: Date.now().toString(), name, tracks: [] };
  data.groups.push(g);
  saveBm(data);
  return g.id;
}
function deleteGroup(groupId: string): void {
  const data = loadBm();
  data.groups = data.groups.filter(g => g.id !== groupId);
  saveBm(data);
}
function renameGroup(groupId: string, name: string): void {
  const data = loadBm();
  const g    = data.groups.find(g => g.id === groupId);
  if (g) { g.name = name; saveBm(data); }
}

// ── Custom dialogs (replaces prompt/confirm — disabled in Electron contextIsolation) ──

function showNameDialog(label: string, defaultValue = ''): Promise<string | null> {
  return new Promise(resolve => {
    const overlay  = el<HTMLElement>('name-dialog');
    const input    = el<HTMLInputElement>('name-dialog-input');
    const labelEl  = el<HTMLElement>('name-dialog-label');
    const okBtn    = el<HTMLButtonElement>('name-dialog-ok');
    const cancelBtn = el<HTMLButtonElement>('name-dialog-cancel');

    labelEl.textContent = label;
    input.value         = defaultValue;
    overlay.classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 60);

    const finish = (value: string | null) => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(value);
    };

    const onOk     = () => { const v = input.value.trim(); if (v) finish(v); };
    const onCancel = () => finish(null);
    const onKey    = (e: KeyboardEvent) => {
      if (e.key === 'Enter')  onOk();
      if (e.key === 'Escape') onCancel();
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

function showConfirmDialog(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const overlay   = el<HTMLElement>('confirm-dialog');
    const msgEl     = el<HTMLElement>('confirm-dialog-msg');
    const okBtn     = el<HTMLButtonElement>('confirm-dialog-ok');
    const cancelBtn = el<HTMLButtonElement>('confirm-dialog-cancel');

    msgEl.textContent = message;
    overlay.classList.remove('hidden');

    const finish = (ok: boolean) => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(ok);
    };

    const onOk     = () => finish(true);
    const onCancel = () => finish(false);

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ── Bookmark popup ────────────────────────────────────────────────────────────

function showBmPopup(track: Track, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  bmPopupEl.style.top  = `${rect.bottom + 5}px`;
  bmPopupEl.style.left = `${Math.max(4, rect.right - 190)}px`;
  activeBmTrack = track;
  renderBmPopupGroups();
  bmPopupEl.classList.remove('hidden');
  requestAnimationFrame(() => document.addEventListener('click', onOutsidePopup));
}

function closeBmPopup(): void {
  bmPopupEl.classList.add('hidden');
  activeBmTrack = null;
  document.removeEventListener('click', onOutsidePopup);
}

function onOutsidePopup(e: Event): void {
  const nd = document.getElementById('name-dialog');
  if (nd && !nd.classList.contains('hidden')) return; // name dialog open
  if (!bmPopupEl.contains(e.target as Node)) closeBmPopup();
}

function renderBmPopupGroups(): void {
  const groups = loadBm().groups;
  el<HTMLElement>('bm-popup-groups').innerHTML = groups.length
    ? groups.map(g => `
        <button class="bm-popup-group-btn" data-popup-group="${escHtml(g.id)}">
          ${escHtml(g.name)}
        </button>`).join('')
    : `<p style="font-size:6px;color:var(--text-d);padding:2px 0">그룹이 없습니다</p>`;
}

el<HTMLElement>('bm-popup-groups').addEventListener('click', (e: Event) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.bm-popup-group-btn');
  if (!btn || !activeBmTrack) return;
  addToGroup(btn.dataset['popupGroup'] ?? '', activeBmTrack);
  closeBmPopup();
  refreshBmButtons();
  showToast('북마크에 추가했습니다 ♥', 'ok');
});

el<HTMLButtonElement>('bm-popup-new').addEventListener('click', async () => {
  const name = await showNameDialog('NEW GROUP NAME :');
  if (!name) return;
  const gId = createGroup(name);
  if (activeBmTrack) addToGroup(gId, activeBmTrack);
  closeBmPopup();
  refreshBmButtons();
  currentBmGroup = gId;
  if (!document.getElementById('view-bookmarks')?.classList.contains('active')) {
    switchTab('bookmarks');
  } else {
    renderGroupBar();
  }
  showToast(`그룹 "${name}" 생성 완료 ✦`, 'ok');
});

function refreshBmButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.bm-btn').forEach(btn => {
    const idx   = parseInt(btn.dataset['bmIndex'] ?? '', 10);
    if (isNaN(idx)) return;
    const track = searchResults[idx];
    if (!track) return;
    const bm = isBookmarked(track.id);
    btn.classList.toggle('active', bm);
    btn.title = bm ? 'Bookmarked ♥' : 'Add bookmark';
  });
}

// ── Group bar ─────────────────────────────────────────────────────────────────

function renderGroupBar(): void {
  const { groups } = loadBm();
  if (!currentBmGroup && groups.length) currentBmGroup = groups[0]!.id;

  el<HTMLElement>('group-bar').innerHTML =
    groups.map(g => `
      <div class="group-tab-wrap">
        <button class="group-tab${g.id === currentBmGroup ? ' active' : ''}"
                data-group-id="${escHtml(g.id)}">
          ${escHtml(g.name)}
        </button>
        <button class="group-icon-btn rename" data-rename-group="${escHtml(g.id)}" title="이름 변경">✎</button>
        <button class="group-icon-btn del"    data-del-group="${escHtml(g.id)}"    title="그룹 삭제">✕</button>
      </div>`).join('') +
    `<button class="group-add-btn" id="group-add-btn">+ 새 그룹</button>`;

  renderBookmarkList();
}

el<HTMLElement>('group-bar').addEventListener('click', async (e: Event) => {
  const target = e.target as HTMLElement;

  // Rename
  const renameBtn = target.closest<HTMLElement>('[data-rename-group]');
  if (renameBtn) {
    e.stopPropagation();
    const gId  = renameBtn.dataset['renameGroup'] ?? '';
    const data = loadBm();
    const g    = data.groups.find(g => g.id === gId);
    if (!g) return;
    const name = await showNameDialog('RENAME GROUP :', g.name);
    if (name) { renameGroup(gId, name); renderGroupBar(); }
    return;
  }

  // Delete
  const delBtn = target.closest<HTMLElement>('[data-del-group]');
  if (delBtn) {
    e.stopPropagation();
    const gId = delBtn.dataset['delGroup'] ?? '';
    const { groups } = loadBm();
    const g = groups.find(g => g.id === gId);
    const ok = await showConfirmDialog(`"${g?.name ?? '이 그룹'}"을 삭제할까요?\n(북마크 ${g?.tracks.length ?? 0}개 포함)`);
    if (!ok) return;
    deleteGroup(gId);
    if (currentBmGroup === gId) currentBmGroup = loadBm().groups[0]?.id ?? null;
    renderGroupBar();
    return;
  }

  // Select group tab
  const tab = target.closest<HTMLElement>('.group-tab');
  if (tab) {
    currentBmGroup = tab.dataset['groupId'] ?? null;
    renderGroupBar();
    return;
  }

  // Add new group
  if (target.id === 'group-add-btn' || (target.closest('#group-add-btn'))) {
    const name = await showNameDialog('NEW GROUP NAME :');
    if (!name) return;
    currentBmGroup = createGroup(name);
    renderGroupBar();
    showToast(`그룹 "${name}" 생성 완료 ✦`, 'ok');
  }
});

// ── Bookmark list ─────────────────────────────────────────────────────────────

function renderBookmarkList(): void {
  const data  = loadBm();
  const group = data.groups.find(g => g.id === currentBmGroup);
  const listEl = el<HTMLElement>('bookmark-list');

  if (!group) {
    listEl.innerHTML = `<div class="empty-state"><p>✦ NO GROUPS YET</p><p class="dim">CLICK + GROUP ABOVE</p></div>`;
    return;
  }
  if (!group.tracks.length) {
    listEl.innerHTML = `<div class="empty-state">
      <p>♥ ${escHtml(group.name)}</p>
      <p class="dim">NO TRACKS YET</p>
      <p class="dim">CLICK ♥ ON A SEARCH RESULT</p>
    </div>`;
    return;
  }

  listEl.innerHTML = group.tracks.map((t, i) => `
    <div class="bm-item${t.id === currentId ? ' is-playing' : ''}" data-bm-idx="${i}">
      <img class="result-thumb" src="${escHtml(t.thumbnail)}" alt=""
           onerror="this.classList.add('hidden')">
      <div class="result-info">
        <div class="result-title">${escHtml(t.title)}</div>
        <div class="result-meta">
          <span>${escHtml(t.channel)}</span>
          <span class="result-dur">⏱ ${escHtml(t.duration)}</span>
        </div>
      </div>
      <div class="bm-item-actions">
        <button class="bm-action-btn" data-bm-play="${i}">▶</button>
        <button class="bm-action-btn del" data-bm-del="${i}">✕</button>
      </div>
    </div>`).join('');
}

el<HTMLElement>('bookmark-list').addEventListener('click', async (e: Event) => {
  const target = e.target as HTMLElement;

  // Play
  const playBtn = target.closest<HTMLElement>('[data-bm-play]');
  if (playBtn) {
    const tracks = loadBm().groups.find(g => g.id === currentBmGroup)?.tracks ?? [];
    const t      = tracks[parseInt(playBtn.dataset['bmPlay'] ?? '', 10)];
    if (t) playTrack(t, null, -1);
    return;
  }

  // Delete from group
  const delBtn = target.closest<HTMLElement>('[data-bm-del]');
  if (delBtn) {
    e.stopPropagation();
    const data = loadBm();
    const g    = data.groups.find(g => g.id === currentBmGroup);
    if (!g) return;
    const idx = parseInt(delBtn.dataset['bmDel'] ?? '', 10);
    const t   = g.tracks[idx];
    const ok  = await showConfirmDialog(`"${t?.title.slice(0, 20) ?? '이 트랙'}..."를\n북마크에서 제거할까요?`);
    if (!ok) return;
    g.tracks.splice(idx, 1);
    saveBm(data);
    refreshBmButtons();
    renderBookmarkList();
    showToast('북마크에서 제거했습니다', 'warn');
    return;
  }

  // Click item → play
  const item = target.closest<HTMLElement>('.bm-item');
  if (item && !target.closest('button')) {
    const tracks = loadBm().groups.find(g => g.id === currentBmGroup)?.tracks ?? [];
    const t      = tracks[parseInt(item.dataset['bmIdx'] ?? '', 10)];
    if (t) playTrack(t, null, -1);
  }
});

// ── 8bit Night Sky ────────────────────────────────────────────────────────────

(function initNightSky(): void {
  const rawCanvas = document.getElementById('sky-canvas') as HTMLCanvasElement | null;
  const rawWrap   = document.getElementById('nightsky')   as HTMLElement       | null;
  if (!rawCanvas || !rawWrap) return;

  // Reassign after null-guard so TypeScript narrows the type inside closures
  const canvas: HTMLCanvasElement = rawCanvas;
  const wrap:   HTMLElement       = rawWrap;

  const ctx = canvas.getContext('2d')!;
  const PX  = 4;

  interface Star          { x: number; y: number; color: string; phase: number; speed: number }
  interface SkyCloud      { x: number; y: number; w: number; h: number; speed: number }
  interface ShootingStar  { x: number; y: number; dx: number; dy: number; len: number; life: number }

  const SKY_BG           = '#05010d';
  const MOON_FILL        = '#fff8c0';
  const MOON_RIM         = '#f1e060';
  const CLOUD_FILL       = '#ffc8e8';
  const CLOUD_EDGE       = '#e090b8';
  const STAR_COLORS      = ['#ffffff', '#ffe4f4', '#f1fa8c'] as const;

  let cols: number, rows: number, frame = 0;
  let stars: Star[]         = [];
  let cloud: SkyCloud | null  = null;
  let shoot: ShootingStar | null = null;

  function resize(): void {
    canvas.width  = Math.floor(wrap!.clientWidth  / PX);
    canvas.height = Math.floor(wrap!.clientHeight / PX);
    cols = canvas.width;
    rows = canvas.height;
    buildScene();
  }

  function buildScene(): void {
    stars = Array.from({ length: Math.floor(cols * rows * 0.025) }, () => ({
      x:     Math.floor(Math.random() * cols),
      y:     Math.floor(Math.random() * (rows - 5)),
      color: STAR_COLORS[Math.floor(Math.random() * 3)] as string,
      phase: Math.random() * Math.PI * 2,
      speed: 0.008 + Math.random() * 0.012,
    }));
    cloud = { x: cols * 0.2, y: Math.floor(rows * 0.6), w: 8, h: 2, speed: 0.015 };
  }

  function pset(x: number, y: number, color: string, alpha = 1): void {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.fillRect(x, y, 1, 1);
    ctx.globalAlpha = 1;
  }

  function drawMoon(): void {
    const mx = cols - 7, my = 2;
    const shape = [[0,1,1,1,0],[1,1,1,1,1],[1,1,1,1,1],[1,1,1,1,1],[0,1,1,1,0]] as const;
    shape.forEach((row, dy) =>
      row.forEach((v, dx) => {
        if (!v) return;
        const edge = dy === 0 || dy === 4 || dx === 0 || dx === 4;
        pset(mx + dx, my + dy, edge ? MOON_RIM : MOON_FILL);
      }),
    );
    [1, 2, 3].forEach(dy => pset(mx + 4, my + dy, SKY_BG));
  }

  function drawStars(): void {
    for (const s of stars) {
      const a = 0.45 + 0.45 * Math.sin(frame * s.speed + s.phase);
      pset(s.x, s.y, s.color, a);
    }
  }

  function drawCloud(): void {
    if (!cloud) return;
    const cx = Math.floor(cloud.x);
    for (let dy = 0; dy < cloud.h; dy++)
      for (let dx = 0; dx < cloud.w; dx++)
        pset(cx + dx, cloud.y + dy, (dy === 0 || dx === 0 || dx === cloud.w - 1) ? CLOUD_EDGE : CLOUD_FILL);
    cloud.x -= cloud.speed;
    if (cloud.x + cloud.w < 0) {
      cloud.x = cols + 1;
      cloud.y = Math.floor(rows * 0.45 + Math.random() * rows * 0.3);
    }
  }

  function maybeShoot(): void {
    if (!shoot && Math.random() < 0.0002) {
      shoot = { x: Math.random() * cols * 0.5 + cols * 0.1,
                y: Math.random() * rows * 0.4, dx: 0.9, dy: 0.4, len: 5, life: 0 };
    }
    if (!shoot) return;
    shoot.life++;
    for (let i = 0; i < shoot.len; i++) {
      const a = (1 - i / shoot.len) * Math.max(0, 1 - shoot.life / 18);
      pset(Math.floor(shoot.x - i * shoot.dx * 0.6),
           Math.floor(shoot.y - i * shoot.dy * 0.6), '#fff', a);
    }
    shoot.x += shoot.dx; shoot.y += shoot.dy;
    if (shoot.life > 18 || shoot.x >= cols || shoot.y >= rows) shoot = null;
  }

  function tick(): void {
    frame++;
    ctx.fillStyle = SKY_BG;
    ctx.fillRect(0, 0, cols, rows);
    drawStars(); drawMoon(); drawCloud(); maybeShoot();
    requestAnimationFrame(tick);
  }

  new ResizeObserver(resize).observe(wrap);
  resize();
  requestAnimationFrame(tick);
})();

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(str: string | undefined | null): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
