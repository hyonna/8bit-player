# 🎮 8BIT MAGICAL PLAYER

> 매번 유튜브에 접속해 음악을 검색하고 재생하는 과정이 번거로워,  
> 내가 듣고 싶은 음악만 빠르게 찾아 로컬 환경에서 편하게 들을 수 있도록 만든 데스크탑 앱

Y2K × 마법소녀 × 파스텔 핑크 컨셉의 8-bit 픽셀아트 디자인 macOS 음악 플레이어.  
YouTube를 검색하고 바로 재생하며, 북마크 그룹으로 내 플레이리스트를 관리합니다.

![Electron](https://img.shields.io/badge/Electron-28-47848F?style=flat&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat&logo=typescript&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220?style=flat&logo=pnpm&logoColor=white)

---

## ✦ 주요 기능

| 기능 | 설명 |
|------|------|
| **YouTube 검색** | API 키 없이 유튜브 검색 결과 최대 20개 표시 |
| **영상 재생** | 클릭 한 번으로 바로 재생 (error 153 우회 처리) |
| **재생 컨트롤** | 재생/일시정지 · 이전/다음 트랙 버튼 |
| **키보드 단축키** | Space · ← → ↑ ↓ · M 키로 완전 제어 |
| **북마크 그룹** | 그룹 생성/이름변경/삭제 및 트랙 관리 |
| **Chrome 세션 연동** | Chrome 쿠키를 앱으로 가져와 YouTube 로그인 유지 |
| **좌측 패널 리사이즈** | 드래그로 플레이어 영역 폭 조절 |
| **8-bit 밤하늘** | Canvas 기반 픽셀아트 별·달·구름·유성 애니메이션 |

---

## 🖥 스크린샷

```
╔══════════════════════════════════════════════════════════╗
║  ✦ 8BIT MAGICAL PLAYER ✦           ♥ LOGIN  ─  □  ✕  ║
╠═══════════════════╦══════════════════════════════════════╣
║ ✦ SEARCH : [________________________] ♥ SEARCH          ║
╠═══════════════════╬══════════════════════════════════════╣
║  ★ NOW PLAYING   ║  ✦ SEARCH         ♥ BOOKMARKS       ║
║  ┌─────────────┐  ║  ┌──────────────────────────────┐   ║
║  │  [YouTube]  │  ║  │ ♥ Song Title           3:45  │   ║
║  │   Player    │  ║  │ ♥ Song Title 2         4:12  │   ║
║  └─────────────┘  ║  │ ★ Now Playing          2:58  │   ║
║  [◀◀]  [▶]  [▶▶] ║  └──────────────────────────────┘   ║
║  TRACK : ...      ║                                      ║
║  CH    : ...      ║                                      ║
║  TIME  : ...      ║                                      ║
║  [★ 8bit sky ★]  ║                                      ║
╚═══════════════════╩══════════════════════════════════════╝
```

---

## 🚀 설치 및 실행

### 요구 사항

- macOS
- Node.js 20+
- pnpm 10+

### 설치

```bash
git clone https://github.com/hyonna/8bit-player.git
cd 8bit-player
pnpm install
```

### 실행

```bash
pnpm start        # TypeScript 빌드 후 앱 실행
```

### 개발 모드

```bash
pnpm dev          # TypeScript watch 모드 (별도 터미널에서 electron . 실행)
```

---

## ⌨️ 키보드 단축키

| 키 | 기능 |
|----|------|
| `Space` | 재생 / 일시정지 |
| `←` / `→` | 이전 / 다음 트랙 |
| `↑` / `↓` | 볼륨 조절 |
| `M` | 음소거 토글 |

---

## ♥ YouTube 로그인 연동

Google은 Electron 환경에서의 OAuth 로그인을 보안상 차단합니다.  
대신 **Chrome에 로그인된 세션을 앱으로 가져오는 방식**을 사용합니다.

1. Chrome에서 YouTube에 로그인
2. 앱 상단 `♥ LOGIN` 버튼 클릭
3. macOS 키체인 접근 허용 팝업 → **허용**
4. 쿠키 동기화 완료

> Chrome, Brave, Arc 브라우저를 자동으로 탐지합니다.

---

## 📁 프로젝트 구조

```
8bit-player/
├── src/                        # TypeScript 소스
│   ├── types.ts                # 공유 타입 정의
│   ├── main.ts                 # Electron 메인 프로세스
│   ├── preload.ts              # Context Bridge (IPC 노출)
│   └── renderer.ts             # UI 로직 (DOM 조작, 재생, 북마크)
├── dist/                       # tsc 컴파일 출력 (자동 생성, git 제외)
├── index.html                  # 앱 레이아웃
├── styles.css                  # 8-bit 테마 스타일
├── tsconfig.json               # TypeScript 설정
└── package.json                # pnpm 스크립트 및 의존성
```

---

## 🏗 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                  Electron App                       │
│                                                     │
│  ┌─────────────┐      IPC       ┌───────────────┐  │
│  │  Main 프로세스 │◄────────────►│ Renderer 프로세스│  │
│  │  (Node.js)  │               │  (Chromium)   │  │
│  │             │               │               │  │
│  │ • YouTube   │  contextBridge│ • UI 렌더링    │  │
│  │   검색/파싱  │◄─ preload.ts ─│ • 검색 요청    │  │
│  │ • Chrome    │               │ • 북마크 관리  │  │
│  │   쿠키 동기화│               │ • 재생 제어    │  │
│  │ • 창 제어    │               │ • Canvas 애니  │  │
│  └─────────────┘               └───────┬───────┘  │
│                                        │           │
│                               ┌────────▼────────┐  │
│                               │  webview 태그    │  │
│                               │  (YouTube 재생)  │  │
│                               │  persist:youtube │  │
│                               │  세션 파티션     │  │
│                               └─────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 핵심 설계 결정

| 결정 | 이유 |
|------|------|
| **YouTube embed → watch URL** | `/embed/` URL은 Electron에서 error 153 발생. `/watch?v=` + CSS 인젝션으로 우회 |
| **webview 태그** | iframe과 달리 별도 렌더러 프로세스로 실행되어 YouTube 감지를 피함 |
| **persist:youtube 파티션** | 로그인 세션이 앱 재시작 후에도 유지됨 |
| **Chrome 쿠키 직접 복호화** | Google이 Electron OAuth를 차단하므로, macOS Keychain + SQLite로 세션 가져옴 |
| **renderer.ts 스크립트 모드** | `import` 없음 → CommonJS 래핑 없는 순수 JS 출력 (브라우저 컨텍스트 필요) |
| **localStorage 북마크** | Electron 앱 재시작 후에도 데이터 유지, IPC 불필요 |

---

## 🔧 기술 스택

| 분류 | 기술 |
|------|------|
| 런타임 | Electron 28 |
| 언어 | TypeScript 5.4 |
| 패키지 매니저 | pnpm 10 |
| UI | Vanilla DOM + Canvas API |
| 폰트 | Press Start 2P (Google Fonts) |
| 데이터 저장 | localStorage (북마크) · persist:youtube session (로그인) |
| YouTube 검색 | Node.js `https` 모듈로 `ytInitialData` HTML 파싱 |
| 쿠키 복호화 | Node.js `crypto` (AES-128-CBC) + macOS `security` CLI + `sqlite3` CLI |

---

## 📝 라이선스

MIT
