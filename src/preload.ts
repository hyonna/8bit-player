import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, Track, CookieImportResult } from './types';

const api: ElectronAPI = {
  search:              (query: string): Promise<Track[]>           => ipcRenderer.invoke('search-youtube', query),
  importChromeCookies: ():              Promise<CookieImportResult> => ipcRenderer.invoke('import-chrome-cookies'),
  fetchLyrics:         (artist: string, title: string): Promise<string | null> => ipcRenderer.invoke('fetch-lyrics', artist, title),
  minimize:            ():              void                        => ipcRenderer.send('window-minimize'),
  maximize:            ():              void                        => ipcRenderer.send('window-maximize'),
  close:               ():              void                        => ipcRenderer.send('window-close'),
};

contextBridge.exposeInMainWorld('api', api);
