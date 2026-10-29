# My Book List 연결 — 현재 구현

기존 디자인을 유지하면서 `My Book list` 데이터베이스의 **공개 체크된 기록만** 읽습니다.
Notion 페이지를 웹에 게시할 필요는 없습니다. 서버가 공식 Notion API로 DB와 본문 블록을 읽습니다.

## 필요한 설정

`.env.example`을 참고해 로컬 `.env.local` 또는 Vercel 프로젝트의 환경변수에 등록합니다.
이 개발 환경의 비밀값은 Vercel에 자동 전달되지 않습니다. Vercel 설정에도 같은 값을 등록해야 합니다.

| 변수 | 용도 |
| --- | --- |
| `NOTION_TOKEN` | 읽기 권한을 가진 공식 Notion 통합 토큰. 이전 변수 `NOTION_API_KEY`도 지원하며 둘 다 있으면 해당 값을 우선합니다. |
| `NOTION_MYBOOKLIST_ID` | 보기 ID가 아닌 실제 데이터베이스 ID |
| `NEXT_PUBLIC_URL` | `https://blog.jeonhongshik.com` |

이 구현에서 `NOTION_TOKEN`은 공식 통합 토큰입니다. 아래 원본 참고 문서의 `token_v2` 로그인 쿠키를 넣지 않습니다.
통합에 DB 콘텐츠 접근 권한을 부여하세요. 댓글을 사용할 때만 별도의 댓글 권한이 필요합니다.

| DB 속성 | 형식 | 용도 |
| --- | --- | --- |
| 책제목 | 제목 | 카드와 상세 제목 |
| 저자 | 텍스트 | 책 저자 메타데이터 |
| 분류 | 선택 | 카테고리 |
| 공개 | 체크박스 | 체크한 기록만 게시, 없음/체크 해제는 비공개 |
| 진행상태 | 선택 | 기존 Done/ing/yet 유지. 공개 여부와 독립적 |

작성일 속성이 없어도 생성 시각을 사용합니다. 태그·커버·아이콘은 없어도 됩니다.
문서·월말결산 UI는 유지되며, 선택 속성 `유형` 또는 기존 `forest_분류`가 있을 때 해당 분류를 사용합니다.
현재 다섯 속성만 있는 책 DB 항목은 기본 포스팅으로 표시합니다. 새 DB나 추가 속성은 필수가 아닙니다.

## 공개 범위와 갱신

- 목록·상세·임베드·검색·사이트맵·그래프·OG·댓글·음성 API가 같은 공개 조건과 DB 소속을 검사합니다.
- 비공개 글의 ID로 직접 요청해도 404이며, 그 글의 본문은 조회하지 않습니다.
- 비공개 페이지 멘션/링크와 하위 DB·페이지, 외부 원본의 동기화 블록을 따라가서 수집하지 않습니다.
- 원본의 ISR·공개 CDN 캐시·그래프 Blob 스냅샷 대신 요청마다 공개 여부를 검사하고 `no-store`를 사용합니다.
  체크 해제는 다음 서버 요청부터 반영됩니다. 공개 대상이 없으면 빈 목록이 정상입니다.
- 공식 API의 텍스트·목록·체크박스·제목·토글·인용·콜아웃·코드·수식·이미지·파일·표·컬럼 등을 기존 렌더러로 변환합니다.
  지원하지 않는 블록은 안내 문구로 표시합니다.
- 그래프는 공개된 글의 페이지 멘션/링크를 이용합니다. 세션 쿠키는 사용하지 않습니다.
- 본문 검색은 요청당 최대 20개 후보와 20초 예산을 사용하며, 일부만 검색하면 `partial: true`를 반환합니다.
- AI 요약은 후속 단계에서 연결합니다. 현재 상세 페이지는 자동 요약을 생성하지 않습니다.

## 실행과 검증

Node.js 22 이상, Yarn 1.22.22로 확인했습니다. 루트 잠금 파일은 아직 없습니다.
Vercel Install Command도 아래와 같이 지정하면 기존 React peer dependency 설치 충돌을 피할 수 있습니다.

```bash
npx --yes yarn@1.22.22 install --non-interactive --no-lockfile
npm run dev
```

```bash
node --test tests/*.test.cjs
npm run build
npm start
```

개발 클라우드의 Node.js가 제공된 HTTPS 프록시를 사용하도록 할 때는 `NODE_USE_ENV_PROXY=1`을 설정합니다.
테스트의 공개/비공개 전환은 격리된 가짜 Notion 응답으로 검증하며, 실제 기록의 공개 체크를 변경하지 않습니다.

---

# 원본 프로젝트 참고 문서

아래 내용은 fork 원본의 구조·운영 설명입니다. 현재 책 DB 연결과 달라지는 설정은 위 안내를 우선하세요.
원저작자: https://github.com/IceCream0910/blog

Notion을 CMS로 사용하는 개인 블로그입니다. Next.js Pages Router와 ISR로 게시물·문서·월말결산을 제공하고, NotionX 렌더러로 본문을 표시합니다. 별도의 VPS 음성 서버는 Notion webhook을 받아 Fish Audio 기반 TTS를 생성하며, 백링크 데이터는 D3 그래프로 시각화합니다.

## 주요 기능

- Notion 데이터베이스를 원본으로 사용하는 게시물 목록과 상세 페이지
- `fallback: "blocking"`과 10초 ISR을 이용한 신규 문서 자동 노출
- 저장소에 포함된 NotionX 기반 본문, 코드, 수식, 컬렉션 렌더링
- 포스팅·문서·프로젝트·월말결산을 연결하는 Obsidian 스타일 백링크 그래프
- 문서 탐색에 최적화된 `/forest` 2패널 리더와 모바일 전환 UI
- 월말결산 전용 `/recap` 뷰어
- Notion webhook과 VPS worker를 이용한 비동기 TTS 생성
- 문장 타임스탬프 기반 재생, 강조, 이전/다음 문장 이동
- 본문 해시 기반 AI 요약 생성 및 Notion 속성 캐시
- Notion Comments API 기반 댓글
- Vercel OG 기반 소셜 공유 이미지
- 다크 모드와 반응형 레이아웃

## 전체 아키텍처

```mermaid
flowchart LR
    Author["작성자"] --> Notion["Notion CMS"]

    subgraph Vercel["Vercel · Next.js"]
        ISR["Pages Router · ISR"]
        Renderer["로컬 NotionX Renderer"]
        WebAPI["Next.js API Routes"]
        GraphAPI["Graph API"]
        Blob["Private Vercel Blob"]
        Browser["브라우저 UI"]
    end

    subgraph VPS["VPS · blog-audio-server"]
        AudioAPI["FastAPI · Webhook/Manifest"]
        Queue["SQLite Job Queue"]
        Worker["TTS Worker"]
        Manifest["SQLite Manifest"]
        Audio["Content-addressed Opus"]
    end

    Notion -->|"DB query · recordMap"| ISR
    ISR --> Renderer --> Browser
    Browser --> WebAPI
    WebAPI --> Notion

    Notion -->|"page.created · page updated"| AudioAPI
    AudioAPI --> Queue --> Worker
    Worker -->|"최신 block 조회"| Notion
    Worker --> Fish["Fish Audio Timestamp SSE"]
    Fish --> Worker
    Worker --> Manifest
    Worker --> Audio
    Browser -->|"manifest 요청"| WebAPI
    WebAPI --> AudioAPI
    AudioAPI --> Manifest
    Browser -->|"segment별 재생"| Audio

    Cron["Vercel Cron"] --> GraphAPI
    GraphAPI -->|"DB · backlink 수집"| Notion
    GraphAPI --> Blob
    Blob --> GraphAPI --> Browser
```

## 핵심 작동 방식

### 1. Notion 본문과 ISR

```mermaid
sequenceDiagram
    participant U as 사용자
    participant N as Next.js
    participant DB as Notion Database API
    participant P as Notion Page API
    participant R as NotionX Renderer

    U->>N: 페이지 요청
    alt 유효한 ISR 결과가 있음
        N-->>U: 캐시된 HTML 반환
    else 최초 요청 또는 재검증
        N->>DB: 데이터베이스와 경로 조회
        N->>P: pageId의 recordMap 조회
        P-->>N: block · collection · asset 데이터
        N->>R: recordMap 전달
        R-->>N: 본문 렌더링
        N-->>U: 생성된 페이지 반환
    end
    Note over N: 기본 revalidate 10초
    Note over N: 동적 문서는 fallback blocking으로 생성
```

- `/`는 메인 Notion 데이터베이스를 조회해 포스팅 카드를 생성합니다.
- `/[pageId]`는 메인 DB와 forest DB의 문서를 정적 경로로 만들고, 새 문서는 blocking fallback으로 처리합니다.
- 상세 본문은 `notion-client`의 recordMap을 로컬 `packages/notionx` 렌더러에 전달합니다.
- `/forest`와 `/recap`은 `forest_분류` select 값으로 문서 종류를 분리합니다.
- Notion 요청 실패 시 목록 페이지는 빈 데이터와 더 긴 재검증 주기로 폴백합니다.

### 2. TTS 생성과 재생

```mermaid
sequenceDiagram
    participant N as Notion
    participant A as VPS API
    participant Q as SQLite Queue
    participant W as Worker
    participant F as Fish Audio
    participant S as Opus · Manifest Storage
    participant B as Blog Player

    N->>A: 서명된 webhook
    A->>A: HMAC 서명 · event type 검증
    A->>Q: pageId pending 등록
    A-->>N: received
    W->>Q: 가장 오래된 pending job claim
    W->>N: 최신 page · 하위 block 재조회
    W->>W: 읽을 수 있는 block 추출 · content hash 계산
    alt 동일 hash의 음성이 있음
        W->>S: 기존 Opus와 timestamp 재사용
    else 새로운 문장 또는 설정
        W->>F: timestamp SSE TTS 요청
        F-->>W: audio chunk · alignment
        W->>W: chunk offset을 전역 timeline으로 변환
        W->>S: SHA-256 이름의 Opus 저장
    end
    W->>S: page manifest 원자적 교체
    B->>A: page manifest 조회
    A-->>B: block별 audioUrl · segments
    B->>S: 필요한 Opus 로딩
    B->>B: currentTime에 맞춰 문장 강조 및 이동
```

TTS 서버는 API와 worker가 같은 Docker image와 `/data` 볼륨을 공유합니다.

- webhook은 `page.created`, `page.content_updated`, `page.properties_updated`만 큐에 넣습니다.
- webhook payload의 본문을 그대로 음성화하지 않고 worker가 항상 최신 Notion block을 다시 조회합니다.
- `POST /v1/pages/:pageId/sync`의 `202 Accepted`는 큐 등록 성공을 뜻하며 생성 완료를 뜻하지 않습니다.
- 정규화된 텍스트, 음성 reference, 모델, 속도, narrator version으로 content hash를 만듭니다.
- 같은 hash는 문서나 block이 달라도 하나의 Opus asset을 공유합니다.
- 문서 전체 처리가 성공한 경우에만 manifest를 교체하며, 실패하면 이전 manifest를 유지합니다.
- 더 이상 참조되지 않는 Opus asset은 정리합니다.

### 3. 백링크 그래프와 캐시

```mermaid
flowchart TD
    Cron["Vercel Cron · 0 18 * * *"] --> Refresh["GET /api/graph/refresh"]
    Refresh --> Auth{"CRON_SECRET 일치?"}
    Auth -->|"아니요"| Reject["401"]
    Auth -->|"예"| Builder["Graph Builder"]
    Builder --> MainDB["메인 포스팅 DB"]
    Builder --> ForestDB["Forest DB"]
    Builder --> Backlinks["Notion backlink endpoint"]
    MainDB --> Snapshot["노드 · 간선 · 분류 허브"]
    ForestDB --> Snapshot
    Backlinks --> Snapshot
    Snapshot --> Memory["5분 메모리 캐시"]
    Snapshot --> Blob["Private Blob · graph-cache/v3/latest.json"]
    Client["/graph"] --> API["GET /api/graph"]
    API --> Memory
    API --> Blob
    API -->|"MISS"| Builder
    API --> D3["D3 원형 Force Graph"]
```

- 메인 DB의 페이지는 `포스팅`으로 분류합니다.
- forest DB는 `forest_분류` 값에 따라 `프로젝트`, `월말결산(일지)`, `문서`로 분류합니다.
- `/api/graph`는 메모리 → private Blob → 즉시 재생성 순서로 데이터를 찾습니다.
- 같은 런타임에서 동시에 발생한 cache miss는 하나의 graph build Promise를 공유합니다.
- Blob이 없어도 동작하지만 cold start 뒤에는 전체 그래프를 다시 생성하므로 응답이 느릴 수 있습니다.

### 4. AI 요약과 댓글

- 게시물 본문 텍스트의 MD5와 Notion의 `ai_summary` rich text 속성에 저장된 hash를 비교합니다.
- hash가 바뀐 경우에만 OpenAI로 한국어 요약을 생성하고 `[hash] summary` 형식으로 Notion에 저장합니다.
- 댓글 조회와 작성은 `/api/comments/[id]`가 Notion Comments API를 서버 측에서 호출합니다.
- Notion API key와 OpenAI API key는 브라우저 번들에 포함하지 않습니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 웹 프레임워크 | Next.js 16 Pages Router, React 19, TypeScript/JavaScript |
| 렌더링 | ISR, blocking fallback, 로컬 NotionX |
| CMS/API | Notion REST API, Notion page recordMap API |
| UI | Tailwind CSS, CSS, Framer Motion, Ionicons |
| 그래프 | D3 force simulation, Vercel Blob, Vercel Cron |
| 음성 | FastAPI, SQLite, Fish Audio timestamp SSE, Opus |
| 배포 | Vercel, Docker Compose 기반 VPS |
| 부가 기능 | OpenAI 요약, Vercel OG, KaTeX, PrismJS |

## 페이지와 API

### 사용자 페이지

| 경로 | 역할 | 데이터 방식 |
| --- | --- | --- |
| `/` | 포스팅 목록 | Notion DB + ISR |
| `/[pageId]` | 포스팅/문서 상세 | recordMap + ISR + blocking fallback |
| `/forest` | 문서 목록과 리더 | 목록 ISR + 선택 문서 API 로딩 |
| `/recap` | 월말결산 뷰어 | forest DB의 `일지` 분류 + ISR |
| `/graph` | 전체 백링크 그래프 | graph API + D3 |
| `/embed/[pageId]` | 임베드용 문서 | recordMap + ISR |
| `/sitemap.xml` | 동적 사이트맵 | 서버 렌더링 |

### 주요 Next.js API

| 경로 | 메서드 | 역할 |
| --- | --- | --- |
| `/api/forest/[pageId]` | GET | forest 문서 recordMap 조회 |
| `/api/recap/[pageId]` | GET | 월말결산 recordMap과 narration manifest 결합 |
| `/api/narration/[pageId]` | GET | VPS narration manifest 프록시 |
| `/api/backlink` | POST | 특정 pageId의 백링크 조회 |
| `/api/graph` | GET | 캐시된 전체 그래프 반환 |
| `/api/graph/refresh` | GET | 인증된 그래프 snapshot 재생성 |
| `/api/comments/[id]` | GET, POST | Notion 댓글 조회/작성 |
| `/api/search-notion` | POST | Notion 검색 |
| `/api/social-image` | GET | 1200×630 OG 이미지 생성 |

### VPS TTS API

| 경로 | 메서드 | 역할 |
| --- | --- | --- |
| `/health` | GET | 상태 확인 |
| `/webhooks/notion` | POST | Notion webhook 수신과 서명 검증 |
| `/v1/pages/[pageId]/sync` | POST | 관리자 토큰으로 수동 queue 등록 |
| `/v1/pages/[pageId]/manifest` | GET | 문서별 음성 manifest 조회 |
| `/audio/[sha256].opus` | GET | immutable Opus asset 제공 |

## 프로젝트 구조

```text
notion-blog/
├─ components/                 # 공통 UI, Forest, Recap, Graph, TTS player
├─ hooks/                      # 테마, 게시물 metadata, 읽기 시간
├─ packages/notionx/           # 프로젝트에 맞게 포함한 Notion 본문 renderer
├─ pages/
│  ├─ api/                     # Notion, narration, graph, comment API routes
│  ├─ forest/                  # 문서 탐색 화면
│  ├─ graph/                   # 전체 백링크 그래프
│  ├─ recap/                   # 월말결산 화면
│  ├─ [pageId].js              # 게시물/문서 상세 ISR
│  └─ index.js                 # 포스팅 목록 ISR
├─ styles/                     # 전역, Notion, Forest, Recap, Graph 스타일
├─ utils/                      # Notion query, graph build/cache, AI summary
├─ public/                     # 폰트와 정적 asset
├─ blog-audio-server/
│  ├─ app/                     # FastAPI, queue, worker, TTS, alignment
│  ├─ tests/                   # 음성 서버 테스트
│  ├─ docker-compose.yml       # API/worker와 공유 volume
│  └─ sync_all_pages.py        # 기존 모든 문서 수동 queue 등록
└─ vercel.json                 # graph refresh cron
```

## 로컬 실행

### 요구사항

- Next.js 16을 실행할 수 있는 Node.js
- Yarn 1.x
- Notion integration과 대상 데이터베이스 접근 권한
- TTS 서버까지 실행하려면 Docker 및 Docker Compose

### 웹 애플리케이션

```bash
git clone https://github.com/IceCream0910/blog.git
cd blog
yarn install
yarn dev
```

기본 개발 주소는 `http://localhost:3000`입니다.

프로덕션 빌드와 실행:

```bash
yarn build
yarn start
```

### 음성 서버

```bash
cd blog-audio-server
cp .env.example .env
docker compose pull
docker compose up -d
curl http://127.0.0.1:8787/health
```

Windows PowerShell에서는 `cp` 대신 다음 명령을 사용할 수 있습니다.

```powershell
Copy-Item .env.example .env
```

## 환경변수

### Next.js

루트에 `.env.local`을 만들거나 Vercel Project Settings에 등록합니다.

```dotenv
# Notion 공식 API: DB query, 댓글, OG, AI summary cache
NOTION_API_KEY=

# Notion 내부 backlink endpoint용 token_v2 cookie
NOTION_TOKEN=

# 게시물 AI 요약 생성
OPENAI_API_KEY=

# 배포 origin. OG font와 image URL 생성에 사용
NEXT_PUBLIC_URL=http://localhost:3000

# VPS narration API origin
AUDIO_SERVER_URL=https://audio.example.com

# Private Vercel Blob
BLOB_READ_WRITE_TOKEN=
BLOB_STORE_ID=

# /api/graph/refresh 보호 및 Vercel Cron 인증
CRON_SECRET=
```

| 변수 | 필수 범위 | 설명 |
| --- | --- | --- |
| `NOTION_API_KEY` | 기본 기능 | 데이터베이스, 댓글, 속성 갱신, OG API 접근 |
| `NOTION_TOKEN` | 백링크/그래프 | 서버 전용 Notion `token_v2`; 외부 노출 금지 |
| `OPENAI_API_KEY` | AI 요약 | 요약 생성 미사용 시 생략 가능 |
| `NEXT_PUBLIC_URL` | 배포 권장 | OG 이미지와 font의 절대 URL 기준 |
| `AUDIO_SERVER_URL` | TTS | VPS API origin; 미설정 시 narration API는 503 |
| `BLOB_READ_WRITE_TOKEN` | 그래프 캐시 | private graph snapshot 읽기/쓰기 |
| `BLOB_STORE_ID` | Vercel Blob | 연결된 Blob store 식별 정보 |
| `CRON_SECRET` | 그래프 갱신 | refresh API의 Bearer 인증 값 |

### VPS 음성 서버

`blog-audio-server/.env.example`을 복사해 사용합니다.

| 변수 | 설명 |
| --- | --- |
| `FISH_API_KEY` | Fish Audio API 인증 |
| `FISH_REFERENCE_ID` | 사용할 voice reference |
| `FISH_MODEL` | TTS 모델 |
| `NOTION_API_KEY` | page와 block 재조회 |
| `NOTION_WEBHOOK_TOKEN` | Notion webhook HMAC 검증 |
| `NOTION_DATABASE_IDS` | 허용할 DB ID 목록, 쉼표 구분 |
| `PUBLIC_BASE_URL` | manifest의 `audioUrl`에 사용할 외부 HTTPS origin |
| `ADMIN_TOKEN` | 수동 sync API Bearer token |
| `DATA_DIR` | SQLite와 Opus 저장 경로, 기본 `/data` |
| `NARRATOR_VERSION` | 음성 cache key를 수동 무효화하는 version |
| `TTS_SPEED` | 합성 속도 |
| `CORS_ORIGINS` | Opus 접근을 허용할 blog origin 목록 |

## Notion 구성

### 데이터베이스

애플리케이션은 두 개의 Notion 데이터베이스를 사용합니다.

1. 메인 DB: 일반 포스팅
2. Forest DB: `문서`, `프로젝트`, `일지` 분류

현재 DB ID는 `pages/index.js`, `pages/[pageId].js`, `pages/forest/index.js`, `pages/recap/index.js`, `utils/build-graph-data.ts`에 상수로 정의되어 있습니다. 다른 workspace로 이전할 때 이 경로들을 함께 변경해야 합니다.

Forest DB에서 코드가 직접 참조하는 주요 속성:

| 속성 | 타입/용도 |
| --- | --- |
| `이름` | title |
| `forest_분류` | select: `문서`, `프로젝트`, `일지` |
| `forest_날짜` | 월말결산 정렬/월 판정 |
| `music`, `watching`, `reading` | 월말결산용 JSON rich text |

일반 포스팅의 카테고리·태그·작성일은 recordMap 내부 property ID도 참조합니다. Notion 속성을 새로 만들거나 복제하면 ID가 바뀔 수 있으므로 `hooks/usePostMetadata.js`와 게시물 판정 로직을 함께 확인해야 합니다.

### Integration 권한

- 두 데이터베이스와 하위 페이지를 integration에 공유합니다.
- 댓글 작성을 사용하려면 comment 생성 권한이 필요합니다.
- AI 요약을 Notion에 캐시하려면 page property 갱신 권한이 필요합니다.
- VPS integration에도 `NOTION_DATABASE_IDS`에 지정한 모든 데이터베이스 접근 권한을 부여합니다.

## TTS 서버 운영

### Webhook 연결

1. VPS의 `https://audio.example.com`을 `127.0.0.1:8787`로 reverse proxy합니다.
2. `PUBLIC_BASE_URL`을 같은 HTTPS origin으로 설정합니다.
3. Notion webhook endpoint를 `https://audio.example.com/webhooks/notion`으로 지정합니다.
4. 최초 verification payload의 token을 `NOTION_WEBHOOK_TOKEN`에 저장하고 subscription을 확인합니다.
5. `page.created`, `page.content_updated`, `page.properties_updated` 이벤트를 구독합니다.

### 수동 동기화

한 문서:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://audio.example.com/v1/pages/PAGE_ID/sync
```

전체 문서:

```bash
cd blog-audio-server
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python sync_all_pages.py
```

Windows PowerShell에서는 virtual environment를 다음과 같이 활성화합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python sync_all_pages.py
```

전체 동기화 스크립트는 두 데이터베이스를 페이지네이션하고 pageId를 중복 제거한 뒤 sync API에 등록합니다. 반환된 `202` 개수와 실제 생성 완료 개수는 다를 수 있으므로 worker와 manifest를 추가로 확인합니다.

### 상태 확인

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f worker
curl https://audio.example.com/health
curl https://audio.example.com/v1/pages/PAGE_ID/manifest
```

테스트용 Docker image:

```bash
cd blog-audio-server
docker build --target test -t blog-audio-server:test .
```

## 그래프 캐시 운영

1. Vercel 프로젝트에 private Blob store를 연결합니다.
2. `BLOB_READ_WRITE_TOKEN`과 충분히 긴 `CRON_SECRET`을 등록합니다.
3. 배포 후 최초 snapshot을 인증된 refresh 요청으로 생성합니다.

```bash
curl \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://blog.example.com/api/graph/refresh
```

`vercel.json`은 매일 `0 18 * * *`에 refresh endpoint를 호출합니다. 정상 응답에는 생성 시각과 node/link 수가 포함됩니다.

확인할 응답 헤더:

```text
X-Graph-Cache: HIT   # memory 또는 Blob snapshot 사용
X-Graph-Cache: MISS  # 요청 중 새 snapshot 생성
```

## 배포

### Forest 폴더와 검색 Agent

Forest DB의 `forest_폴더` 텍스트 속성(API 타입: `rich_text`)에 `프로젝트/KLAS+/iOS`처럼 `/`로 구분한 경로를 지정합니다. 경로의 앞뒤 공백과 빈 구간은 정리하며, 빈 값은 최상위 문서로 표시됩니다. 이전 select 형식도 읽을 수 있습니다. 폴더는 이름순, 폴더 안 문서는 선택한 정렬순으로 표시하며 펼침 상태는 현재 브라우저 세션에 저장합니다.

전역 검색과 Forest의 문서 검색은 `/api/search?q=검색어&type=document`를 공유합니다. `type`은 `all`, `document`, `post`, `project`, `recap`이고 선택적으로 `folder`를 지정합니다. 본문 검색 장애 시 `partial: true`와 제목 검색 결과를 반환합니다. 현재 달의 월말결산은 기존 `/recap`과 동일하게 검색에서 제외합니다.

AI 검색은 `OPENAI_API_KEY`와 `SEARCH_AGENT_IP_SALT`만으로 Vercel Node.js Function에서 동작합니다. 클라이언트에 키를 전달하지 않습니다.

| 변수 | 용도 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `SEARCH_AGENT_MODEL` | 선택. 기본 `gpt-5.6-terra`, Responses API와 function calling을 지원하는 모델 ID |
| `UPSTASH_REDIS_REST_URL` | 선택. 공유 사용량 제한·캐시용 Redis REST 주소. 토큰과 함께 설정 |
| `UPSTASH_REDIS_REST_TOKEN` | 선택. 해당 Redis REST 토큰. 주소와 함께 설정 |
| `SEARCH_AGENT_IP_SALT` | IP를 HMAC 처리할 충분히 긴 무작위 서버 비밀값 |

필수 설정 누락, Redis 설정 일부 누락, 또는 설정된 Redis의 장애 시 AI endpoint는 유료 호출 전에 503을 반환합니다. 누락된 변수 이름만 서버 로그에 남깁니다. Redis 변수를 모두 생략하면 인스턴스 메모리로 사용량 제한과 캐시를 처리합니다. Vercel 인스턴스 재시작·확장 시 카운터와 캐시가 공유되거나 보존되지 않으므로, 이 모드의 시간당 100회는 사이트 전체의 엄격한 비용 상한이 아닙니다. 사이트 전체의 원자적 한도가 필요하면 Redis 주소·토큰을 함께 설정하세요. 일반 검색에는 AI 설정이 필요하지 않습니다. Vercel에서는 플랫폼이 덮어쓰는 `x-vercel-forwarded-for`, 다른 서버에서는 socket peer 주소를 사용합니다. 다른 reverse proxy 아래에서는 같은 peer가 한도를 공유하므로 배포 환경에 맞는 신뢰 경계를 별도로 설정해야 합니다.

AI는 버튼 또는 ⌘/Ctrl+Enter로만 실행합니다. 질문·검색어는 최대 300자, IP별 시간당 15회, 전체 시간당 100회(캐시 조회 포함)입니다. Redis 모드의 사용량 예약은 Lua로 원자적으로 처리합니다. 메모리 모드에서는 인스턴스별로 동기 예약하며, IP 카운터는 현재 시간대만 유지합니다. 도구 호출 최대 8회, 공개 문서 읽기 최대 5개, 문서당 12,000자, 계획 응답당 600토큰, 최종 답변 1,400토큰, 기본 GPT-5.6 모델은 지연과 제한된 토큰 예산을 고려해 reasoning effort `none`, 전체 50초 제한을 둡니다. 중지는 모델 요청도 취소합니다.

질문·범위·폴더·모델·문서 수정 시각으로 구분한 답변 캐시는 선택된 저장소에 10분간 저장합니다. 메모리 답변 캐시는 최대 100개, 답변당 최대 64KiB로 제한하고 만료 및 LRU 퇴출을 적용합니다. 시간당 전체 요청 한도로 캐시 증가량도 제한합니다. IP 원문은 저장하지 않으며 사용량 키는 2시간 후 삭제됩니다. 검색 목록 캐시는 서버 메모리에서 60초 유지합니다. AI 출처 링크는 실제 읽기에 성공한 공개 목록의 문서에서만 구성합니다. 질문과 선택한 문서 본문은 OpenAI로 전송되며 `store: false`로 요청합니다.

AI 답변은 제목 3단계, 문단, 평면 목록, 강조, 인라인/블록 코드, 인용문만 렌더링합니다. HTML·이미지·임의 Markdown 링크는 실행하거나 링크로 만들지 않습니다. `[n]` 출처는 서버가 확인한 문서 목록에 있을 때만 링크로 연결합니다. 생성 중 표시하는 진행 과정은 검색 준비와 실제 도구 실행 상태이며 모델의 비공개 사고 원문이 아닙니다. 도구 이름·시작/완료·검색 결과 수·읽은 공개 문서 제목만 표시하고 본문이나 전체 도구 출력을 진행 로그에 복제하지 않습니다.

일반 답변·근거 부족 안내·캐시 답변 모두 최대 24개 Unicode 코드 포인트의 NDJSON chunk로 전달합니다. 브라우저는 네트워크에서 합쳐진 chunk도 다시 나눠 약 40ms 간격으로 표시하며, 완료 상태는 화면의 대기 chunk가 소진된 뒤로 미룹니다. 중지·검색어 변경·검색 닫기는 전송과 화면 대기열을 함께 취소합니다. 새 단어만 블러/slide-up을 적용하고 모션 감소 설정에서는 일반 텍스트로 표시합니다.

검증: `node --test tests/search.test.cjs tests/answer-rendering.test.cjs`, `npx tsc --noEmit`, `yarn build`. 테스트의 Notion/OpenAI/Redis 호출은 가짜 응답으로 격리되며 비용이 발생하지 않습니다.

salt는 `openssl rand -hex 32`로 생성한 값을 `SEARCH_AGENT_IP_SALT`에 등록합니다. Vercel의 Production/Preview 중 사용할 환경에 필수 변수를 등록하고 새 배포를 생성해야 실행 중인 Function에 적용됩니다. Redis 없이 사용할 때는 Redis 변수 둘 다 생략합니다.

### Vercel

1. GitHub 저장소를 Vercel 프로젝트에 연결합니다.
2. Next.js 환경변수를 Production, Preview, Development 범위에 맞게 등록합니다.
3. private Blob store와 Cron 설정을 확인합니다.
4. `yarn build`가 성공하는지 확인하고 배포합니다.
5. `/`, `/forest`, `/recap`, `/graph`, 임의의 `/[pageId]`를 확인합니다.

### VPS

1. Docker와 reverse proxy를 준비합니다.
2. `blog-audio-server/.env`를 서버에서만 관리합니다.
3. API와 worker가 같은 Docker volume을 사용하도록 실행합니다.
4. `/health`, worker log, manifest, Opus Range 요청을 확인합니다.
5. 이미지나 환경변수를 변경했다면 API와 worker를 모두 재생성합니다.
