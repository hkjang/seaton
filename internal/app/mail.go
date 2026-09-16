package app

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hkjang/seaton/internal/mail"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 메일 알림과 앱의 접점.
//
// 어떤 이벤트를 보낼지는 mail 패키지가 모른다. 여기서 "사람이 실제로 기다리는
// 일" 이 생긴 자리마다 받는 사람을 정해 넘기고, 받는 사람의 주소는 users ·
// employees 표에서 빌려 읽는다. 메일이 자기 명부를 갖지 않기 위해서다.

// apiKeyExpiryNotice 는 만료 며칠 전에 알릴지다. 기본 유효기간 90일에 7일이면
// 회전하고 연동을 고칠 시간이 된다.
const apiKeyExpiryNotice = 7 * 24 * time.Hour

// mailDirectory 는 계정 id 와 직원 id 를 주소로 바꾼다. 둘은 서로 다른 표의
// uuid 라 겹치지 않으므로 한 조회에서 같이 찾는다. 계정에 주소가 없으면
// 연결된 직원 레코드의 주소를 쓴다.
type mailDirectory struct{ db *pgxpool.Pool }

func (d mailDirectory) LookupEmails(ctx context.Context, ids []string) (map[string]string, error) {
	rows, err := d.db.Query(ctx, `SELECT u.id, COALESCE(NULLIF(u.email,''), e.email, '') FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.id=ANY($1) AND u.active
		UNION ALL SELECT id, COALESCE(email,'') FROM employees WHERE id=ANY($1) AND status<>'retired'`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	addresses := map[string]string{}
	for rows.Next() {
		var id, email string
		if err := rows.Scan(&id, &email); err != nil {
			return nil, err
		}
		if strings.TrimSpace(email) != "" {
			addresses[id] = strings.TrimSpace(email)
		}
	}
	return addresses, rows.Err()
}

// mailStore 는 발송 기록을 mail_deliveries 에 남긴다.
type mailStore struct{ db *pgxpool.Pool }

func (m mailStore) Insert(ctx context.Context, d mail.Delivery) error {
	_, err := m.db.Exec(ctx, `INSERT INTO mail_deliveries(id,event,recipient,subject,reference,actor_id,status,attempts,created_at,updated_at) VALUES($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7,0,$8,$8)`,
		d.ID, d.Event, d.Recipient, d.Subject, d.Reference, d.ActorID, d.Status, d.CreatedAt)
	return err
}

func (m mailStore) Update(ctx context.Context, id, status string, attempts int, errorMessage string, at time.Time) error {
	_, err := m.db.Exec(ctx, `UPDATE mail_deliveries SET status=$2,attempts=GREATEST(attempts,$3),error_message=NULLIF($4,''),updated_at=$5 WHERE id=$1`, id, status, attempts, errorMessage, at)
	return err
}

func (m mailStore) List(ctx context.Context, status string, limit int) (mail.Page, error) {
	page := mail.Page{Items: []mail.Delivery{}, Summary: mail.Summary{Status: map[string]int{}}}
	rows, err := m.db.Query(ctx, `SELECT id,event,recipient,subject,COALESCE(reference,''),COALESCE(actor_id,''),status,attempts,COALESCE(error_message,''),created_at,updated_at FROM mail_deliveries WHERE ($1='' OR status=$1) ORDER BY created_at DESC, id LIMIT $2`, status, limit)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var item mail.Delivery
		if err := rows.Scan(&item.ID, &item.Event, &item.Recipient, &item.Subject, &item.Reference, &item.ActorID, &item.Status, &item.Attempts, &item.ErrorMessage, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return page, err
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return page, err
	}
	counts, err := m.db.Query(ctx, `SELECT status, count(*) FROM mail_deliveries GROUP BY 1`)
	if err != nil {
		return page, err
	}
	defer counts.Close()
	for counts.Next() {
		var key string
		var count int
		if err := counts.Scan(&key, &count); err != nil {
			return page, err
		}
		page.Summary.Status[key] = count
		page.Summary.Total += count
	}
	return page, counts.Err()
}

// loadMailValues 는 settings 의 mail.* 를 읽는다. 비밀번호는 여기서 풀어
// 릴레이에만 건네고, 로그나 응답에는 어디에도 내지 않는다.
func (s *Server) loadMailValues(ctx context.Context) (map[string]string, error) {
	rows, err := s.db.Query(ctx, `SELECT key,value,secret FROM settings WHERE key LIKE $1`, mail.KeyPrefix+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := map[string]string{}
	for rows.Next() {
		var key, value string
		var secret bool
		if err := rows.Scan(&key, &value, &secret); err != nil {
			return nil, err
		}
		if secret && value != "" {
			if value, err = s.keys.Decrypt(value); err != nil {
				return nil, err
			}
		}
		values[key] = value
	}
	return values, rows.Err()
}

// notifyMail 은 이벤트 메일 한 통을 넘긴다. 부르는 곳은 모두 요청 경로나 배경
// 잡이라 실패가 사용자에게 드러나지 않는다.
func (s *Server) notifyMail(ctx context.Context, notification mail.Notification, actorID string, recipients []string) {
	if s.mail == nil || len(recipients) == 0 {
		return
	}
	s.mail.Notify(context.WithoutCancel(ctx), notification, actorID, recipients)
}

// adminIDs 는 활성 시스템 관리자 전원이다. 새벽에 실패한 예약 작업은 이들이
// 알아야 한다.
func (s *Server) adminIDs(ctx context.Context) []string {
	rows, err := s.db.Query(ctx, `SELECT id FROM users WHERE role='system_admin' AND active`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

// notifySeatAssigned 는 자리가 정해진 직원에게 알린다. 이전 자리와 새 자리는
// 방금 남긴 이력에서 읽는다.
func (s *Server) notifySeatAssigned(ctx context.Context, actorID, employeeID, seatID, reason string) {
	if s.mail == nil {
		return
	}
	var name string
	var seat, previous mail.SeatPlace
	var previousSeatNo *string
	err := s.db.QueryRow(ctx, `SELECT e.name, s.seat_no, COALESCE(f.name,''), COALESCE(b.name,''),
		(SELECT p.seat_no FROM seat_history h JOIN seats p ON p.id=h.previous_seat_id WHERE h.employee_id=e.id AND h.new_seat_id=s.id ORDER BY h.changed_at DESC LIMIT 1)
		FROM employees e, seats s JOIN floor_maps m ON m.id=s.floor_map_id LEFT JOIN floors f ON f.id=m.floor_id LEFT JOIN buildings b ON b.id=f.building_id
		WHERE e.id=$1 AND s.id=$2`, employeeID, seatID).Scan(&name, &seat.SeatNo, &seat.Floor, &seat.Building, &previousSeatNo)
	if err != nil {
		return
	}
	var from *mail.SeatPlace
	if previousSeatNo != nil {
		previous.SeatNo = *previousSeatNo
		from = &previous
	}
	notification := mail.SeatAssigned(name, seat, from, reason)
	notification.Reference = seatID
	s.notifyMail(ctx, notification, actorID, []string{employeeID})
}

// notifyAnalysisFinished 는 분석 잡의 최종 상태를 읽어 요청한 사람에게 알린다.
// runAnalysis 의 끝에서 한 번 부르므로 실패 경로가 몇 갈래든 빠지지 않는다.
func (s *Server) notifyAnalysisFinished(ctx context.Context, jobID, mapID, actorID string) {
	if s.mail == nil || actorID == "" {
		return
	}
	var status, engine, failure, floor, version string
	var detected, review int
	err := s.db.QueryRow(ctx, `SELECT j.status, j.engine, COALESCE(j.error,''), j.detected_count, j.review_count, COALESCE(f.name,''), m.version
		FROM analysis_jobs j JOIN floor_maps m ON m.id=j.floor_map_id LEFT JOIN floors f ON f.id=m.floor_id WHERE j.id=$1`, jobID).
		Scan(&status, &engine, &failure, &detected, &review, &floor, &version)
	if err != nil || (status != "completed" && status != "failed") {
		return
	}
	label := strings.TrimSpace(floor + " " + version)
	if status == "completed" {
		failure = ""
	} else if failure == "" {
		failure = "분석에 실패했습니다"
	}
	notification := mail.AnalysisFinished(label, engine, detected, review, failure)
	notification.Reference = mapID
	// 분석은 요청한 사람이 기다리는 결과라 행위자를 빼지 않는다.
	s.notifyMail(ctx, notification, "", []string{actorID})
}

// notifyHRSyncFailed 는 예약 인사 연동 실패를 관리자 전원에게 알린다. 화면에서
// 누른 동기화는 결과가 그 자리에 보이므로 부르지 않는다.
func (s *Server) notifyHRSyncFailed(ctx context.Context, cause error) {
	if s.mail == nil || cause == nil {
		return
	}
	s.notifyMail(ctx, mail.HRSyncFailed(cause.Error(), time.Now()), "", s.adminIDs(ctx))
}

// notifyExpiringAPIKeys 는 만료가 7일 안으로 다가온 개인 키의 소유자에게
// 사람마다 한 통씩 알린다. 알린 키는 표시해 두어 다음 회차에 다시 보내지
// 않는다. 메일이 꺼져 있으면 표시도 하지 않아, 켠 뒤 첫 회차에 나간다.
func (s *Server) notifyExpiringAPIKeys(ctx context.Context) {
	if s.mail == nil {
		return
	}
	config, err := s.mail.Config(ctx)
	if err != nil || !config.Enabled || !config.Allows(mail.EventAPIKeyExpiring) {
		return
	}
	rows, err := s.db.Query(ctx, `SELECT id,user_id,name,prefix,expires_at FROM api_keys
		WHERE revoked_at IS NULL AND expiry_notified_at IS NULL AND expires_at IS NOT NULL AND expires_at > now() AND expires_at <= now() + $1::interval ORDER BY user_id, expires_at`,
		strconv.Itoa(int(apiKeyExpiryNotice.Hours()))+" hours")
	if err != nil {
		s.logger.Warn("만료 임박 키를 읽지 못했습니다", "error", err)
		return
	}
	defer rows.Close()
	byUser := map[string][]mail.ExpiringKey{}
	order := []string{}
	ids := []string{}
	for rows.Next() {
		var id, userID string
		var key mail.ExpiringKey
		if err := rows.Scan(&id, &userID, &key.Name, &key.Prefix, &key.ExpiresAt); err != nil {
			continue
		}
		if _, seen := byUser[userID]; !seen {
			order = append(order, userID)
		}
		byUser[userID] = append(byUser[userID], key)
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) == 0 {
		return
	}
	if _, err := s.db.Exec(ctx, `UPDATE api_keys SET expiry_notified_at=now() WHERE id=ANY($1)`, ids); err != nil {
		s.logger.Warn("만료 임박 안내 표시를 남기지 못했습니다", "error", err)
		return
	}
	for _, userID := range order {
		notification := mail.APIKeysExpiring(byUser[userID])
		notification.Reference = userID
		s.notifyMail(ctx, notification, "", []string{userID})
	}
}

func (s *Server) listMailDeliveries(w http.ResponseWriter, r *http.Request) {
	if s.mail == nil {
		writeJSON(w, http.StatusOK, mail.Page{Items: []mail.Delivery{}, Summary: mail.Summary{Status: map[string]int{}}})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	page, err := s.mail.Deliveries(r.Context(), r.URL.Query().Get("status"), limit)
	if err != nil {
		notFoundOrServer(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// sendTestMail 은 저장된 설정으로 실제 한 통을 보내고 결과를 그 자리에서
// 돌려준다. 릴레이 설정은 한 번에 맞는 일이 드물다.
func (s *Server) sendTestMail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Recipient string `json:"recipient"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if s.mail == nil {
		writeError(w, http.StatusServiceUnavailable, "mail_unavailable", "메일 서비스가 준비되지 않았습니다")
		return
	}
	u, _ := userFrom(r)
	recipient := strings.TrimSpace(in.Recipient)
	if recipient == "" {
		recipient = strings.TrimSpace(u.Email)
	}
	if !strings.Contains(recipient, "@") || strings.ContainsAny(recipient, " \r\n<>,") {
		writeError(w, http.StatusBadRequest, "invalid_recipient", "받는 사람 메일 주소를 입력하세요")
		return
	}
	if err := s.mail.SendNow(r.Context(), mail.TestMessage(), u.ID, recipient); err != nil {
		code, status := "mail_send_failed", http.StatusBadGateway
		if errors.Is(err, mail.ErrDisabled) || errors.Is(err, mail.ErrInvalid) {
			code, status = "mail_config_invalid", http.StatusBadRequest
		}
		writeError(w, status, code, err.Error())
		return
	}
	s.audit(r.Context(), u.ID, "mail.test", "settings", "", r.RemoteAddr, map[string]string{"recipient": recipient})
	writeJSON(w, http.StatusOK, map[string]any{"sent": true, "recipient": recipient})
}
