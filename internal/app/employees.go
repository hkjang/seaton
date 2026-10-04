package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Server) listOrganizations(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(r.Context(), `SELECT id,COALESCE(external_id,''),name,parent_id,color FROM organizations ORDER BY name`)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, external, name, color string
		var parent *string
		if rows.Scan(&id, &external, &name, &parent, &color) == nil {
			items = append(items, map[string]any{"id": id, "externalId": external, "name": name, "parentId": parent, "color": color})
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *Server) upsertOrganization(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID         string  `json:"id"`
		ExternalID string  `json:"externalId"`
		Name       string  `json:"name"`
		ParentID   *string `json:"parentId"`
		Color      string  `json:"color"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		writeError(w, 400, "name_required", "조직명은 필수입니다")
		return
	}
	if in.ID == "" {
		in.ID = newID()
	}
	if in.Color == "" {
		in.Color = "#2563EB"
	}
	_, err := s.db.Exec(r.Context(), `INSERT INTO organizations(id,external_id,name,parent_id,color) VALUES($1,NULLIF($2,''),$3,$4,$5) ON CONFLICT(id) DO UPDATE SET external_id=EXCLUDED.external_id,name=EXCLUDED.name,parent_id=EXCLUDED.parent_id,color=EXCLUDED.color,updated_at=now()`, in.ID, in.ExternalID, in.Name, in.ParentID, in.Color)
	if err != nil {
		writeError(w, 409, "organization_conflict", "조직 ID 또는 외부 ID가 중복되었습니다")
		return
	}
	u, _ := userFrom(r)
	s.audit(r.Context(), u.ID, "organization.upsert", "organization", in.ID, r.RemoteAddr, in)
	writeJSON(w, 200, map[string]string{"id": in.ID})
}

func (s *Server) listEmployees(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	org := r.URL.Query().Get("organizationId")
	status := r.URL.Query().Get("status")
	assignment := r.URL.Query().Get("assignment")
	limit := 100
	if v, _ := strconv.Atoi(r.URL.Query().Get("limit")); v > 0 && v <= 500 {
		limit = v
	}
	rows, err := s.db.Query(r.Context(), `SELECT e.id,e.employee_no,e.name,COALESCE(e.email,''),e.organization_id,COALESCE(o.name,''),COALESCE(e.title,''),COALESCE(e.position,''),COALESCE(e.workplace,''),e.status,a.seat_id,COALESCE(se.seat_no,'') FROM employees e LEFT JOIN organizations o ON o.id=e.organization_id LEFT JOIN seat_assignments a ON a.employee_id=e.id AND a.ended_at IS NULL LEFT JOIN seats se ON se.id=a.seat_id WHERE ($1='' OR e.name ILIKE '%%'||$1||'%%' OR e.employee_no ILIKE '%%'||$1||'%%' OR e.email ILIKE '%%'||$1||'%%' OR o.name ILIKE '%%'||$1||'%%') AND ($2='' OR e.organization_id=$2) AND ($3='' OR e.status=$3) AND ($4='' OR ($4='assigned' AND a.seat_id IS NOT NULL) OR ($4='unassigned' AND a.seat_id IS NULL)) ORDER BY e.name LIMIT $5`, q, org, status, assignment, limit)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	defer rows.Close()
	items := []Employee{}
	for rows.Next() {
		var item Employee
		if rows.Scan(&item.ID, &item.EmployeeNo, &item.Name, &item.Email, &item.OrganizationID, &item.OrganizationName, &item.Title, &item.Position, &item.Workplace, &item.Status, &item.SeatID, &item.SeatNo) == nil {
			items = append(items, item)
		}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

type employeeInput struct {
	ID                     string  `json:"id"`
	EmployeeNo             string  `json:"employeeNo"`
	Name                   string  `json:"name"`
	Email                  string  `json:"email"`
	OrganizationID         *string `json:"organizationId"`
	OrganizationExternalID string  `json:"organizationExternalId"`
	OrganizationName       string  `json:"organizationName"`
	Title                  string  `json:"title"`
	Position               string  `json:"position"`
	Workplace              string  `json:"workplace"`
	Status                 string  `json:"status"`
}

// inputError 는 사용자가 올린 파일이나 요청의 값이 잘못됐다는 오류다. 이 오류의
// 문장만 화면에 그대로 보여 준다 — 그렇지 않은 오류(DB 장애·제약 위반 등)의
// 원문에는 테이블·제약 이름과 SQLSTATE 가 들어 있어, 그대로 보여 주면 관리자는
// 파일의 어디를 고쳐야 하는지 알 수 없고 스키마 내부만 새어 나간다.
type inputError struct{ msg string }

func (e inputError) Error() string { return e.msg }

func inputErrorf(format string, args ...any) error {
	return inputError{msg: fmt.Sprintf(format, args...)}
}

// userMessage 는 사용자에게 보여도 되는 문장을 가려낸다. inputError 면 그 문장을,
// 아니면 고정 문장을 돌려준다.
func userMessage(err error, fallback string) string {
	var input inputError
	if errors.As(err, &input) {
		return input.Error()
	}
	return fallback
}

// normalizeEmployeeStatus 는 파일의 `재직상태` 칸을 employees.status 가 받는 세
// 코드로 바꾼다. 그 열에는 CHECK (status IN ('active','leave','retired')) 가
// 걸려 있으므로(migrations.sql:34) 모르는 값을 그대로 INSERT 하면 그 행이 DB
// 제약 위반으로 떨어지고 pgx 원문이 실패 사유로 화면에 뜬다. 값 규칙은 인사
// 동기화(runEmployeeSync)와 같다 — 세 코드만 받는다.
//
// 두 입력 모양을 모두 받아야 한다: 직원 양식(EmployeesPage.downloadTemplate)은
// 예시로 `active` 를 쓰고, 내보낸 직원목록(employeeExport.employeeStatusLabel)은
// `재직`·`휴직`·`퇴직` 한국어 라벨을 쓴다. 어느 한쪽만 받으면 양식이나 내보낸
// 파일이 깨진다.
//
// 빈 값은 오류가 아니다 — 조직이나 직급만 고치는 흔한 파일에는 재직상태 열이
// 아예 없거나 비어 있고, saveEmployee 가 그것을 active 로 둔다.
func normalizeEmployeeStatus(raw string) (string, error) {
	switch status := strings.TrimSpace(raw); status {
	case "", "active", "재직":
		return "active", nil
	case "leave", "휴직":
		return "leave", nil
	case "retired", "퇴직":
		return "retired", nil
	default:
		return "", inputErrorf("재직상태 값을 알 수 없습니다: %s (재직/휴직/퇴직)", status)
	}
}

// findOrganization 은 조직코드(organizations.external_id)나 조직명으로 이미 있는
// 조직을 찾는다. 찾지 못하면 사람이 파일을 고칠 수 있도록 어느 값이 문제인지
// 적은 오류를 돌려준다 — 가져오기는 이 문장을 그 행의 사유로 그대로 보여 준다.
//
// 조직코드가 있으면 그것만 본다. 함께 적힌 조직명은 쓰지 않는다 — 이름이 다르다고
// 기존 조직의 이름을 바꾸면 한 행의 오타가 전사의 조직 이름을 바꾸기 때문이다.
// 조직명만 있으면 이름으로 찾는데, organizations.name 에는 UNIQUE 가 없어
// (migrations.sql:14-22) 같은 이름이 여럿일 수 있다. 그럴 때는 어느 조직인지
// 단정하지 않고 조직코드를 적으라고 되돌린다.
func (s *Server) findOrganization(ctx context.Context, external, name string) (string, error) {
	if external != "" {
		var id string
		err := s.db.QueryRow(ctx, `SELECT id FROM organizations WHERE external_id=$1`, external).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", inputErrorf("조직코드 %s 에 해당하는 조직이 없습니다", external)
		}
		if err != nil {
			return "", err
		}
		return id, nil
	}
	rows, err := s.db.Query(ctx, `SELECT id FROM organizations WHERE name=$1 LIMIT 2`, name)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	switch len(ids) {
	case 1:
		return ids[0], nil
	case 0:
		return "", inputErrorf("조직명 %s 에 해당하는 조직이 없습니다", name)
	default:
		return "", inputErrorf("조직명 %s 인 조직이 여러 개입니다. 조직코드를 적어 주십시오", name)
	}
}

// seatWriter 는 좌석 해제의 세 문장을 실행할 수 있는 것이다. 인사 동기화는 자기
// 큰 트랜잭션(pgx.Tx) 안에서, 직원 저장은 그 세 문장만 묶은 짧은 트랜잭션에서
// 같은 함수를 부른다 — 퇴직이라는 같은 전이를 두 입력 경로가 다르게 처리하지
// 않게. pgxpool.Pool 과 pgx.Tx 가 둘 다 이 두 메서드를 갖는다.
type seatWriter interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// releaseRetiredSeat 는 퇴직 처리된 직원의 열린 좌석 배정을 닫고, 그 좌석을
// available 로 돌리고, 누가·왜 비웠는지 seat_history 에 한 건 남긴다. 좌석 자체는
// 지우지 않고 다른 사람에게 재배정하지도 않는다 — 사람이 되돌릴 수 있는 변경만
// 한다.
//
// 열린 배정이 없으면 아무것도 하지 않고 조용히 돌아온다. 좌석이 없는 직원을
// 퇴직으로 올리는 것은 오류가 아니고, 이미 퇴직이라 자리가 비어 있는 직원을 다시
// 올려도 이력이 늘지 않아야 한다 — 두 경우가 모두 이 길이다.
//
// 세 문장 중 하나가 깨지면 그대로 올린다. 삼키면 "배정은 닫혔는데 좌석이
// occupied" 가 남은 채로 성공이라 보고되고, 트랜잭션 안에서는 어차피 커밋이
// 실패한다.
func releaseRetiredSeat(ctx context.Context, q seatWriter, employeeID string, actorID *string, source string) error {
	var seatID string
	err := q.QueryRow(ctx, `UPDATE seat_assignments SET ended_at=now() WHERE employee_id=$1 AND ended_at IS NULL RETURNING seat_id`, employeeID).Scan(&seatID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err = q.Exec(ctx, `UPDATE seats SET status='available',updated_at=now() WHERE id=$1`, seatID); err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO seat_history(id,employee_id,previous_seat_id,changed_by,reason,source) VALUES($1,$2,$3,$4,'퇴직자 자동 좌석 해제',$5)`, newID(), employeeID, seatID, actorID, source)
	return err
}

// releaseRetiredSeatForRequest 는 요청을 보낸 사람 이름으로 좌석 해제를 돌린다.
// 가져오기는 행마다 독립이 계약이므로 직원 INSERT 까지 한 트랜잭션으로 묶지
// 않고, 해제 세 문장만 짧은 트랜잭션으로 묶는다 — 중간에 깨져도 반쯤 해제된
// 좌석이 남지 않게.
func (s *Server) releaseRetiredSeatForRequest(r *http.Request, employeeID, source string) error {
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var actor *string
	if u, ok := userFrom(r); ok && u.ID != "" {
		actor = &u.ID
	}
	if err := releaseRetiredSeat(ctx, tx, employeeID, actor, source); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// saveEmployee 는 직원 한 명을 저장하는 유일한 길이다. source 는 좌석 해제가
// seat_history 에 남길 방식이고, 호출하는 경로를 그대로 따른다.
func (s *Server) saveEmployee(r *http.Request, in *employeeInput, source string) (string, error) {
	if in.ID == "" {
		_ = s.db.QueryRow(r.Context(), `SELECT id FROM employees WHERE employee_no=$1`, in.EmployeeNo).Scan(&in.ID)
		if in.ID == "" {
			in.ID = newID()
		}
	}
	// 상태는 INSERT 앞에서 가린다. 그대로 넣으면 모르는 값 한 칸이 그 행을
	// employees.status 의 CHECK 위반(migrations.sql:34)으로 떨어뜨리고, 그 pgx
	// 원문이 가져오기의 실패 사유로 화면에 그대로 떠서 관리자는 파일의 무엇을
	// 고쳐야 할지 알 수 없다. 저장하는 길이 한 곳이므로 여기서 한 번만 가린다 —
	// 가져오기와 단건 저장이 같은 값을 다르게 읽지 않게.
	status, err := normalizeEmployeeStatus(in.Status)
	if err != nil {
		return "", err
	}
	in.Status = status
	// 직원을 저장하는 길에서는 조직을 만들지도, 고치지도 않는다. 이미 있는 조직만
	// 찾고 찾지 못하면 그 행을 오류로 되돌린다. 직원 양식과 USER_GUIDE 3.4 절이
	// "조직을 바꿀 때는 조직코드가 있는 양식을 쓰라"고 안내하는데, 예전 분기는
	// 조직명이 있으면 external_id 를 "import:<조직명>" 으로 만들어 넣고
	// ON CONFLICT(external_id) DO UPDATE SET name 까지 했다. 그래서:
	//   - 조직명 없이 조직코드만 적은 행은 소속 없이 저장됐다 — 가져오기는
	//     "반영"이라 보고하면서 직원의 소속을 조용히 지웠다.
	//   - 양식(조직코드·조직명 두 열이 모두 찬 가장 흔한 모양)에 오타 난 조직코드를
	//     적으면 그 코드로 조직이 새로 생기고 직원이 그리로 옮겨졌다.
	//   - 조직코드는 맞고 조직명만 오타인 행 하나가 기존 조직의 이름을 전사적으로
	//     바꿨다. 내보낸 직원목록처럼 조직코드 열이 없는 파일은 이름이 같은 중복
	//     조직을 만들어 파일에 있던 직원 전원의 소속을 옮겼다.
	// 모두 revert 로 돌아오지 않는 DB 변경이다. 조직은 조직 관리
	// (upsertOrganization)와 인사 동기화(runEmployeeSync)에서만 만든다.
	if in.OrganizationID == nil && (in.OrganizationExternalID != "" || in.OrganizationName != "") {
		orgID, err := s.findOrganization(r.Context(), in.OrganizationExternalID, in.OrganizationName)
		if err != nil {
			return "", err
		}
		in.OrganizationID = &orgID
	}
	if _, err = s.db.Exec(r.Context(), `INSERT INTO employees(id,employee_no,name,email,organization_id,title,position,workplace,status) VALUES($1,$2,$3,NULLIF($4,''),$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9) ON CONFLICT(employee_no) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,organization_id=EXCLUDED.organization_id,title=EXCLUDED.title,position=EXCLUDED.position,workplace=EXCLUDED.workplace,status=EXCLUDED.status,updated_at=now()`, in.ID, in.EmployeeNo, in.Name, in.Email, in.OrganizationID, in.Title, in.Position, in.Workplace, in.Status); err != nil {
		return in.ID, err
	}
	// 퇴직은 좌석을 비운다. 인사 동기화(runEmployeeSync)는 같은 전이에서 이미
	// 그렇게 하는데 파일 가져오기와 단건 저장만 employees.status 한 칸을 바꾸고
	// 끝냈다 — 그래서 파일 한 장으로 퇴직 처리한 직원이 좌석맵에 계속 앉아 있고
	// 대시보드의 "퇴직자 좌석"(처리필요에 합산된다)이 올라갔다. 같은 사건을 두
	// 입력 경로가 다르게 처리하는 것이 이 저장소가 반복해서 고쳐 온 어긋남이다.
	if in.Status == "retired" {
		if err := s.releaseRetiredSeatForRequest(r, in.ID, source); err != nil {
			return in.ID, err
		}
	}
	return in.ID, nil
}

func (s *Server) upsertEmployee(w http.ResponseWriter, r *http.Request) {
	var in employeeInput
	if !decodeJSON(w, r, &in) {
		return
	}
	in.EmployeeNo = strings.TrimSpace(in.EmployeeNo)
	in.Name = strings.TrimSpace(in.Name)
	if in.EmployeeNo == "" || in.Name == "" {
		writeError(w, 400, "required_fields", "사번과 이름은 필수입니다")
		return
	}
	id, err := s.saveEmployee(r, &in, "manual")
	if err != nil {
		// 사용자가 고칠 수 있는 값 오류는 어느 값이 문제인지 그대로 돌려준다.
		// 고정 문장으로 덮으면 가져오기 경로에서는 보이는 사유가 단건 저장에서만
		// 사라져 같은 값을 두 길이 다르게 보고한다.
		var input inputError
		if errors.As(err, &input) {
			writeError(w, 400, "invalid_employee", input.Error())
			return
		}
		writeError(w, 409, "employee_conflict", "직원 정보가 중복되었거나 올바르지 않습니다")
		return
	}
	u, _ := userFrom(r)
	s.audit(r.Context(), u.ID, "employee.upsert", "employee", id, r.RemoteAddr, in)
	writeJSON(w, 200, map[string]string{"id": id})
}

func (s *Server) importEmployees(w http.ResponseWriter, r *http.Request) {
	rows, ok := readSpreadsheet(w, r)
	if !ok {
		return
	}
	if len(rows) < 2 {
		writeError(w, 400, "empty_file", "등록할 직원이 없습니다")
		return
	}
	headers := map[string]int{}
	for i, h := range rows[0] {
		headers[strings.ToLower(strings.TrimSpace(h))] = i
	}
	find := func(row []string, names ...string) string {
		for _, name := range names {
			if i, ok := headers[name]; ok && i < len(row) {
				return strings.TrimSpace(row[i])
			}
		}
		return ""
	}
	success := 0
	failures := []map[string]any{}
	for i, row := range rows[1:] {
		in := employeeInput{EmployeeNo: find(row, "employeeno", "employee_no", "사번"), Name: find(row, "name", "이름", "성명"), Email: find(row, "email", "이메일"), OrganizationExternalID: find(row, "organizationid", "organization_id", "조직코드"), OrganizationName: find(row, "organization", "organizationname", "조직명", "부서"), Title: find(row, "title", "직급"), Position: find(row, "position", "직책"), Workplace: find(row, "workplace", "근무지"), Status: find(row, "status", "재직상태")}
		// 어느 행이 왜 걸렸는지 화면이 보여줄 수 있도록 사번도 함께 돌려준다.
		fail := func(reason string) {
			failures = append(failures, map[string]any{"row": i + 2, "employeeNo": in.EmployeeNo, "error": reason})
		}
		if in.EmployeeNo == "" || in.Name == "" {
			fail("사번/이름 누락")
			continue
		}
		// 사용자가 고칠 수 있는 오류(모르는 재직상태·없는 조직코드·중복 조직명)만
		// 문장을 그대로 보여 준다. DB 오류의 원문에는 제약 이름과 SQLSTATE 가 있다.
		if _, err := s.saveEmployee(r, &in, "employee_import"); err != nil {
			fail(userMessage(err, "저장하지 못했습니다"))
		} else {
			success++
		}
	}
	u, _ := userFrom(r)
	s.audit(r.Context(), u.ID, "employee.import", "employee", "", r.RemoteAddr, map[string]int{"success": success, "failed": len(failures)})
	writeJSON(w, 200, map[string]any{"success": success, "failed": len(failures), "failures": failures})
}

// listHistory는 좌석 변경 이력을 조회한다. 감사 목적의 화면이라 사람/좌석
// 검색과 방식·기간 필터가 필요하고, 화면에서 "몇 건 중 몇 건"을 보여줄 수
// 있도록 필터에 걸린 전체 건수도 함께 돌려준다.
//
// from/to 는 시각(RFC3339)으로 받는다. 날짜만 받아 서버 시간대로 해석하면
// 사용자가 자기 시간대 기준으로 고른 "오늘"이 서버에서는 다른 날이 되어
// 방금 만든 기록이 조회되지 않는다. 경계 계산은 사용자의 시간대를 아는
// 브라우저가 맡고, 서버는 받은 구간을 그대로 쓴다. to 는 열린 구간이다.
// 이력 조회 상한. COUNT 를 이 값에서 끊어 감사 테이블이 커져도 전체 스캔이
// 되지 않게 한다. 넘어가면 화면에 "N+"로 보여준다.
const historyCountCap = 5000

// listHistory는 좌석 변경 이력을 조회한다. 감사 목적의 화면이라 사람/좌석
// 검색과 방식·기간 필터가 필요하고, 화면에서 "몇 건 중 몇 건"을 보여줄 수
// 있도록 필터에 걸린 건수도 함께 돌려준다.
//
// from/to 는 시각(RFC3339)으로 받는다. 날짜만 받아 서버 시간대로 해석하면
// 사용자가 자기 시간대 기준으로 고른 "오늘"이 서버에서는 다른 날이 되어
// 방금 만든 기록이 조회되지 않는다. 경계 계산은 사용자의 시간대를 아는
// 브라우저가 맡고, 서버는 받은 구간을 그대로 쓴다. to 는 열린 구간이다.
func (s *Server) listHistory(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if v, _ := strconv.Atoi(r.URL.Query().Get("limit")); v > 0 && v <= 500 {
		limit = v
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	source := strings.TrimSpace(r.URL.Query().Get("source"))
	from := strings.TrimSpace(r.URL.Query().Get("from"))
	to := strings.TrimSpace(r.URL.Query().Get("to"))
	// 시각은 여기서 검증한다. DB 오류로 넘기면 일시적인 장애까지 "조건이 잘못됐다"로
	// 보고하게 된다.
	parseBound := func(value string) (any, bool) {
		if value == "" {
			return nil, true
		}
		at, err := time.Parse(time.RFC3339, value)
		if err != nil {
			return nil, false
		}
		return at, true
	}
	fromAt, okFrom := parseBound(from)
	toAt, okTo := parseBound(to)
	if !okFrom || !okTo {
		writeError(w, http.StatusBadRequest, "invalid_filter", "기간은 RFC3339 시각이어야 합니다")
		return
	}
	// 조건을 실제로 주어진 것만 붙인다. ($n='' OR ...) 형태는 인덱스를 타지 못해
	// 기간을 좁혀도 이력 전체를 훑게 된다.
	conditions := []string{}
	args := []any{}
	add := func(clause string, value any) {
		args = append(args, value)
		conditions = append(conditions, fmt.Sprintf(clause, len(args)))
	}
	if query != "" {
		add(`(e.name ILIKE '%%'||$%[1]d||'%%' OR e.employee_no ILIKE '%%'||$%[1]d||'%%'
			OR ps.seat_no ILIKE '%%'||$%[1]d||'%%' OR ns.seat_no ILIKE '%%'||$%[1]d||'%%')`, query)
	}
	if source != "" {
		add(`h.source=$%d`, source)
	}
	if fromAt != nil {
		add(`h.changed_at >= $%d`, fromAt)
	}
	if toAt != nil {
		add(`h.changed_at < $%d`, toAt)
	}
	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}
	const joins = `FROM seat_history h
	LEFT JOIN employees e ON e.id=h.employee_id
	LEFT JOIN seats ps ON ps.id=h.previous_seat_id
	LEFT JOIN seats ns ON ns.id=h.new_seat_id
	LEFT JOIN users u ON u.id=h.changed_by`
	// 상한까지만 세고 끊는다. 감사 테이블은 계속 쌓이므로 무제한 COUNT 는
	// 화면을 열 때마다 전체 스캔이 된다.
	total := 0
	countArgs := append(append([]any{}, args...), historyCountCap)
	countSQL := fmt.Sprintf(`SELECT count(*) FROM (SELECT 1 %s %s LIMIT $%d) capped`,
		joins, where, len(countArgs))
	if err := s.db.QueryRow(r.Context(), countSQL, countArgs...).Scan(&total); err != nil {
		notFoundOrServer(w, err)
		return
	}
	listArgs := append(append([]any{}, args...), limit)
	listSQL := fmt.Sprintf(`SELECT h.id,h.changed_at,COALESCE(e.employee_no,''),COALESCE(e.name,''),COALESCE(ps.seat_no,''),COALESCE(ns.seat_no,''),COALESCE(u.display_name,'System'),COALESCE(h.reason,''),h.source %s %s ORDER BY h.changed_at DESC LIMIT $%d`,
		joins, where, len(listArgs))
	rows, err := s.db.Query(r.Context(), listSQL, listArgs...)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, employeeNo, name, previous, next, actor, reason, source string
		var changed any
		if rows.Scan(&id, &changed, &employeeNo, &name, &previous, &next, &actor, &reason, &source) == nil {
			items = append(items, map[string]any{"id": id, "changedAt": changed, "employeeNo": employeeNo, "employeeName": name, "previousSeat": previous, "newSeat": next, "actor": actor, "reason": reason, "source": source})
		}
	}
	writeJSON(w, 200, map[string]any{
		"items": items, "total": total, "limit": limit,
		// 상한에 걸리면 화면이 "5000+"처럼 표기할 수 있게 알린다.
		"totalCapped": total >= historyCountCap,
	})
}
