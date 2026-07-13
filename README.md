# 자료공유 (easyshare)

파일·텍스트를 드래그앤드롭으로 빠르게 공유하는 정적 웹앱입니다.
GitHub Pages(정적 호스팅) + Supabase(DB·스토리지·Edge Function)로 동작합니다.

## 기능

- **통합 작성기**: 글과 파일을 한 게시물에 함께 공유 (드래그앤드롭·붙여넣기·카메라)
- 게시물 = 제목 + 본문(마크다운, 선택) + 첨부 파일 0~N개 (`files` jsonb 컬럼)
- 목록: 필터 칩(전체/파일/텍스트/이미지), 검색·정렬, 펼치기/접기, 리스트/아이콘 보기
- 항목 액션: 대표 버튼(열기/복사) + ⋯ 메뉴(수정·다운로드·링크·QR·공유·삭제)
- 다중 선택(호버 체크박스, 모바일 길게 누르기)으로 합치기·일괄 삭제
- 합치기: 텍스트·파일·혼합 게시물 모두 하나로 병합, 유사 제목 항목 자동 제안
- 만료 시간 설정(1시간/24시간/7일), 만료 자료 자동 정리(매시 정각)
- 게시물별 공유 링크(`?share=<id>`)와 QR 코드
- 관리자 대시보드(`admin.html`): 업로드·접속 현황·사용자 분석, 서버측 API 경유
- PWA(오프라인 캐시), 다크모드

## 구성 파일

| 파일 | 역할 |
|---|---|
| `index.html` / `app.js` / `style.css` | 메인 앱 |
| `shared.js` | 공용 유틸 (앱·관리자 페이지 공용) |
| `admin.html` | 관리자 대시보드 (admin-api Edge Function 사용) |
| `config.js` | Supabase 접속 정보 (`config.example.js` 참고, git 미포함) |
| `supabase.sql` | DB 스키마·RLS 정책 (신규 설치 시 실행) |
| `sw.js` / `manifest.json` | PWA 서비스워커·매니페스트 |

## 설치

1. Supabase 프로젝트 생성 후 `supabase.sql`을 SQL Editor에서 실행
2. Storage에 공개 버킷 `shared-files` 생성
3. **Authentication 설정 (Confirm email 사용)**
   - Sign In / Up 에서 "Confirm email" **켜기** (기본값): 회원가입 시
     인증 메일의 링크를 눌러야 로그인할 수 있습니다.
   - URL Configuration 에서 **Site URL**을 배포 주소로 설정하고,
     **Redirect URLs**에 배포 주소(예: `https://<계정>.github.io/easyshare/index.html`)를
     추가해야 인증 링크 클릭 후 앱으로 돌아와 자동 로그인됩니다.
   - 기본 내장 메일 서버는 시간당 발송량 제한이 매우 작으므로, 사용자가
     많다면 Custom SMTP(Authentication → Emails) 연결을 권장합니다.
4. Edge Function 2개 배포: `admin-api`, `cleanup-expired` (이 저장소는 MCP/CLI로 이미 배포됨)
5. `config.example.js`를 `config.js`로 복사하고 URL·anon key 입력
6. GitHub Pages 배포는 `.github/workflows/deploy.yml`이 처리
   (저장소 Secrets에 `SUPABASE_URL`, `SUPABASE_KEY` 등록)

## 보안 모델

- **인증**: Supabase Auth 이메일+비밀번호 계정 (가입 시 이메일 인증 필수).
  세션은 supabase-js가 자동 저장·갱신하며, 어느 기기에서든 같은 계정으로
  로그인하면 내 자료를 관리할 수 있습니다.
- **읽기**: `shares`는 공개 읽기(목록·공유 링크 조회에 사용).
- **쓰기**: RLS가 `auth.uid() = user_id`일 때만 게시물 작성·수정·삭제를
  허용합니다. 서버가 검증한 사용자 ID 기준이라 이메일 사칭이 불가능합니다.
- **레거시 연결**: 계정 도입 전 자료는 로그인 시 `claim_my_shares()` RPC가
  `owner_email`이 일치하는 행을 자동으로 내 계정(user_id)에 연결합니다.
- **스토리지**: 파일 읽기는 공개, 업로드·삭제는 로그인 사용자만 가능합니다.
- **visits(접속 로그)**: 로그인 사용자만 기록(insert) 가능. 조회·삭제는 서비스
  롤을 가진 `admin-api` Edge Function만 가능해 이메일 목록이 노출되지 않습니다.
- **관리자 인증**: `admin.html` 로그인 시 입력한 관리자 키의 SHA-256이
  `app_config.admin_key_sha256`(서비스 롤 전용 테이블)과 일치해야 합니다.

### 관리자 키 변경

원하는 키의 SHA-256(hex, 소문자)을 계산해 SQL Editor에서 실행:

```sql
insert into app_config (key, value) values ('admin_key_sha256', '<sha256-hex>')
  on conflict (key) do update set value = excluded.value;
```

## 자동 정리

`pg_cron` + `pg_net`이 매시 정각 `cleanup-expired` 함수를 호출해:

- 만료된 게시물의 DB 행과 스토리지 파일 삭제
- 90일 지난 접속 로그(visits) 삭제

수동 실행: 관리자 페이지의 "만료 항목 삭제" 버튼.
