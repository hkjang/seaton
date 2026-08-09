package app

import "net/http"

func (s *Server) openAPI(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{
		"openapi":    "3.1.0",
		"info":       map[string]any{"title": "SeatOn API", "version": s.version, "description": "오프라인 사내 좌석 관리 REST API. 브라우저 세션 또는 개인 Bearer API 키를 사용합니다."},
		"servers":    []map[string]string{{"url": "/api/v1"}},
		"components": map[string]any{"securitySchemes": map[string]any{"bearerApiKey": map[string]string{"type": "http", "scheme": "bearer", "bearerFormat": "SeatOn personal API key"}, "cookieSession": map[string]string{"type": "apiKey", "in": "cookie", "name": sessionCookie}}},
		"security":   []map[string]any{{"bearerApiKey": []string{}}, {"cookieSession": []string{}}},
		"paths": map[string]any{
			"/version":          map[string]any{"get": operation("서비스 버전 조회", false)},
			"/dashboard":        map[string]any{"get": operation("관리자 운영 요약", true)},
			"/dashboard/issues": map[string]any{"get": operation("처리 필요 상세 목록", true)},
			"/dashboard/issues/{kind}/{issueID}/resolve": map[string]any{"post": operation("처리 필요 항목 즉시 조치", true)},
			"/employees":                  map[string]any{"get": operation("직원 검색", true), "post": operation("직원 등록/갱신", true)},
			"/organizations":              map[string]any{"get": operation("조직 조회", true), "post": operation("조직 등록/갱신", true)},
			"/buildings":                  map[string]any{"get": operation("사업장 조회", true), "post": operation("사업장 등록", true)},
			"/floors":                     map[string]any{"get": operation("층 조회", true), "post": operation("층 등록", true)},
			"/floor-maps":                 map[string]any{"get": operation("도면 버전 조회", true), "post": operation("도면 업로드", true)},
			"/floor-maps/{mapID}/analyze": map[string]any{"post": operation("오프라인 AI/CV 좌석 후보 분석", true)},
			"/seats":                      map[string]any{"get": operation("좌석 조회", true), "post": operation("좌석 생성", true)},
			"/seats/bulk":                 map[string]any{"patch": operation("좌석 위치 일괄 이동", true)},
			"/seat-assignments":           map[string]any{"post": operation("직원 좌석 배정", true)},
			"/seat-assignments/bulk":      map[string]any{"post": operation("CSV/XLSX 좌석 일괄 배정", true)},
			"/seat-history":               map[string]any{"get": operation("좌석 변경 이력", true)},
			"/api-keys":                   map[string]any{"get": operation("내 API 키 조회", true), "post": operation("개인 API 키 생성", true)},
		},
	})
}

func operation(summary string, auth bool) map[string]any {
	m := map[string]any{"summary": summary, "responses": map[string]any{"200": map[string]string{"description": "성공"}, "400": map[string]string{"description": "잘못된 요청"}, "403": map[string]string{"description": "권한 없음"}}}
	if !auth {
		m["security"] = []any{}
	}
	return m
}
