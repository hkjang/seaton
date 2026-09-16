package mail

import (
	"fmt"
	"mime"
	"strings"
	"time"
)

// compose 는 MIME 메시지를 만든다. 한글 제목과 본문은 UTF-8 헤더를 모르는
// 릴레이와 클라이언트에서도 제대로 보이도록 인코딩한다.
func compose(config Config, message Message) string {
	var builder strings.Builder
	builder.WriteString("From: " + encodeAddress(config.Address()) + "\r\n")
	builder.WriteString("To: " + message.To + "\r\n")
	builder.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", message.Subject) + "\r\n")
	builder.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	builder.WriteString("MIME-Version: 1.0\r\n")
	builder.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	builder.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	builder.WriteString("Auto-Submitted: auto-generated\r\n")
	builder.WriteString("X-SeatOn-Notification: 1\r\n")
	builder.WriteString("\r\n")
	builder.WriteString(normalizeBody(message.Body))
	return builder.String()
}

func encodeAddress(address string) string {
	open := strings.LastIndex(address, "<")
	if open <= 0 {
		return address
	}
	return mime.QEncoding.Encode("utf-8", strings.TrimSpace(address[:open])) + " " + address[open:]
}

// normalizeBody 는 줄 끝을 CRLF 로 맞춘다. 줄 머리의 점은 여기서 건드리지
// 않는다 — smtp.Client.Data 가 돌려주는 writer 가 이미 점을 채워 넣으므로
// 한 번 더 하면 받는 쪽에 점이 두 개 남는다.
func normalizeBody(body string) string {
	body = strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\n", "\r\n")
	if !strings.HasSuffix(body, "\r\n") {
		body += "\r\n"
	}
	return body
}

// Notification 은 받는 사람이 정해지기 전의 이벤트 메일 한 통이다.
type Notification struct {
	Event   string
	Subject string
	Lines   []string
	// Link 는 메일 속 "바로 열기" 가 가리킬 이 앱의 경로("/admin/maps") 또는
	// 절대 주소다. 경로는 mail.base_url 이 있을 때만 붙는다.
	Link string
	// Reference 는 기록에 남길 대상 식별자(도면 id, 좌석 id 등)다.
	Reference string
}

// Render 는 본문을 만든다. 링크와 왜 이 메일이 왔는지 말하는 꼬리를 붙인다.
func (n Notification) Render(config Config) string {
	lines := append([]string{}, n.Lines...)
	if link := n.absoluteLink(config); link != "" {
		lines = append(lines, "", "바로 열기: "+link)
	}
	lines = append(lines, "", "—", "이 메일은 SeatOn 알림 설정에 따라 자동으로 발송되었습니다. 받고 싶지 않으면 시스템 관리자에게 알려 주세요.")
	return strings.Join(lines, "\n")
}

func (n Notification) absoluteLink(config Config) string {
	if n.Link == "" {
		return ""
	}
	if strings.HasPrefix(n.Link, "http://") || strings.HasPrefix(n.Link, "https://") {
		return n.Link
	}
	base := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if base == "" {
		return ""
	}
	return base + "/" + strings.TrimLeft(n.Link, "/")
}

// SeatPlace 는 메일에 적을 자리 하나다.
type SeatPlace struct {
	SeatNo   string
	Floor    string
	Building string
}

func (p SeatPlace) String() string {
	parts := []string{}
	for _, part := range []string{p.Building, p.Floor} {
		if strings.TrimSpace(part) != "" {
			parts = append(parts, strings.TrimSpace(part))
		}
	}
	where := strings.Join(parts, " ")
	if where == "" {
		return p.SeatNo
	}
	return where + " " + p.SeatNo
}

// SeatAssigned 는 직원에게 자리가 정해졌다고 알린다. 이사 날 이 메일이 없으면
// 사람들은 좌석맵을 새로고침하거나 관리자에게 묻는다.
func SeatAssigned(employeeName string, seat SeatPlace, previous *SeatPlace, reason string) Notification {
	lines := []string{fmt.Sprintf("%s 님의 자리가 %s(으)로 정해졌습니다.", employeeName, seat)}
	if previous != nil {
		lines = []string{fmt.Sprintf("%s 님의 자리가 %s에서 %s(으)로 옮겨졌습니다.", employeeName, *previous, seat)}
	}
	if strings.TrimSpace(reason) != "" {
		lines = append(lines, fmt.Sprintf("사유: %s", strings.TrimSpace(reason)))
	}
	return Notification{
		Event:   EventSeatAssigned,
		Subject: fmt.Sprintf("[SeatOn] 자리가 정해졌습니다 — %s", seat),
		Lines:   lines,
		Link:    "/",
	}
}

// AnalysisFinished 는 요청한 사람에게 도면 분석이 끝났다고 알린다. 비전 모델
// 판독은 몇 분씩 걸려 화면을 떠나기 마련이고, 실패로 멈춘 것은 더더욱
// 알아야 한다.
func AnalysisFinished(mapLabel, engine string, detected, review int, failure string) Notification {
	if strings.TrimSpace(failure) != "" {
		return Notification{
			Event:   EventAnalysisFinished,
			Subject: fmt.Sprintf("[SeatOn] 도면 분석 실패 — %s", mapLabel),
			Lines: []string{
				fmt.Sprintf("'%s' 도면 분석(%s)이 실패했습니다.", mapLabel, engine),
				fmt.Sprintf("이유: %s", strings.TrimSpace(failure)),
				"",
				"도면은 다시 분석할 수 있는 상태로 돌아갔습니다.",
			},
			Link: "/admin/maps",
		}
	}
	return Notification{
		Event:   EventAnalysisFinished,
		Subject: fmt.Sprintf("[SeatOn] 도면 분석 완료 — %s", mapLabel),
		Lines: []string{
			fmt.Sprintf("'%s' 도면 분석(%s)이 끝났습니다.", mapLabel, engine),
			fmt.Sprintf("찾은 좌석 %d개, 검토 필요 %d개.", detected, review),
			"",
			"도면 관리에서 검토하고 게시하세요.",
		},
		Link: "/admin/maps",
	}
}

// HRSyncFailed 는 예약된 인사 연동이 실패했다고 관리자에게 알린다. 새벽에
// 조용히 실패하면 명부가 낡은 채 며칠이 간다.
func HRSyncFailed(failure string, at time.Time) Notification {
	return Notification{
		Event:   EventHRSyncFailed,
		Subject: "[SeatOn] 예약 인사 연동 실패",
		Lines: []string{
			fmt.Sprintf("%s에 예약된 인사 연동이 실패했습니다.", at.Local().Format("2006-01-02 15:04")),
			fmt.Sprintf("이유: %s", strings.TrimSpace(failure)),
			"",
			"직원 명부가 갱신되지 않았습니다. 시스템 설정 → 인사 연동에서 주소와 토큰을 확인하고 '저장 후 지금 동기화' 로 다시 시도하세요.",
		},
		Link: "/admin/settings",
	}
}

// ExpiringKey 는 만료가 다가온 개인 API 키 하나다.
type ExpiringKey struct {
	Name      string
	Prefix    string
	ExpiresAt time.Time
}

// APIKeysExpiring 은 키 소유자에게 만료가 다가왔다고 알린다. 한 사람의 키가
// 여럿이면 한 통에 묶는다.
func APIKeysExpiring(keys []ExpiringKey) Notification {
	lines := []string{"다음 개인 API 키가 곧 만료됩니다. 만료되면 그 키를 쓰는 연동이 멈춥니다."}
	lines = append(lines, "")
	for _, key := range keys {
		lines = append(lines, fmt.Sprintf("- %s (%s…) — %s 만료", key.Name, key.Prefix, key.ExpiresAt.Local().Format("2006-01-02")))
	}
	lines = append(lines, "", "내 API 키 화면에서 키를 회전하면 새 키가 발급되고 옛 키는 유예 시간 뒤에 멈춥니다.")
	subject := "[SeatOn] API 키 만료 임박"
	if len(keys) == 1 {
		subject = fmt.Sprintf("[SeatOn] API 키 '%s' 만료 임박", keys[0].Name)
	}
	return Notification{Event: EventAPIKeyExpiring, Subject: subject, Lines: lines, Link: "/profile/keys"}
}

// TestMessage 는 관리자 화면에서 릴레이가 동작하는지 증명한다.
func TestMessage() Notification {
	return Notification{
		Event:   EventTest,
		Subject: "[SeatOn] SMTP 발송 시험",
		Lines:   []string{"SeatOn 관리자 화면에서 보낸 시험 메일입니다.", "이 메일을 받았다면 SMTP 설정이 정상입니다."},
	}
}
