package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// 직원 가져오기는 파일의 `재직상태` 칸을 employees.status 에 그대로 넣는다.
// 그 열에는 CHECK (status IN ('active','leave','retired')) 가 걸려 있어
// 모르는 값 한 칸이 그 행을 DB 제약 위반으로 떨어뜨린다. 받는 값과 되돌리는
// 문장을 여기서 못 박는다 — 두 입력 모양(양식은 `active`, 내보낸 목록은 `재직`)이
// 모두 계속 통과해야 한다.
func TestNormalizeEmployeeStatusAcceptsCodesAndLabels(t *testing.T) {
	cases := map[string]string{
		// 직원 양식(EmployeesPage.downloadTemplate)이 예시로 쓰는 코드.
		"active":  "active",
		"leave":   "leave",
		"retired": "retired",
		// 내보낸 직원목록(employeeExport.employeeStatusLabel)이 쓰는 한국어 라벨.
		"재직": "active",
		"휴직": "leave",
		"퇴직": "retired",
		// 빈 값은 오류가 아니다. 조직이나 직급만 고치는 흔한 파일에는 재직상태
		// 열이 아예 없거나 비어 있고, saveEmployee 가 그것을 active 로 둔다.
		"": "active",
		// 사람이 채운 칸에는 앞뒤 공백이 흔하다.
		"  재직  ":   "active",
		"\tactive": "active",
	}
	for raw, want := range cases {
		got, err := normalizeEmployeeStatus(raw)
		if err != nil {
			t.Errorf("normalizeEmployeeStatus(%q) 오류: %v", raw, err)
			continue
		}
		if got != want {
			t.Errorf("normalizeEmployeeStatus(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestNormalizeEmployeeStatusRejectsUnknownValue(t *testing.T) {
	// 흔한 오타·다른 표기. 그대로 INSERT 하면 CHECK 위반이 되어 pgx 원문이
	// 화면에 뜬다.
	for _, raw := range []string{"재직중", "휴가", "Active", "퇴사", "1"} {
		got, err := normalizeEmployeeStatus(raw)
		if err == nil {
			t.Errorf("normalizeEmployeeStatus(%q) = %q, 오류를 돌려줘야 한다", raw, got)
			continue
		}
		// 사용자에게 보여도 되는 오류여야 한다 — 가져오기는 이것만 그 행의
		// 사유로 통과시킨다.
		var input inputError
		if !errors.As(err, &input) {
			t.Errorf("normalizeEmployeeStatus(%q) 오류가 inputError 가 아니다: %v", raw, err)
		}
		// 어느 칸을 어떤 값으로 고쳐야 하는지 문장에 있어야 한다.
		msg := err.Error()
		if !strings.Contains(msg, raw) || !strings.Contains(msg, "재직상태") {
			t.Errorf("normalizeEmployeeStatus(%q) 오류 문장에 값과 열 이름이 없다: %q", raw, msg)
		}
		// DB 낱말이 사용자 화면에 새어 나가면 안 된다.
		for _, leak := range []string{"SQLSTATE", "constraint", "relation"} {
			if strings.Contains(msg, leak) {
				t.Errorf("normalizeEmployeeStatus(%q) 오류 문장에 DB 낱말 %q: %q", raw, leak, msg)
			}
		}
	}
}

// fakeRow 는 releaseRetiredSeat 가 읽는 RETURNING seat_id 한 칸을 흉내낸다.
type fakeRow struct {
	seatID string
	err    error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) == 1 {
		if target, ok := dest[0].(*string); ok {
			*target = r.seatID
		}
	}
	return nil
}

// fakeReleaser 는 좌석 해제가 실제로 어떤 문장을 어떤 값으로 보내는지 기록한다.
// 여기서 가리는 것은 pgx 경계 하나뿐이다 — 이 세 문장의 짝(배정 종료·좌석
// available·이력 한 건)이 인사 동기화와 같아야 하므로 그 계약을 못 박는다.
type fakeReleaser struct {
	row      fakeRow
	execs    []string
	execArgs [][]any
	execErr  error
}

func (f *fakeReleaser) QueryRow(context.Context, string, ...any) pgx.Row { return f.row }

func (f *fakeReleaser) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execs = append(f.execs, sql)
	f.execArgs = append(f.execArgs, args)
	return pgconn.CommandTag{}, f.execErr
}

func TestReleaseRetiredSeatClosesAssignmentAndRecordsHistory(t *testing.T) {
	actor := "u-1"
	fake := &fakeReleaser{row: fakeRow{seatID: "seat-9"}}
	if err := releaseRetiredSeat(context.Background(), fake, "emp-1", &actor, "employee_import"); err != nil {
		t.Fatalf("releaseRetiredSeat 오류: %v", err)
	}
	if len(fake.execs) != 2 {
		t.Fatalf("Exec 가 2번이어야 한다: %v", fake.execs)
	}
	// 좌석을 다시 쓸 수 있게 돌려놓아야 한다 — 그러지 않으면 좌석맵에서 빈
	// 자리로 보이지 않고 "미사용 좌석" 지표에도 잡히지 않는다.
	if !strings.Contains(fake.execs[0], "UPDATE seats") || !strings.Contains(fake.execs[0], "available") {
		t.Errorf("첫 Exec 가 좌석을 available 로 돌리지 않는다: %q", fake.execs[0])
	}
	if got := fake.execArgs[0]; len(got) != 1 || got[0] != "seat-9" {
		t.Errorf("좌석 UPDATE 가 RETURNING 으로 받은 좌석을 쓰지 않는다: %v", got)
	}
	// 누가·왜 비웠는지 추적되어야 한다. 이력이 없으면 자리가 사라진 이유를
	// 아무도 알 수 없다.
	history := fake.execs[1]
	if !strings.Contains(history, "INSERT INTO seat_history") {
		t.Fatalf("둘째 Exec 가 이력을 남기지 않는다: %q", history)
	}
	if !strings.Contains(history, "퇴직자 자동 좌석 해제") {
		t.Errorf("이력 사유가 인사 동기화와 달라졌다: %q", history)
	}
	args := fake.execArgs[1]
	if len(args) < 5 {
		t.Fatalf("이력 INSERT 인자가 모자란다: %v", args)
	}
	if args[1] != "emp-1" || args[2] != "seat-9" {
		t.Errorf("이력이 다른 직원/좌석을 가리킨다: %v", args)
	}
	if args[3] != &actor {
		t.Errorf("이력에 조치한 사람이 들어가지 않았다: %v", args[3])
	}
	// 방식은 호출한 경로를 그대로 따른다 — 이력 화면이 가져오기로 비운 자리와
	// 인사 동기화로 비운 자리를 구분할 수 있어야 한다.
	if args[4] != "employee_import" {
		t.Errorf("이력 방식이 %v, want employee_import", args[4])
	}
}

// 좌석이 없는 직원을 퇴직으로 올리는 것은 오류가 아니고, 이미 퇴직인 직원을
// 다시 올려도 이력이 늘지 않아야 한다. 둘 다 "열린 배정이 없다"로 같은 길이다.
func TestReleaseRetiredSeatIsNoopWithoutAssignment(t *testing.T) {
	fake := &fakeReleaser{row: fakeRow{err: pgx.ErrNoRows}}
	if err := releaseRetiredSeat(context.Background(), fake, "emp-1", nil, "manual"); err != nil {
		t.Fatalf("좌석 없는 직원에 오류가 났다: %v", err)
	}
	if len(fake.execs) != 0 {
		t.Errorf("좌석도 이력도 건드리지 않아야 한다: %v", fake.execs)
	}
}

// 세 문장 중 하나가 깨지면 그대로 올려야 한다. 삼키면 "배정은 닫혔는데 좌석이
// occupied" 가 남은 채로 성공이라 보고된다.
func TestReleaseRetiredSeatReportsFailure(t *testing.T) {
	broken := errors.New("db down")
	fake := &fakeReleaser{row: fakeRow{seatID: "seat-9"}, execErr: broken}
	if err := releaseRetiredSeat(context.Background(), fake, "emp-1", nil, "manual"); !errors.Is(err, broken) {
		t.Errorf("releaseRetiredSeat 오류 = %v, want %v", err, broken)
	}
	// 사람에게는 pgx 원문을 보여주지 않는다.
	if got := userMessage(broken, "저장하지 못했습니다"); got != "저장하지 못했습니다" {
		t.Errorf("userMessage = %q", got)
	}
}

// fakeRows 는 목록 핸들러의 스캔 루프가 쓰는 pgx.Rows 의 세 메서드만 흉내낸다
// (fakeReleaser 와 같은 수법 — 가리는 것은 pgx 경계 하나뿐이다). values 의 각
// 줄이 한 행이고 그 줄의 값이 Scan 의 dest 로 차례로 들어간다. 실제 DB 없이
// "행을 읽다 깨지는" 경우를 만들 수 있는 유일한 수단이다.
type fakeRows struct {
	values  [][]any
	idx     int
	scanErr error // Scan 이 돌려줄 오류 (행을 읽다 연결이 끊긴 경우)
	err     error // 루프가 끝난 뒤 Err() 가 돌려줄 오류 (조회가 중간에 끊긴 경우)
	scans   int
}

func (f *fakeRows) Next() bool {
	if f.idx >= len(f.values) {
		return false
	}
	f.idx++
	return true
}

func (f *fakeRows) Err() error { return f.err }

func (f *fakeRows) Scan(dest ...any) error {
	f.scans++
	if f.scanErr != nil {
		return f.scanErr
	}
	row := f.values[f.idx-1]
	if len(row) != len(dest) {
		return fmt.Errorf("fakeRows: 행의 값이 %d개인데 dest 는 %d개다", len(row), len(dest))
	}
	for i, v := range row {
		switch target := dest[i].(type) {
		case *string:
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf("fakeRows: dest[%d] 는 string 인데 값은 %T 다", i, v)
			}
			*target = s
		case **string:
			if v == nil {
				*target = nil
				continue
			}
			p, ok := v.(*string)
			if !ok {
				return fmt.Errorf("fakeRows: dest[%d] 는 *string 인데 값은 %T 다", i, v)
			}
			*target = p
		case *float64:
			f, ok := v.(float64)
			if !ok {
				return fmt.Errorf("fakeRows: dest[%d] 는 float64 인데 값은 %T 다", i, v)
			}
			*target = f
		case **float64:
			if v == nil {
				*target = nil
				continue
			}
			p, ok := v.(*float64)
			if !ok {
				return fmt.Errorf("fakeRows: dest[%d] 는 *float64 인데 값은 %T 다", i, v)
			}
			*target = p
		case *any:
			*target = v
		default:
			return fmt.Errorf("fakeRows: dest[%d] 타입을 모른다: %T", i, dest[i])
		}
	}
	return nil
}

func ptr(s string) *string { return &s }

// 정상 경로: 돌려준 모든 행이 그대로 목록에 담겨야 한다. 열 순서가 어긋나면
// 이름 자리에 사번이 들어가므로 그 짝까지 못 박는다.
func TestScanEmployeesReturnsEveryRow(t *testing.T) {
	rows := &fakeRows{values: [][]any{
		{"e-1", "E001", "김개발", "k@x.com", ptr("org-1"), "개발팀", "팀장", "책임", "본사", "active", ptr("seat-1"), "A-01"},
		{"e-2", "E002", "이영업", "", nil, "", "", "", "", "retired", nil, ""},
	}}
	items, err := scanEmployees(rows)
	if err != nil {
		t.Fatalf("scanEmployees 오류: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("행 %d개, want 2", len(items))
	}
	if items[0].EmployeeNo != "E001" || items[0].Name != "김개발" || items[0].SeatNo != "A-01" {
		t.Errorf("첫 행의 열 짝이 어긋났다: %+v", items[0])
	}
	if items[0].OrganizationID == nil || *items[0].OrganizationID != "org-1" {
		t.Errorf("조직 ID 가 들어가지 않았다: %+v", items[0].OrganizationID)
	}
	if items[1].SeatID != nil || items[1].Status != "retired" {
		t.Errorf("둘째 행이 어긋났다: %+v", items[1])
	}
}

// 행을 읽다 깨지면 그 행만 조용히 버리고 "직원 1명" 을 200 으로 돌려주면 안
// 된다 — 관리자는 그것이 전부라고 믿는다. 오류를 올려 핸들러가 500 을 내게
// 한다.
func TestScanEmployeesReportsScanFailure(t *testing.T) {
	broken := errors.New("conn closed")
	rows := &fakeRows{values: [][]any{
		{"e-1", "E001", "김개발", "", nil, "", "", "", "", "active", nil, ""},
		{"e-2", "E002", "이영업", "", nil, "", "", "", "", "active", nil, ""},
	}, scanErr: broken}
	items, err := scanEmployees(rows)
	if !errors.Is(err, broken) {
		t.Fatalf("scanEmployees 오류 = %v, want %v (부분 목록 %d건)", err, broken, len(items))
	}
	// 첫 실패에서 멈춘다 — 깨진 연결로 남은 행을 계속 읽을 이유가 없다.
	if rows.scans != 1 {
		t.Errorf("Scan 을 %d번 불렀다, want 1", rows.scans)
	}
}

// 조회가 중간에 끊기면 pgx 는 Next() 를 false 로 돌리고 Err() 에만 사유를 둔다.
// Err() 를 보지 않으면 "0명" 이 200 으로 나간다.
func TestScanEmployeesReportsRowsErr(t *testing.T) {
	broken := errors.New("unexpected EOF")
	rows := &fakeRows{values: [][]any{
		{"e-1", "E001", "김개발", "", nil, "", "", "", "", "active", nil, ""},
	}, err: broken}
	if _, err := scanEmployees(rows); !errors.Is(err, broken) {
		t.Errorf("scanEmployees 오류 = %v, want %v", err, broken)
	}
}

func TestScanOrganizationsReportsFailures(t *testing.T) {
	broken := errors.New("conn closed")
	if _, err := scanOrganizations(&fakeRows{values: [][]any{{"o-1", "D01", "개발팀", nil, "#111111"}}, scanErr: broken}); !errors.Is(err, broken) {
		t.Errorf("Scan 실패를 올리지 않는다: %v", err)
	}
	if _, err := scanOrganizations(&fakeRows{err: broken}); !errors.Is(err, broken) {
		t.Errorf("rows.Err() 를 올리지 않는다: %v", err)
	}
	items, err := scanOrganizations(&fakeRows{values: [][]any{{"o-1", "D01", "개발팀", ptr("o-0"), "#111111"}}})
	if err != nil {
		t.Fatalf("scanOrganizations 오류: %v", err)
	}
	if len(items) != 1 || items[0]["name"] != "개발팀" || items[0]["externalId"] != "D01" {
		t.Errorf("정상 행이 어긋났다: %v", items)
	}
	// 조직이 없는 설치에서도 JSON 이 null 이 아니라 [] 여야 한다 — 프런트의
	// organizations.map 이 null 에서 깨진다.
	empty, err := scanOrganizations(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}

func TestScanHistoryReportsFailures(t *testing.T) {
	broken := errors.New("conn closed")
	row := []any{"h-1", "2026-10-05T00:00:00Z", "E001", "김개발", "A-01", "A-02", "관리자", "자리 이동", "manual"}
	if _, err := scanHistory(&fakeRows{values: [][]any{row}, scanErr: broken}); !errors.Is(err, broken) {
		t.Errorf("Scan 실패를 올리지 않는다: %v", err)
	}
	if _, err := scanHistory(&fakeRows{err: broken}); !errors.Is(err, broken) {
		t.Errorf("rows.Err() 를 올리지 않는다: %v", err)
	}
	items, err := scanHistory(&fakeRows{values: [][]any{row}})
	if err != nil {
		t.Fatalf("scanHistory 오류: %v", err)
	}
	// 이력 화면이 읽는 키 이름 계약.
	if len(items) != 1 || items[0]["employeeNo"] != "E001" || items[0]["previousSeat"] != "A-01" ||
		items[0]["newSeat"] != "A-02" || items[0]["actor"] != "관리자" || items[0]["source"] != "manual" {
		t.Errorf("정상 행의 키 짝이 어긋났다: %v", items)
	}
	empty, err := scanHistory(&fakeRows{})
	if err != nil || empty == nil {
		t.Errorf("빈 결과가 nil 이면 JSON 이 null 이 된다: %v, %v", empty, err)
	}
}
