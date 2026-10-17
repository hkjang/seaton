package app

import (
	"errors"
	"testing"
)

// mcpEmployeeRow 는 search_employees 의 SELECT 열 순서 그대로다(7개). 일곱 열이
// 모두 string 이라 서로 바꿔 넣어도 컴파일되므로 값을 전부 다르게 둔다.
func mcpEmployeeRow() []any {
	return []any{"e-1", "E001", "김좌석", "인사팀", "A-101", "본사", "3층"}
}

// mcpSeatRow 는 list_available_seats 의 SELECT 열 순서 그대로다(4개).
func mcpSeatRow() []any {
	return []any{"s-1", "A-101", "본사", "3층"}
}

// mcpFloorMapSeatRow 는 get_floor_map 의 SELECT 열 순서 그대로다(9개). x·y·
// width·height 넷이 모두 float64 라 뒤바꿔 넣어도 컴파일된다 — 값을 서로 다르게
// 둬 짝을 못 박는다.
func mcpFloorMapSeatRow() []any {
	return []any{"s-1", "A-101", "desk", "occupied", 0.1, 0.2, 0.3, 0.4, "김좌석"}
}

func TestScanMCPEmployeesReturnsEveryRow(t *testing.T) {
	second := []any{"e-2", "E002", "이배정", "영업팀", "", "", ""}
	items, err := scanMCPEmployees(&fakeRows{values: [][]any{mcpEmployeeRow(), second}})
	if err != nil {
		t.Fatalf("scanMCPEmployees 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	got := items[0]
	if got["id"] != "e-1" || got["employeeNo"] != "E001" || got["name"] != "김좌석" ||
		got["organization"] != "인사팀" || got["seatNo"] != "A-101" ||
		got["building"] != "본사" || got["floor"] != "3층" {
		t.Errorf("열의 짝이 어긋났다: %+v", got)
	}
	if items[1]["employeeNo"] != "E002" || items[1]["seatNo"] != "" {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
	// 검색 결과가 없어도 JSON 이 null 이 아니라 [] 여야 한다.
	empty, err := scanMCPEmployees(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

// 행을 읽다 깨지면 빈 구조체를 목록에 끼워 넣으면 안 된다. 도구를 부르는 쪽은
// 모델이라 사번도 이름도 빈 직원을 그대로 사람에게 읊는다.
func TestScanMCPEmployeesReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{mcpEmployeeRow(), mcpEmployeeRow()}, scanErr: broken}
	items, err := scanMCPEmployees(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanMCPEmployees 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	if items != nil {
		t.Errorf("오류와 함께 목록을 돌려주면 안 된다: %+v", items)
	}
	// 첫 실패에서 멈춘다 — 깨진 연결로 남은 행을 계속 읽을 이유가 없다.
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

// 조회가 중간에 끊기면 pgx 는 Next() 를 false 로 돌리고 Err() 에만 사유를 둔다.
func TestScanMCPEmployeesReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	if _, err := scanMCPEmployees(&fakeRows{values: [][]any{mcpEmployeeRow()}, err: broken}); !errors.Is(err, broken) {
		t.Errorf("scanMCPEmployees 오류 = %v, want %v", err, broken)
	}
}

func TestScanMCPSeatsReturnsEveryRow(t *testing.T) {
	second := []any{"s-2", "B-202", "연구동", "1층"}
	items, err := scanMCPSeats(&fakeRows{values: [][]any{mcpSeatRow(), second}})
	if err != nil {
		t.Fatalf("scanMCPSeats 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	got := items[0]
	if got["id"] != "s-1" || got["seatNo"] != "A-101" || got["building"] != "본사" || got["floor"] != "3층" {
		t.Errorf("열의 짝이 어긋났다: %+v", got)
	}
	if items[1]["building"] != "연구동" || items[1]["floor"] != "1층" {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
	empty, err := scanMCPSeats(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

// 빈 좌석번호가 섞이면 모델은 그것을 실제로 배정 가능한 자리로 읽고
// assign_seat 를 부른다.
func TestScanMCPSeatsReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{mcpSeatRow(), mcpSeatRow()}, scanErr: broken}
	items, err := scanMCPSeats(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanMCPSeats 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	if items != nil {
		t.Errorf("오류와 함께 목록을 돌려주면 안 된다: %+v", items)
	}
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

func TestScanMCPSeatsReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	if _, err := scanMCPSeats(&fakeRows{values: [][]any{mcpSeatRow()}, err: broken}); !errors.Is(err, broken) {
		t.Errorf("scanMCPSeats 오류 = %v, want %v", err, broken)
	}
}

func TestScanMCPFloorMapSeatsReturnsEveryRow(t *testing.T) {
	second := []any{"s-2", "A-102", "meeting", "available", 0.5, 0.6, 0.7, 0.8, ""}
	items, err := scanMCPFloorMapSeats(&fakeRows{values: [][]any{mcpFloorMapSeatRow(), second}})
	if err != nil {
		t.Fatalf("scanMCPFloorMapSeats 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	got := items[0]
	if got["id"] != "s-1" || got["seatNo"] != "A-101" || got["type"] != "desk" ||
		got["status"] != "occupied" || got["employee"] != "김좌석" {
		t.Errorf("문자열 열의 짝이 어긋났다: %+v", got)
	}
	if got["x"] != 0.1 || got["y"] != 0.2 || got["width"] != 0.3 || got["height"] != 0.4 {
		t.Errorf("좌표/크기의 짝이 어긋났다: %v %v %v %v", got["x"], got["y"], got["width"], got["height"])
	}
	if items[1]["type"] != "meeting" || items[1]["employee"] != "" {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
	empty, err := scanMCPFloorMapSeats(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

// 좌표가 0,0 인 빈 좌석이 섞이면 모델은 도면 왼쪽 위 모서리에 좌석이 있다고
// 읽는다.
func TestScanMCPFloorMapSeatsReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{mcpFloorMapSeatRow(), mcpFloorMapSeatRow()}, scanErr: broken}
	items, err := scanMCPFloorMapSeats(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanMCPFloorMapSeats 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	if items != nil {
		t.Errorf("오류와 함께 목록을 돌려주면 안 된다: %+v", items)
	}
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

func TestScanMCPFloorMapSeatsReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	if _, err := scanMCPFloorMapSeats(&fakeRows{values: [][]any{mcpFloorMapSeatRow()}, err: broken}); !errors.Is(err, broken) {
		t.Errorf("scanMCPFloorMapSeats 오류 = %v, want %v", err, broken)
	}
}
