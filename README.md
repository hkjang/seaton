<p align="center">
  <img src="docs/favicon.svg" alt="SeatOn Logo" width="90"><br><br>
  <h1 align="center">SeatOn</h1>
</p>

<p align="center">
  <strong>사무실 도면과 직원 정보를 연결하는 오프라인 우선 스마트 좌석 & 공간 관리 플랫폼</strong><br>
  SVG 비율좌표 좌석맵, 오프라인 CV·사내 비전 모델 선택형 도면 판독, 이상 좌석 자동 감지 및 Streamable MCP 지원.
</p>

<p align="center">
  <a href="https://hkjang.github.io/seaton/">🇰🇷 홍보 페이지</a> · <a href="https://hkjang.github.io/seaton/index_en.html">🇺🇸 English Page</a> · <a href="https://github.com/sponsors/hkjang">💖 Sponsor</a>
</p>

---

## 주요 기능

- 일반 직원용 검색 중심 좌석맵과 역할별 관리자 페이지
- PNG/JPG/PDF 도면 버전 관리, 비율 좌표 SVG 편집 기반, PDF도 좌석 오버레이 지원
- 좌석 인식 엔진 선택: 오프라인 CV(기본, 외부 통신 없음) · 사내 비전 모델(VLM) · 두 결과를 교차 검증하는 하이브리드
- 도면별 좌석 격자 보정과 일괄 정렬로 실제 책상 열 간격에 맞춘 스냅
- 직원 CSV/XLSX 가져오기, Drag & Drop 배정, 좌석 변경 이력
- 미배정·퇴직자 점유·조직 영역 불일치·저신뢰 좌석 자동 탐지
- 예외 중심 관리자 작업 큐와 즉시 조치, 운영 준비도 및 연동 상태 대시보드
- 좌석 직접 이동, Shift 다중 선택, 스냅·정렬·회전·Undo/Redo 배치 편집
- Keycloak OIDC Discovery + Authorization Code/PKCE + nonce 검증
- Keycloak 그룹 기반 RBAC와 SSO 사용자 자동 생성
- 설치별 암호화 키, 개인별 API 키 생성·회전·폐기·범위 제어
- REST/OpenAPI 및 MCP Streamable HTTP
- 로그인 화면과 프로필 컨텍스트 메뉴의 빌드 버전 표시
- 런타임 외부 CDN/인터넷 연결이 없는 단일 서비스 이미지

## UI 프레임워크 결정

운영형 관리자 화면에는 [Material UI](https://mui.com/material-ui/)를 사용했다. 접근성 있는 폼·테이블·반응형 레이아웃과 일관된 테마를 빠르게 유지할 수 있고 React 19를 공식 지원한다. 좌석맵은 별도 외부 지도 SDK 대신 SVG로 구현하여 비율 좌표, 선택, 줌, Drag & Drop을 오프라인에서도 예측 가능하게 유지한다.

## 실행

외부 또는 사내 PostgreSQL 14+ 데이터베이스를 준비한다. SeatOn이 시작할 때 스키마를 자동 생성한다.

```bash
docker load < SeatOn-v1.1.0-linux-amd64-image.tar.gz

export POSTGRES_DSN='postgres://seaton:password@postgres.intra:5432/seaton?sslmode=require'
export BOOTSTRAP_ADMIN='admin'
export BOOTSTRAP_ADMIN_PASSWORD='change-this-strong-password'
export SEATON_IMAGE_TAG='1.1.0'
docker compose up -d
```

`SEATON_IMAGE_TAG`는 Compose 파일의 이미지 선택용 셸 치환값이며 컨테이너 환경변수로 전달되지 않는다. 애플리케이션이 받는 환경변수는 아래 세 개뿐이다.

| 환경변수 | 설명 |
| --- | --- |
| `POSTGRES_DSN` | PostgreSQL DSN |
| `BOOTSTRAP_ADMIN` | 최초 시스템 관리자 아이디 |
| `BOOTSTRAP_ADMIN_PASSWORD` | 최초 관리자 비밀번호, 12자 이상 |

부트스트랩 계정이 이미 있으면 환경변수 비밀번호로 덮어쓰지 않는다. 비밀번호 변경이나 SSO 전환 후에도 안전하다.

`http://host:8080`에 접속한 뒤 시스템 설정에서 서비스명, Keycloak, 인사 연동, 좌석 인식 엔진과 AI 기준, 세션과 키 정책을 관리한다. 좌석 인식 엔진 기본값은 오프라인 CV이며, 이 상태에서는 런타임 외부 통신이 전혀 없다. 운영 환경에서는 리버스 프록시에서 HTTPS를 종료하고 `X-Forwarded-Proto`와 `X-Forwarded-Host`를 전달한다.

## Keycloak 연결

1. 관리자 → 시스템 설정 → Keycloak SSO에서 `Issuer URL`, `Client ID`, `Client Secret`을 입력한다.
2. Keycloak Client의 Client authentication을 켠다.
3. Valid Redirect URI에 `https://서비스주소/api/v1/auth/oidc/callback`을 등록한다.
4. 필요하면 `/seaton-admins`, `/seaton-seat-managers` 그룹명을 바꾼다.
5. Keycloak의 Group Membership mapper로 `groups` claim을 ID Token에 포함한다.
6. **저장 후 연결 테스트**로 Discovery URL과 Callback을 확인하고 SSO를 활성화한다.

그 외 Keycloak 엔드포인트는 Issuer의 표준 Discovery 문서에서 자동 구성한다.

## 좌석 인식 엔진

관리자 → 시스템 설정 → AI 분석에서 도면 판독 방식을 고른다.

| 엔진 | 동작 | 외부 통신 |
| --- | --- | --- |
| `cv` (기본) | 내장 오프라인 CV 파이프라인 `offline-cv-v2` | 없음 |
| `vlm` | 사내 비전 모델 단독 판독 | 설정한 사내 엔드포인트 |
| `hybrid` | CV와 VLM 결과를 IoU로 교차 검증 | 설정한 사내 엔드포인트 |

`vlm`·`hybrid`를 쓰려면 OpenAI 호환 `/chat/completions`를 제공하는 **사내** 추론 서버 주소를 입력한다. vLLM이나 Ollama로 Qwen2.5-VL 계열을 서빙한 주소를 쓰고, **저장 후 VLM 연결 시험**으로 주소·인증·응답 형식·좌표계를 한 번에 확인한다. 비전 모델의 확신도는 보정된 확률이 아니므로 VLM이 단독으로 찾은 좌석은 자동 승인되지 않고 항상 검토 큐에 남는다. VLM 호출이 실패하면 CV 결과로 자동 대체되어 분석은 완료된다.

분석은 비동기 작업이다. 분석 요청은 즉시 `202`와 작업 ID를 돌려주고 관리자 화면이 완료까지 진행 상태를 보여준다. 엔진별 동작과 예상 실패 처리는 [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)에 정리했다.

## 백업과 복구

PostgreSQL 백업과 `seaton-data` 볼륨을 한 세트로 백업한다. `/var/lib/seaton/master.key`를 잃으면 DB의 암호화된 Client Secret과 API Token을 복호화할 수 없으므로 새로 입력해야 한다. 개인 API 키 원문은 어떤 경우에도 복구되지 않는다.

## 개발

```bash
cd web && npm ci && npm run build
cd .. && go test ./...
docker build -t seaton:dev .
```

API/MCP 세부사항은 [docs/API_AND_MCP.md](docs/API_AND_MCP.md), 보안·배치 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 운영과 엔진 설정은 [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)를 참고한다.

### 문서 산출물

`docs/*.md` 가 단일 원본이고 배포용 HTML·PDF는 생성물이다. 문서를 고친 뒤에는 생성 스크립트를 다시 실행한다.

```bash
pip install reportlab
python3 scripts/build-docs.py             # docs 전체 HTML + PDF 재생성
python3 scripts/build-docs.py ADMIN_GUIDE  # 특정 문서만
```

PDF는 `docs/fonts/NanumGothic.ttf` 를 임베드하므로 한글 폰트가 없는 환경에서도 동일하게 열린다.

## 릴리스

`v1.1.0` 형태의 태그를 push하면 GitHub Actions가 `linux/amd64` 서비스 이미지를 빌드하고 `docker save` 결과만 `tar.gz`로 GitHub Release에 첨부한다. 런타임에는 레지스트리나 인터넷이 필요 없다.

로컬 검증은 다음과 같다.

```bash
./scripts/release-image.sh 1.1.0
gzip -t SeatOn-v1.1.0-linux-amd64-image.tar.gz
```
