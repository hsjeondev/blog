# Notion 웹훅 연결

수신 주소: `https://blog.jeonhongshik.com/api/notion/webhook`

## Vercel 준비

blog 프로젝트의 Production 환경에 아래 값을 설정하고 재배포합니다.

| 환경변수 | 값 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mjauqslbtcjmlvlfxoga.supabase.co` |
| `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버 전용 Secret key 또는 legacy service_role 키 |
| `NOTION_TOKEN` | 기존 공식 통합 토큰 |
| `NOTION_MYBOOKLIST_ID` | 기존 My Book list DB ID |

Supabase 서버 키와 Notion 토큰은 Secret 유형으로 저장합니다. 관리용 `SUPABASE_ACCESS_TOKEN`을 Vercel에 넣지 않습니다.
수신 주소를 브라우저로 열면 비밀값 없이 `databaseConfigured`, `signatureConfigured`를 확인할 수 있습니다.
이 상태는 변수 설정 여부이며 실제 키의 유효성을 대신 검사하지는 않습니다.
`missing`과 `invalid`에는 문제가 있는 변수 이름만 표시됩니다. 값은 반환하지 않습니다.
변수가 설정되어 있는데도 실패하면 수신 주소에 `?check=database`를 붙여 서버 키로 읽기 전용 DB 접속을 확인할 수 있습니다.
`databaseConnection.connected`가 false인 경우 HTTP 상태와 오류 코드만 반환합니다. 비밀 키와 원문 오류는 반환하지 않습니다.

## Notion 구독 생성과 확인

1. [Notion 연결 설정](https://app.notion.com/developers/connections)에서 **Notion Book List API → Webhooks → Create a subscription**을 엽니다.
2. 수신 주소를 등록하고 다음 9개 이벤트를 구독합니다.
   - `page.created`, `page.content_updated`, `page.properties_updated`
   - `page.deleted`, `page.undeleted`, `page.moved`
   - `comment.created`, `comment.updated`, `comment.deleted`
3. 구독 생성 시 Notion이 확인 토큰을 보냅니다. Supabase Table Editor의 **`blog_webhook_verifications`**에서 방금 생성된 행의 `verification_token`을 복사합니다. 이 테이블은 관리자만 볼 수 있습니다.
4. Notion의 **Verify**에 해당 값을 붙여 넣어 확인을 완료합니다.
5. 같은 값을 Vercel의 **`NOTION_WEBHOOK_VERIFICATION_TOKEN`**에 Secret으로 등록하고 재배포합니다.
6. 수신 주소의 두 설정 상태가 모두 `true`인지 확인합니다. 이후 Notion 변경은 서명을 검증한 뒤 처리됩니다.

확인 토큰은 응답·로그·GitHub·채팅에 출력하지 않습니다. 확인 요청만으로 서명 키를 자동 등록하지 않으며, Vercel에 직접 등록된 토큰만 신뢰합니다.
Notion 구독을 다시 만들면 토큰도 바뀝니다. 이 경우 기존 환경변수 값을 잠시 제거해 재배포한 뒤 새 구독을 확인하고 새 토큰을 등록합니다.
설정이 끝나면 Supabase에 남은 확인 토큰 행을 관리 화면에서 삭제할 수 있습니다.
선택 환경변수 `NOTION_WEBHOOK_SUBSCRIPTION_ID`에 구독 UUID를 넣으면 해당 구독만 허용합니다.

## 동작과 검증

- 원문 요청의 HMAC-SHA256 서명을 비교합니다. JSON을 다시 직렬화해 서명 검증에 사용하지 않습니다.
- 이벤트는 원본·작성자 없이 ID·유형·페이지 ID·시각만 `blog_sync_events`에 저장합니다. 같은 이벤트 ID는 한 번만 처리합니다.
- 이벤트 내용에 이전 공개 상태가 담겨 있어도 현재 Notion API 상태를 다시 읽습니다. 공개 글은 해당 본문과 이미지·첨부파일을 준비한 뒤 원자적으로 갱신하며, 비공개·삭제·이동된 글은 소프트 삭제합니다.
- 단독 404로 삭제를 판단하지 않습니다. 정상 조회한 전체 공개 목록에서도 해당 페이지가 빠졌는지 함께 확인합니다. DB 목록 조회가 실패하면 기존 글은 삭제하지 않습니다.
- 댓글 이벤트는 본문을 다시 읽지 않고 연결만 갱신합니다. 원본 본문 수정 시각이 DB와 다르면 본문 재수집을 먼저 예약합니다. 블록 댓글과 속성 댓글은 연결 대상에서 제외합니다.
- 공개된 책 구성이 바뀌면 댓글 연결을 다시 확인하므로, 비공개였던 대상 책을 공개한 경우도 기존 댓글 연결을 복원합니다. 이때도 전체 본문을 읽지 않습니다.
- 비공개 글의 제목을 저장한 다른 본문은 재수집 전까지 숨깁니다. 누락된 새 공개 글과 해당 본문은 내부 작업으로 추가 수집합니다.
- 한 DB당 작업자 하나만 처리하며 만료된 작업은 다음 수신에서 회수합니다. 작업자 식별자를 확인해 중단된 이전 작업이 나중에 결과를 덮어쓰지 못하게 합니다.
- 한 요청은 최대 5개 작업, 약 45초까지 처리합니다. 작업이 남거나 실패하면 503을 반환하여 Notion 재전송으로 이어서 처리합니다. 완료된 이벤트 재전송은 Notion을 다시 읽지 않습니다.
- Notion은 보통 1분 이내, 최대 수분 단위로 이벤트를 모아 보낼 수 있습니다. 수신 실패 시 최대 8회, 약 24시간까지 재전송합니다. DB에 반영된 다음 블로그 요청부터 변경된 내용이 보입니다. 방문자 요청은 Notion을 호출하지 않습니다.

Notion에서 공개 체크를 해제한 뒤 `blog_posts.deleted_at`과 `is_published`, `blog_sync_events.status`를 확인합니다.
재공개하면 동일 ID의 `deleted_at`이 비워지고 본문이 갱신되어야 합니다. 실제 운영 글의 공개 상태를 바꾸는 검사는 사용자가 수행합니다.

## 수동 재시도

`blog_sync_events`의 `failed`, `last_error`, `attempts`를 확인합니다. Notion 재전송이 끝났거나 원인을 해결한 뒤 수동 복구하려면 **POST `/api/notion/retry`**를 호출합니다.
Authorization은 `Bearer <CRON_SECRET>`이며, 별도 `CRON_SECRET`이 없으면 웹훅 확인 토큰을 사용합니다. 비밀값은 명령 이력에 남기지 않도록 관리 환경에서 주입합니다.
호출은 실패 작업의 재시도 횟수와 대기 시간을 초기화한 뒤 같은 작업자를 실행합니다. 한 번에 다 끝나지 않아 503이 반환되면 잠시 후 다시 호출합니다.
처리 실패는 지수 대기로 재시도하고 작업당 12회 이후 자동 처리를 멈추되 기록은 보존합니다. 중단된 실패 하나가 이후 새 이벤트 처리를 막지는 않습니다.

이 구현은 설정 완료 뒤 Notion의 재전송과 새 수신으로 작업을 이어갑니다. 별도 상시 실행 작업자나 분 단위 Cron을 요구하지 않습니다.
서명 없는 요청은 작업을 등록하지 않으며, 비밀 키나 서명 키가 없으면 실패로 응답합니다.
