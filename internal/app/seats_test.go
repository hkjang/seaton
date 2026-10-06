package app

import (
	"errors"
	"testing"
)

func ptrFloat(f float64) *float64 { return &f }

// seatRow 는 listSeats 의 SELECT 열 순서 그대로다(19개). 값을 모두 다르게 둔
// 것은 의도된 것이다 — 스캔 루프를 함수로 옮길 때 가장 조용히 깨지는 것이 열
// 순서의 짝이고, 특히 OrganizationID 와 EmployeeOrganizationID 는 둘 다
// *string 이라 뒤바꿔 넣어도 컴파일된다.
func seatRow() []any {
	return []any{
		"s-1", "m-1", "A-01", "fixed", "occupied",
		10.0, 20.0, 30.0, 40.0, 90.0,
		ptrFloat(0.75),
		ptr("zone-1"), "지정구역",
		ptr("e-1"), "E001", "김개발",
		ptr("emp-org-1"), "개발팀", "본사",
	}
}

// 정상 경로: 돌려준 모든 행이 그대로 담기고 열 순서의 짝이 어긋나지 않는다.
func TestScanSeatsReturnsEveryRow(t *testing.T) {
	second := []any{
		"s-2", "m-1", "A-02", "free", "available",
		11.0, 21.0, 31.0, 41.0, 0.0,
		nil,
		nil, "",
		nil, "", "",
		nil, "", "",
	}
	items, err := scanSeats(&fakeRows{values: [][]any{seatRow(), second}})
	if err != nil {
		t.Fatalf("scanSeats 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	got := items[0]
	if got.ID != "s-1" || got.FloorMapID != "m-1" || got.SeatNo != "A-01" || got.Type != "fixed" || got.Status != "occupied" {
		t.Errorf("문자열 열의 짝이 어긋났다: %+v", got)
	}
	// 좌표·크기·회전은 다섯 개가 모두 float64 라 서로 바꿔 넣어도 컴파일된다.
	if got.X != 10 || got.Y != 20 || got.Width != 30 || got.Height != 40 || got.Rotation != 90 {
		t.Errorf("좌표/크기/회전의 짝이 어긋났다: x=%v y=%v w=%v h=%v rot=%v", got.X, got.Y, got.Width, got.Height, got.Rotation)
	}
	if got.Confidence == nil || *got.Confidence != 0.75 {
		t.Errorf("confidence 가 들어가지 않았다: %+v", got.Confidence)
	}
	// 좌석에 지정된 구역과 실제로 앉은 직원의 소속은 다른 값이다 — 좌석 색과
	// 구역 불일치 판정이 이 둘을 구분해서 읽는다.
	if got.OrganizationID == nil || *got.OrganizationID != "zone-1" || got.OrganizationName != "지정구역" {
		t.Errorf("좌석 지정 구역이 어긋났다: %+v %q", got.OrganizationID, got.OrganizationName)
	}
	if got.EmployeeOrganizationID == nil || *got.EmployeeOrganizationID != "emp-org-1" || got.EmployeeOrganizationName != "개발팀" {
		t.Errorf("직원 소속이 어긋났다: %+v %q", got.EmployeeOrganizationID, got.EmployeeOrganizationName)
	}
	if got.EmployeeID == nil || *got.EmployeeID != "e-1" || got.EmployeeNo != "E001" || got.EmployeeName != "김개발" || got.EmployeeWorkplace != "본사" {
		t.Errorf("직원 열의 짝이 어긋났다: %+v", got)
	}
	if items[1].EmployeeID != nil || items[1].OrganizationID != nil || items[1].Confidence != nil || items[1].Status != "available" {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
	// 좌석이 없는 도면에서도 JSON 이 null 이 아니라 [] 여야 한다.
	empty, err := scanSeats(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

// 행을 읽다 깨지면 그 행만 버리고 "좌석 12개" 를 200 으로 돌려주면 안 된다 —
// 관리자는 그것이 도면 전부라고 믿어 이미 있는 자리에 좌석을 또 만든다.
func TestScanSeatsReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{seatRow(), seatRow()}, scanErr: broken}
	items, err := scanSeats(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanSeats 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	// 첫 실패에서 멈춘다 — 깨진 연결로 남은 행을 계속 읽을 이유가 없다.
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

// 조회가 중간에 끊기면 pgx 는 Next() 를 false 로 돌리고 Err() 에만 사유를 둔다.
// Err() 를 보지 않으면 "좌석 0개" 가 200 으로 나간다.
func TestScanSeatsReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	if _, err := scanSeats(&fakeRows{values: [][]any{seatRow()}, err: broken}); !errors.Is(err, broken) {
		t.Errorf("scanSeats 오류 = %v, want %v", err, broken)
	}
}
