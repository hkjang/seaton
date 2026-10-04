package app

import (
	"context"
	"errors"
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
