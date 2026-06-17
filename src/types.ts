// ── Shared domain types ──────────────────────────────────────────────────────

export interface Track {
  id:        string;
  title:     string;
  thumbnail: string;
  duration:  string;
  channel:   string;
  views:     string;
  published?: string;
}

export interface BookmarkGroup {
  id:     string;
  name:   string;
  tracks: Track[];
}

export interface BookmarkData {
  groups: BookmarkGroup[];
}

// ── Electron context-bridge API (exposed via preload) ────────────────────────

export interface CookieImportResult {
  success: boolean;
  count:   number;
  error?:  string;
}

export interface ElectronAPI {
  search:               (query: string)                        => Promise<Track[]>;
  importChromeCookies:  ()                                     => Promise<CookieImportResult>;
  fetchLyrics:          (artist: string, title: string)        => Promise<string | null>;
  minimize:             ()                                     => void;
  maximize:             ()                                     => void;
  close:                ()                                     => void;
}

// ── YouTube internal response shapes (partial) ───────────────────────────────

export interface YTRun    { text: string }
export interface YTThumb  { url:  string }

export interface YTVideoRenderer {
  videoId?:           string;
  title?:             { runs?: YTRun[]   };
  thumbnail?:         { thumbnails?: YTThumb[] };
  lengthText?:        { simpleText?: string };
  ownerText?:         { runs?: YTRun[]   };
  viewCountText?:     { simpleText?: string };
  shortViewCountText?:{ simpleText?: string };
  publishedTimeText?: { simpleText?: string };
}

export interface YTSectionContent { videoRenderer?: YTVideoRenderer }

export interface YTSection {
  itemSectionRenderer?: { contents?: YTSectionContent[] };
}

export interface YTData {
  contents?: {
    twoColumnSearchResultsRenderer?: {
      primaryContents?: {
        sectionListRenderer?: { contents?: YTSection[] };
      };
    };
  };
}
