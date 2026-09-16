package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/hkjang/seaton/internal/mail"
)

// 관리자 화면의 시험 발송과 발송 기록 조회를 데이터베이스 없이 확인한다.
// 릴레이는 가짜 전송으로 대신하고, 기록은 메모리에 남긴다.

type sentMessage struct{ To, Subject string }

func mailServer(t *testing.T, values map[string]string, fail error) (*Server, *[]sentMessage) {
	t.Helper()
	s := NewServer(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, "test", "test", "test")
	var sent []sentMessage
	var mu sync.Mutex
	counter := 0
	service := mail.NewService(mail.NewMemoryStore(), func(context.Context) (map[string]string, error) { return values, nil }, nil,
		func() string { counter++; return "id" + string(rune('0'+counter)) }, s.logger)
	service.SetSender(func(_ context.Context, _ mail.Config, message mail.Message) error {
		mu.Lock()
		defer mu.Unlock()
		sent = append(sent, sentMessage{To: message.To, Subject: message.Subject})
		return fail
	})
	s.mail = service
	return s, &sent
}

func asAdmin(request *http.Request) *http.Request {
	return request.WithContext(context.WithValue(request.Context(), userContextKey, User{ID: "admin-1", Username: "admin", Email: "admin@example.test", Role: "system_admin"}))
}

func postTestMail(s *Server, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := asAdmin(httptest.NewRequest(http.MethodPost, "/api/v1/settings/mail/test", strings.NewReader(body)))
	s.sendTestMail(recorder, request)
	return recorder
}

var enabledMail = map[string]string{"mail.enabled": "true", "mail.smtp_host": "relay.intra", "mail.from_address": "seaton@example.test"}

func TestTestMailRejectsWhenDisabledOrIncomplete(t *testing.T) {
	s, sent := mailServer(t, map[string]string{"mail.enabled": "false", "mail.smtp_host": "relay.intra"}, nil)
	response := postTestMail(s, `{"recipient":"kim@example.test"}`)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "mail_config_invalid") {
		t.Fatalf("꺼져 있으면 400 mail_config_invalid: %d %s", response.Code, response.Body.String())
	}
	s, sent = mailServer(t, map[string]string{"mail.enabled": "true"}, nil)
	response = postTestMail(s, `{"recipient":"kim@example.test"}`)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "mail.smtp_host") {
		t.Fatalf("호스트가 없으면 이유를 말해야 한다: %d %s", response.Code, response.Body.String())
	}
	if len(*sent) != 0 {
		t.Fatal("보내지 않아야 한다")
	}
}

func TestTestMailValidatesRecipient(t *testing.T) {
	s, _ := mailServer(t, enabledMail, nil)
	for _, body := range []string{`{"recipient":"not-an-address"}`, `{"recipient":"a@b.test, c@d.test"}`, `{"recipient":"a@b.test\r\nBcc: x@y.test"}`} {
		if response := postTestMail(s, body); response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_recipient") {
			t.Fatalf("%s → %d %s", body, response.Code, response.Body.String())
		}
	}
}

func TestTestMailReportsRelayFailureAndRecordsIt(t *testing.T) {
	s, sent := mailServer(t, enabledMail, errors.New("SMTP 연결 실패: dial tcp: connection refused"))
	response := postTestMail(s, `{"recipient":"kim@example.test"}`)
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "mail_send_failed") || !strings.Contains(response.Body.String(), "connection refused") {
		t.Fatalf("릴레이 실패는 502 와 이유: %d %s", response.Code, response.Body.String())
	}
	if len(*sent) != 1 || (*sent)[0].To != "kim@example.test" {
		t.Fatalf("한 번 시도해야 한다: %+v", *sent)
	}
	recorder := httptest.NewRecorder()
	s.listMailDeliveries(recorder, asAdmin(httptest.NewRequest(http.MethodGet, "/api/v1/settings/mail/deliveries?status=failed", nil)))
	var page mail.Page
	if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Status != mail.StatusFailed || page.Items[0].Recipient != "kim@example.test" || page.Items[0].Event != mail.EventTest || page.Items[0].ActorID != "admin-1" {
		t.Fatalf("실패가 기록되어야 한다: %+v", page)
	}
	if !strings.Contains(page.Items[0].ErrorMessage, "connection refused") || page.Summary.Status[mail.StatusFailed] != 1 {
		t.Fatalf("이유와 요약: %+v", page)
	}
	// 기록에는 본문이 없다. 제목과 수신자면 충분하다.
	if strings.Contains(recorder.Body.String(), "body") || strings.Contains(recorder.Body.String(), "시험 메일입니다") {
		t.Fatalf("기록에 본문이 들어가면 안 된다: %s", recorder.Body.String())
	}
}

func TestTestMailDefaultsToAdminAddress(t *testing.T) {
	s, sent := mailServer(t, enabledMail, nil)
	response := postTestMail(s, `{"recipient":""}`)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"recipient":"admin@example.test"`) {
		t.Fatalf("%d %s", response.Code, response.Body.String())
	}
	if len(*sent) != 1 || (*sent)[0].To != "admin@example.test" || (*sent)[0].Subject != "[SeatOn] SMTP 발송 시험" {
		t.Fatalf("비어 있으면 관리자 자신에게: %+v", *sent)
	}
}

func TestMailDeliveriesWithoutServiceIsEmpty(t *testing.T) {
	s := NewServer(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), nil, "test", "test", "test")
	recorder := httptest.NewRecorder()
	s.listMailDeliveries(recorder, asAdmin(httptest.NewRequest(http.MethodGet, "/api/v1/settings/mail/deliveries", nil)))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"items":[]`) {
		t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
	}
}
