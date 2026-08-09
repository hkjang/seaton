# SeatOn API 및 MCP

## 인증

관리자 화면의 프로필 메뉴에서 개인 API 키를 생성한다. 키 원문은 생성 또는 회전 직후 한 번만 표시되고 서버에는 설치별 마스터 키로 계산한 HMAC-SHA-256 값만 저장된다.

```http
Authorization: Bearer seat_xxxxxxxxxxxxxxxxxxxxxxxxx
```

범위는 다음과 같다.

| 범위 | 권한 |
| --- | --- |
| `read` | REST 조회 |
| `write` | REST 변경 및 MCP 배정 도구 |
| `mcp` | MCP 연결 |

키 회전 시 새 버전이 생성되고, 기존 키는 관리자가 설정한 유예시간 동안만 계속 유효하다. 즉시 폐기하면 유예 없이 무효화된다.

## REST API

OpenAPI 3.1 문서는 실행 중인 SeatOn의 `/api/v1/openapi.json`에서 확인한다. 대표 경로는 다음과 같다.

- `GET /api/v1/employees?q=&status=&assignment=` 직원/조직 및 재직·배정 상태 검색
- `GET /api/v1/seats?floorMapId=` 좌석 및 배정 조회
- `PATCH /api/v1/seats/bulk` 다중 좌석 위치·회전 일괄 저장
- `POST /api/v1/seat-assignments` 좌석 배정
- `POST /api/v1/seat-assignments/bulk` CSV/XLSX 일괄 배정
- `POST /api/v1/floor-maps/{id}/analyze` 오프라인 도면 분석
- `GET /api/v1/seat-history` 변경 이력
- `GET /api/v1/dashboard` 운영 준비도와 처리 필요 건수
- `GET /api/v1/dashboard/issues?kind=` 처리 필요 상세 작업 큐
- `POST /api/v1/dashboard/issues/{kind}/{id}/resolve` 퇴직자 좌석 해제, AI 후보 승인, 조직 영역 보정

## MCP

SeatOn은 MCP Streamable HTTP 형식의 단일 엔드포인트를 제공한다.

```text
POST https://seaton.example.intra/mcp
Authorization: Bearer seat_...
```

지원 도구:

- `search_employees`: 이름, 사번, 이메일, 조직으로 직원/좌석 검색
- `list_available_seats`: 층별 빈 좌석 조회
- `get_floor_map`: 도면 메타데이터와 비율 좌표 조회
- `get_action_items`: 관리자 처리 필요 항목 조회
- `assign_seat`: 좌석 관리자 + `write` 범위로 좌석 배정

변경 도구 호출은 REST와 동일하게 감사로그와 좌석 변경 이력을 남긴다.
