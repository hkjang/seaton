package app

import (
	"errors"
	"strings"
	"testing"
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
