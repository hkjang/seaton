package app

import (
	"errors"
	"testing"
)

func ptrInt(i int) *int { return &i }

// buildingRow 는 listBuildings 의 SELECT 열 순서 그대로다(4개). 네 열이 모두
// string 이라 서로 바꿔 넣어도 컴파일되므로 값을 전부 다르게 둔다.
func buildingRow() []any {
	return []any{"b-1", "본사", "HQ", "서울시 중구 1-1"}
}

// floorRow 는 listFloors 의 SELECT 열 순서 그대로다(6개). id·bid·name·code·
// bname 다섯이 모두 string 이다.
func floorRow() []any {
	return []any{"f-1", "b-1", "3층", "F03", 3, "본사"}
}

// floorMapRow 는 listFloorMaps 의 SELECT 열 순서 그대로다(15개). fname 과
// bname 은 둘 다 string, seatCount 와 reviewCount 는 둘 다 int 라 뒤바꿔 넣어도
// 컴파일된다 — 그래서 값을 서로 다르게 둬 짝을 못 박는다.
func floorMapRow() []any {
	return []any{
		"m-1", "f-1", "v3", "3층도면.pdf", "application/pdf",
		ptrInt(1200), ptrInt(800),
		"ready", true,
		"2026-10-16T09:00:00Z",
		"3층", "본사",
		40, 7,
		[]byte(`{"originX":0.1,"originY":0.2,"pitchX":0.05,"pitchY":0.06,"source":"manual"}`),
	}
}

// 정상 경로: 돌려준 모든 행이 그대로 담기고 열 순서의 짝이 어긋나지 않는다.
func TestScanBuildingsReturnsEveryRow(t *testing.T) {
	second := []any{"b-2", "연구동", "RND", ""}
	items, err := scanBuildings(&fakeRows{values: [][]any{buildingRow(), second}})
	if err != nil {
		t.Fatalf("scanBuildings 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	got := items[0]
	if got["id"] != "b-1" || got["name"] != "본사" || got["code"] != "HQ" || got["address"] != "서울시 중구 1-1" {
		t.Errorf("열의 짝이 어긋났다: %+v", got)
	}
	if items[1]["code"] != "RND" || items[1]["address"] != "" {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
	// 건물이 없어도 JSON 이 null 이 아니라 [] 여야 한다.
	empty, err := scanBuildings(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

// 행을 읽다 깨지면 그 행만 버리고 "건물 2개" 를 200 으로 돌려주면 안 된다 —
// 관리자는 그것이 전부라고 믿어 이미 있는 건물을 또 만든다.
func TestScanBuildingsReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{buildingRow(), buildingRow()}, scanErr: broken}
	items, err := scanBuildings(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanBuildings 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	// 첫 실패에서 멈춘다 — 깨진 연결로 남은 행을 계속 읽을 이유가 없다.
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

// 조회가 중간에 끊기면 pgx 는 Next() 를 false 로 돌리고 Err() 에만 사유를 둔다.
func TestScanBuildingsReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	if _, err := scanBuildings(&fakeRows{values: [][]any{buildingRow()}, err: broken}); !errors.Is(err, broken) {
		t.Errorf("scanBuildings 오류 = %v, want %v", err, broken)
	}
}

func TestScanFloorsReturnsEveryRow(t *testing.T) {
	second := []any{"f-2", "b-2", "1층", "F01", 1, "연구동"}
	items, err := scanFloors(&fakeRows{values: [][]any{floorRow(), second}})
	if err != nil {
		t.Fatalf("scanFloors 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	got := items[0]
	// buildingId·buildingName 은 층 이름·코드와 섞이기 쉬운 자리다.
	if got["id"] != "f-1" || got["buildingId"] != "b-1" || got["buildingName"] != "본사" {
		t.Errorf("건물 열의 짝이 어긋났다: %+v", got)
	}
	if got["name"] != "3층" || got["code"] != "F03" || got["sortOrder"] != 3 {
		t.Errorf("층 열의 짝이 어긋났다: %+v", got)
	}
	if items[1]["sortOrder"] != 1 || items[1]["buildingName"] != "연구동" {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
	// 층이 없는 건물에서도 JSON 이 null 이 아니라 [] 여야 한다.
	empty, err := scanFloors(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

// 층 목록은 도면 업로드 화면의 선택 기준이다 — 한 층이 조용히 빠지면 관리자는
// "그 건물에 층이 없다" 고 믿고 같은 층을 다시 만든다.
func TestScanFloorsReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{floorRow(), floorRow()}, scanErr: broken}
	items, err := scanFloors(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanFloors 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

func TestScanFloorsReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	if _, err := scanFloors(&fakeRows{values: [][]any{floorRow()}, err: broken}); !errors.Is(err, broken) {
		t.Errorf("scanFloors 오류 = %v, want %v", err, broken)
	}
}

func TestScanFloorMapsReturnsEveryRow(t *testing.T) {
	second := []any{
		"m-2", "f-2", "v1", "1층도면.png", "image/png",
		nil, nil,
		"processing", false,
		"2026-10-15T09:00:00Z",
		"1층", "연구동",
		0, 0,
		nil,
	}
	items, err := scanFloorMaps(&fakeRows{values: [][]any{floorMapRow(), second}})
	if err != nil {
		t.Fatalf("scanFloorMaps 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	got := items[0]
	if got["id"] != "m-1" || got["floorId"] != "f-1" || got["version"] != "v3" {
		t.Errorf("식별 열의 짝이 어긋났다: %+v", got)
	}
	if got["fileName"] != "3층도면.pdf" || got["contentType"] != "application/pdf" || got["status"] != "ready" || got["active"] != true {
		t.Errorf("파일 열의 짝이 어긋났다: %+v", got)
	}
	if got["createdAt"] != "2026-10-16T09:00:00Z" {
		t.Errorf("createdAt 이 어긋났다: %+v", got["createdAt"])
	}
	// floorName 과 buildingName 은 둘 다 string 이라 뒤바꿔도 컴파일된다.
	if got["floorName"] != "3층" || got["buildingName"] != "본사" {
		t.Errorf("층/건물 이름의 짝이 어긋났다: %+v %+v", got["floorName"], got["buildingName"])
	}
	// seatCount 와 reviewCount 도 둘 다 int 라 뒤바꿔도 컴파일된다.
	if got["seatCount"] != 40 || got["reviewCount"] != 7 {
		t.Errorf("좌석/검토 수의 짝이 어긋났다: %+v %+v", got["seatCount"], got["reviewCount"])
	}
	w, h := got["width"].(*int), got["height"].(*int)
	if w == nil || *w != 1200 || h == nil || *h != 800 {
		t.Errorf("가로/세로의 짝이 어긋났다: %+v %+v", got["width"], got["height"])
	}
	if got["overlayReady"] != true {
		t.Errorf("overlayReady 가 어긋났다: %+v", got["overlayReady"])
	}
	if got["contentUrl"] != "/api/v1/floor-maps/m-1/content" || got["previewUrl"] != "/api/v1/floor-maps/m-1/preview" {
		t.Errorf("URL 이 어긋났다: %+v %+v", got["contentUrl"], got["previewUrl"])
	}
	grid, _ := got["grid"].(*seatGrid)
	if grid == nil || grid.OriginX != .1 || grid.OriginY != .2 || grid.PitchX != .05 || grid.PitchY != .06 || grid.Source != gridSourceManual {
		t.Errorf("grid 가 어긋났다: %+v", got["grid"])
	}
	// 크기를 아직 모르는 도면은 오버레이를 올릴 수 없고 격자도 없다.
	if items[1]["overlayReady"] != false || items[1]["grid"] != (*seatGrid)(nil) {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
	if items[1]["active"] != false || items[1]["status"] != "processing" {
		t.Errorf("둘째 행의 상태가 어긋났다: %+v", items[1])
	}
	// 도면이 없는 층에서도 JSON 이 null 이 아니라 [] 여야 한다.
	empty, err := scanFloorMaps(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

// 도면이 조용히 빠지면 관리자는 올린 도면이 사라졌다고 믿고 다시 올린다.
func TestScanFloorMapsReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{floorMapRow(), floorMapRow()}, scanErr: broken}
	items, err := scanFloorMaps(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanFloorMaps 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

func TestScanFloorMapsReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	if _, err := scanFloorMaps(&fakeRows{values: [][]any{floorMapRow()}, err: broken}); !errors.Is(err, broken) {
		t.Errorf("scanFloorMaps 오류 = %v, want %v", err, broken)
	}
}
