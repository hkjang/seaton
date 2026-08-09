package app

import (
	"net/http"
	"strconv"
	"strings"
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

func (s *Server) saveEmployee(r *http.Request, in *employeeInput) (string, error) {
	if in.ID == "" {
		_ = s.db.QueryRow(r.Context(), `SELECT id FROM employees WHERE employee_no=$1`, in.EmployeeNo).Scan(&in.ID)
		if in.ID == "" {
			in.ID = newID()
		}
	}
	if in.Status == "" {
		in.Status = "active"
	}
	if in.OrganizationID == nil && in.OrganizationName != "" {
		orgID := newID()
		external := in.OrganizationExternalID
		if external == "" {
			external = "import:" + strings.ToLower(strings.ReplaceAll(in.OrganizationName, " ", "-"))
		}
		err := s.db.QueryRow(r.Context(), `INSERT INTO organizations(id,external_id,name) VALUES($1,$2,$3) ON CONFLICT(external_id) DO UPDATE SET name=EXCLUDED.name,updated_at=now() RETURNING id`, orgID, external, in.OrganizationName).Scan(&orgID)
		if err != nil {
			return "", err
		}
		in.OrganizationID = &orgID
	}
	_, err := s.db.Exec(r.Context(), `INSERT INTO employees(id,employee_no,name,email,organization_id,title,position,workplace,status) VALUES($1,$2,$3,NULLIF($4,''),$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9) ON CONFLICT(employee_no) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,organization_id=EXCLUDED.organization_id,title=EXCLUDED.title,position=EXCLUDED.position,workplace=EXCLUDED.workplace,status=EXCLUDED.status,updated_at=now()`, in.ID, in.EmployeeNo, in.Name, in.Email, in.OrganizationID, in.Title, in.Position, in.Workplace, in.Status)
	return in.ID, err
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
	id, err := s.saveEmployee(r, &in)
	if err != nil {
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
		if in.Status == "재직" {
			in.Status = "active"
		} else if in.Status == "휴직" {
			in.Status = "leave"
		} else if in.Status == "퇴직" {
			in.Status = "retired"
		}
		if in.EmployeeNo == "" || in.Name == "" {
			failures = append(failures, map[string]any{"row": i + 2, "error": "사번/이름 누락"})
			continue
		}
		if _, err := s.saveEmployee(r, &in); err != nil {
			failures = append(failures, map[string]any{"row": i + 2, "error": err.Error()})
		} else {
			success++
		}
	}
	u, _ := userFrom(r)
	s.audit(r.Context(), u.ID, "employee.import", "employee", "", r.RemoteAddr, map[string]int{"success": success, "failed": len(failures)})
	writeJSON(w, 200, map[string]any{"success": success, "failed": len(failures), "failures": failures})
}

func (s *Server) listHistory(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if v, _ := strconv.Atoi(r.URL.Query().Get("limit")); v > 0 && v <= 500 {
		limit = v
	}
	rows, err := s.db.Query(r.Context(), `SELECT h.id,h.changed_at,COALESCE(e.employee_no,''),COALESCE(e.name,''),COALESCE(ps.seat_no,''),COALESCE(ns.seat_no,''),COALESCE(u.display_name,'System'),COALESCE(h.reason,''),h.source FROM seat_history h LEFT JOIN employees e ON e.id=h.employee_id LEFT JOIN seats ps ON ps.id=h.previous_seat_id LEFT JOIN seats ns ON ns.id=h.new_seat_id LEFT JOIN users u ON u.id=h.changed_by ORDER BY h.changed_at DESC LIMIT $1`, limit)
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
	writeJSON(w, 200, map[string]any{"items": items})
}
