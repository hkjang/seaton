package mail

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeRelay 는 인증도 TLS 도 없는 사내 릴레이의 최소 흉내다. 받은 봉투와
// 본문을 그대로 기억한다.
type fakeRelay struct {
	listener net.Listener
	mu       sync.Mutex
	from     string
	to       []string
	data     string
	reject   bool
}

func newFakeRelay(t *testing.T) *fakeRelay {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	relay := &fakeRelay{listener: listener}
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go relay.serve(connection)
		}
	}()
	t.Cleanup(func() { _ = listener.Close() })
	return relay
}

func (r *fakeRelay) addr() (string, int) {
	address := r.listener.Addr().(*net.TCPAddr)
	return address.IP.String(), address.Port
}

func (r *fakeRelay) serve(connection net.Conn) {
	defer connection.Close()
	reader := bufio.NewReader(connection)
	reply := func(line string) { _, _ = io.WriteString(connection, line+"\r\n") }
	reply("220 relay.test ESMTP")
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		upper := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(upper, "EHLO"):
			reply("250-relay.test")
			reply("250 SIZE 10485760")
		case strings.HasPrefix(upper, "HELO"):
			reply("250 relay.test")
		case strings.HasPrefix(upper, "MAIL FROM:"):
			r.mu.Lock()
			r.from = strings.Trim(line[len("MAIL FROM:"):], "<> ")
			r.mu.Unlock()
			reply("250 OK")
		case strings.HasPrefix(upper, "RCPT TO:"):
			if r.reject {
				reply("550 no such user")
				continue
			}
			r.mu.Lock()
			r.to = append(r.to, strings.Trim(line[len("RCPT TO:"):], "<> "))
			r.mu.Unlock()
			reply("250 OK")
		case upper == "DATA":
			reply("354 go ahead")
			var body strings.Builder
			for {
				part, err := reader.ReadString('\n')
				if err != nil {
					return
				}
				if part == ".\r\n" {
					break
				}
				body.WriteString(part)
			}
			r.mu.Lock()
			r.data = body.String()
			r.mu.Unlock()
			reply("250 queued")
		case upper == "QUIT":
			reply("221 bye")
			return
		default:
			reply("250 OK")
		}
	}
}

func relayConfig(relay *fakeRelay) Config {
	host, port := relay.addr()
	return ReadConfig(map[string]string{
		"mail.enabled": "true", "mail.smtp_host": host, "mail.smtp_port": fmt.Sprint(port),
		"mail.from_address": "seaton@example.test", "mail.from_name": "SeatOn 알림",
	})
}

func TestDeliverThroughPlainRelay(t *testing.T) {
	relay := newFakeRelay(t)
	config := relayConfig(relay)
	err := Deliver(context.Background(), config, Message{To: "kim@example.test", Subject: "자리가 정해졌습니다", Body: "첫 줄\n.점으로 시작하는 줄\n"})
	if err != nil {
		t.Fatalf("보내지 못했다: %v", err)
	}
	relay.mu.Lock()
	defer relay.mu.Unlock()
	if relay.from != "seaton@example.test" || len(relay.to) != 1 || relay.to[0] != "kim@example.test" {
		t.Fatalf("봉투가 다르다: from=%q to=%v", relay.from, relay.to)
	}
	if !strings.Contains(relay.data, "Subject: =?utf-8?q?") {
		t.Fatalf("한글 제목이 인코딩되지 않았다:\n%s", relay.data)
	}
	// 전송 중에는 점이 한 번만 채워져야 한다. 릴레이가 하나를 벗기면 원문이 된다.
	if !strings.Contains(relay.data, "\r\n..점으로 시작하는 줄\r\n") || strings.Contains(relay.data, "...점") {
		t.Fatalf("줄 머리의 점이 정확히 한 번 채워져야 한다:\n%s", relay.data)
	}
	if !strings.Contains(relay.data, "From: =?utf-8?q?SeatOn_=EC=95=8C=EB=A6=BC?= <seaton@example.test>") {
		t.Fatalf("보내는 사람 이름이 인코딩되지 않았다:\n%s", relay.data)
	}
}

func TestDeliverReportsRelayRefusal(t *testing.T) {
	relay := newFakeRelay(t)
	relay.reject = true
	err := Deliver(context.Background(), relayConfig(relay), Message{To: "nobody@example.test", Subject: "x", Body: "y"})
	if err == nil || !strings.Contains(err.Error(), "RCPT TO 실패") {
		t.Fatalf("거부가 오류로 돌아와야 한다: %v", err)
	}
}

func TestDeliverFailsFastWhenRelayIsDown(t *testing.T) {
	listener, _ := net.Listen("tcp", "127.0.0.1:0")
	host, port := listener.Addr().(*net.TCPAddr).IP.String(), listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	config := ReadConfig(map[string]string{"mail.smtp_host": host, "mail.smtp_port": fmt.Sprint(port), "mail.from_address": "a@b.test", "mail.timeout_seconds": "1"})
	started := time.Now()
	err := Deliver(context.Background(), config, Message{To: "x@y.test", Subject: "x", Body: "y"})
	if err == nil || !strings.Contains(err.Error(), "SMTP 연결 실패") {
		t.Fatalf("죽은 릴레이는 연결 실패여야 한다: %v", err)
	}
	if time.Since(started) > 5*time.Second {
		t.Fatalf("죽은 릴레이에 너무 오래 매달렸다: %s", time.Since(started))
	}
}

func TestReadConfigDefaultsMatchInternalRelay(t *testing.T) {
	config := ReadConfig(map[string]string{"mail.smtp_host": "relay.intra"})
	if config.Enabled {
		t.Fatal("기본은 꺼짐이어야 한다")
	}
	if config.Port != 25 || config.Security != "auto" || config.Timeout != 10*time.Second || config.SkipVerify {
		t.Fatalf("기본값이 사내 릴레이와 다르다: %+v", config)
	}
	if config.FromAddress != "seaton@relay.intra" || config.FromName != "SeatOn" {
		t.Fatalf("보내는 사람 기본값: %q %q", config.FromAddress, config.FromName)
	}
	if !config.Allows(EventSeatAssigned) || !config.Allows("unknown.event") {
		t.Fatal("스위치를 두지 않은 이벤트는 보내야 한다")
	}
	off := ReadConfig(map[string]string{"mail.notify_seat_assigned": "false", "mail.smtp_port": "465"})
	if off.Allows(EventSeatAssigned) || !off.Allows(EventAnalysisFinished) {
		t.Fatal("이벤트 스위치를 끄면 그 종류만 멎어야 한다")
	}
	if off.Security != "tls" {
		t.Fatalf("465 포트는 암시적 TLS 여야 한다: %s", off.Security)
	}
}

func TestValidateExplainsMissingHost(t *testing.T) {
	err := ReadConfig(map[string]string{"mail.enabled": "true"}).Validate()
	if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "mail.smtp_host") {
		t.Fatalf("호스트 없음이 이유와 함께 돌아와야 한다: %v", err)
	}
	if err := ReadConfig(map[string]string{"mail.smtp_host": "h", "mail.from_address": "a@b", "mail.security": "ssl"}).Validate(); !errors.Is(err, ErrInvalid) {
		t.Fatalf("잘못된 security 값: %v", err)
	}
}

// --- 서비스 ---

type fakeDirectory map[string]string

func (d fakeDirectory) LookupEmails(_ context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	for _, id := range ids {
		if email, ok := d[id]; ok {
			out[id] = email
		}
	}
	return out, nil
}

type sentMail struct {
	To      string
	Subject string
	Body    string
}

func newTestService(values map[string]string, directory Directory, sender func(context.Context, Config, Message) error) (*Service, *MemoryStore) {
	store := NewMemoryStore()
	counter := 0
	service := NewService(store, func(context.Context) (map[string]string, error) { return values, nil }, directory,
		func() string { counter++; return fmt.Sprintf("d%d", counter) }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	service.SetSender(sender)
	return service, store
}

func recordingSender(sent *[]sentMail, mu *sync.Mutex, fail error) func(context.Context, Config, Message) error {
	return func(_ context.Context, _ Config, message Message) error {
		mu.Lock()
		defer mu.Unlock()
		*sent = append(*sent, sentMail{To: message.To, Subject: message.Subject, Body: message.Body})
		return fail
	}
}

var enabledValues = map[string]string{"mail.enabled": "true", "mail.smtp_host": "relay.intra", "mail.from_address": "seaton@example.test", "mail.base_url": "https://seaton.intra/"}

func TestNotifySendsNothingWhenDisabled(t *testing.T) {
	var sent []sentMail
	var mu sync.Mutex
	for _, values := range []map[string]string{{}, {"mail.enabled": "false", "mail.smtp_host": "relay.intra"}} {
		service, store := newTestService(values, fakeDirectory{"u1": "kim@example.test"}, recordingSender(&sent, &mu, nil))
		service.Notify(context.Background(), TestMessage(), "", []string{"u1"})
		service.Wait()
		if len(sent) != 0 {
			t.Fatal("꺼져 있으면 아무것도 보내지 않아야 한다")
		}
		if page, _ := store.List(context.Background(), "", 10); page.Summary.Total != 0 {
			t.Fatal("꺼져 있으면 기록도 남기지 않아야 한다")
		}
	}
}

func TestNotifySendsNothingWhenHostMissing(t *testing.T) {
	var sent []sentMail
	var mu sync.Mutex
	service, _ := newTestService(map[string]string{"mail.enabled": "true"}, fakeDirectory{"u1": "kim@example.test"}, recordingSender(&sent, &mu, nil))
	service.Notify(context.Background(), TestMessage(), "", []string{"u1"})
	service.Wait()
	if len(sent) != 0 {
		t.Fatal("호스트가 없으면 켜도 보내지 않아야 한다")
	}
}

func TestNotifySkipsActorAndDuplicates(t *testing.T) {
	var sent []sentMail
	var mu sync.Mutex
	// 관리자 계정(u1)과 그 사람의 직원 레코드(e1)는 id 가 다르지만 주소가 같다.
	directory := fakeDirectory{"u1": "admin@example.test", "e1": "Admin@example.test", "e2": "kim@example.test", "e3": "kim@example.test"}
	service, store := newTestService(enabledValues, directory, recordingSender(&sent, &mu, nil))
	service.Notify(context.Background(), SeatAssigned("김개발", SeatPlace{SeatNo: "A-01"}, nil, ""), "u1", []string{"e1", "e2", "e3", "u1", "nobody"})
	service.Wait()
	if len(sent) != 1 || sent[0].To != "kim@example.test" {
		t.Fatalf("자기 자신과 중복은 빠져야 한다: %+v", sent)
	}
	page, _ := store.List(context.Background(), "", 10)
	if page.Summary.Total != 1 || page.Items[0].Status != StatusSent || page.Items[0].Attempts != 1 {
		t.Fatalf("성공이 기록되어야 한다: %+v", page)
	}
	if strings.Contains(page.Items[0].Subject, "김개발") == false && !strings.Contains(sent[0].Body, "김개발") {
		t.Fatalf("본문이 비었다: %+v", sent[0])
	}
	if !strings.Contains(sent[0].Body, "바로 열기: https://seaton.intra/") {
		t.Fatalf("base_url 로 링크가 붙어야 한다:\n%s", sent[0].Body)
	}
}

func TestEventSwitchStopsOnlyThatKind(t *testing.T) {
	var sent []sentMail
	var mu sync.Mutex
	values := map[string]string{"mail.notify_analysis": "false"}
	for key, value := range enabledValues {
		values[key] = value
	}
	service, _ := newTestService(values, fakeDirectory{"u1": "kim@example.test"}, recordingSender(&sent, &mu, nil))
	service.Notify(context.Background(), AnalysisFinished("3층 v2", "cv", 10, 2, ""), "", []string{"u1"})
	service.Notify(context.Background(), HRSyncFailed("연결 실패", time.Now()), "", []string{"u1"})
	service.Wait()
	if len(sent) != 1 || sent[0].Subject != "[SeatOn] 예약 인사 연동 실패" {
		t.Fatalf("끈 종류만 멎어야 한다: %+v", sent)
	}
}

func TestFailedDeliveryIsRecordedAndRetriedOnce(t *testing.T) {
	var sent []sentMail
	var mu sync.Mutex
	service, store := newTestService(enabledValues, fakeDirectory{"u1": "kim@example.test"}, recordingSender(&sent, &mu, errors.New("SMTP 연결 실패: connection refused")))
	started := time.Now()
	service.Notify(context.Background(), TestMessage(), "", []string{"u1"})
	if time.Since(started) > time.Second {
		t.Fatal("Notify 는 릴레이를 기다리면 안 된다")
	}
	service.Wait()
	if len(sent) != 2 {
		t.Fatalf("한 번 더 시도해야 한다: %d", len(sent))
	}
	page, _ := store.List(context.Background(), StatusFailed, 10)
	if len(page.Items) != 1 || page.Items[0].Attempts != 2 || !strings.Contains(page.Items[0].ErrorMessage, "connection refused") {
		t.Fatalf("실패가 이유와 함께 기록되어야 한다: %+v", page.Items)
	}
	if page.Summary.Status[StatusFailed] != 1 {
		t.Fatalf("요약이 다르다: %+v", page.Summary)
	}
}

func TestSendNowReportsOutcome(t *testing.T) {
	var sent []sentMail
	var mu sync.Mutex
	service, store := newTestService(map[string]string{"mail.enabled": "false"}, nil, recordingSender(&sent, &mu, nil))
	if err := service.SendNow(context.Background(), TestMessage(), "u1", "kim@example.test"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("꺼져 있으면 ErrDisabled: %v", err)
	}
	service, store = newTestService(enabledValues, nil, recordingSender(&sent, &mu, nil))
	if err := service.SendNow(context.Background(), TestMessage(), "u1", "kim@example.test"); err != nil {
		t.Fatal(err)
	}
	page, _ := store.List(context.Background(), "", 10)
	if len(page.Items) != 1 || page.Items[0].Status != StatusSent || page.Items[0].Event != EventTest || page.Items[0].ActorID != "u1" {
		t.Fatalf("시험 발송도 기록되어야 한다: %+v", page.Items)
	}
}

func TestAPIKeysExpiringBundlesIntoOneMail(t *testing.T) {
	notification := APIKeysExpiring([]ExpiringKey{{Name: "ci", Prefix: "seat_abc", ExpiresAt: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)}, {Name: "mcp", Prefix: "seat_def", ExpiresAt: time.Date(2026, 9, 22, 0, 0, 0, 0, time.UTC)}})
	body := notification.Render(Config{})
	if notification.Subject != "[SeatOn] API 키 만료 임박" || !strings.Contains(body, "- ci (seat_abc…)") || !strings.Contains(body, "- mcp (seat_def…)") {
		t.Fatalf("여러 키가 한 통에 묶여야 한다: %s\n%s", notification.Subject, body)
	}
	if strings.Contains(body, "바로 열기") {
		t.Fatal("base_url 이 없으면 링크를 붙이지 않는다")
	}
}

// contextStore 는 실제 데이터베이스처럼 컨텍스트가 끝난 뒤의 기록을 거부한다.
type contextStore struct{ *MemoryStore }

func (c contextStore) Update(ctx context.Context, id, status string, attempts int, errorMessage string, at time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return c.MemoryStore.Update(ctx, id, status, attempts, errorMessage, at)
}

// stalledSender 는 TCP 는 받되 응답이 없는 릴레이처럼 발송 컨텍스트가 끝날
// 때까지 매달렸다가 실패를 돌려준다.
func stalledSender(ctx context.Context, _ Config, _ Message) error {
	<-ctx.Done()
	return errors.New("SMTP 세션 시작 실패: i/o timeout")
}

func TestStalledRelayOutcomeIsStillRecorded(t *testing.T) {
	previous := sendGrace
	sendGrace = 0
	t.Cleanup(func() { sendGrace = previous })

	store := NewMemoryStore()
	service := NewService(contextStore{store}, func(context.Context) (map[string]string, error) { return enabledValues, nil }, nil,
		func() string { return "d1" }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	service.SetSender(stalledSender)
	config := ReadConfig(enabledValues)
	config.Timeout = 20 * time.Millisecond
	delivery := Delivery{ID: "d1", Event: EventTest, Recipient: "kim@example.test", Status: StatusQueued, CreatedAt: service.now(), UpdatedAt: service.now()}
	service.record(context.Background(), delivery)
	service.deliver(delivery, config, Message{To: delivery.Recipient})
	page, _ := store.List(context.Background(), "", 10)
	if len(page.Items) != 1 || page.Items[0].Status != StatusFailed || page.Items[0].Attempts != 2 || !strings.Contains(page.Items[0].ErrorMessage, "i/o timeout") {
		t.Fatalf("멈춘 릴레이라도 결과·시도 횟수·이유가 기록되어야 한다: %+v", page.Items)
	}

	values := map[string]string{"mail.timeout_seconds": "1"}
	for key, value := range enabledValues {
		values[key] = value
	}
	store = NewMemoryStore()
	service = NewService(contextStore{store}, func(context.Context) (map[string]string, error) { return values, nil }, nil,
		func() string { return "d2" }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	service.SetSender(stalledSender)
	if err := service.SendNow(context.Background(), TestMessage(), "u1", "kim@example.test"); err == nil {
		t.Fatal("멈춘 릴레이면 시험 발송은 실패해야 한다")
	}
	page, _ = store.List(context.Background(), "", 10)
	if len(page.Items) != 1 || page.Items[0].Status != StatusFailed || page.Items[0].Attempts != 1 {
		t.Fatalf("시험 발송 실패도 대기가 아니라 실패로 기록되어야 한다: %+v", page.Items)
	}
}

func TestAPIKeysExpiringDoesNotRecommendRotation(t *testing.T) {
	// 회전은 옛 키의 만료일을 새 키에 그대로 물려주므로 만료를 벗어나지 못한다.
	body := APIKeysExpiring([]ExpiringKey{{Name: "ci", Prefix: "seat_abc", ExpiresAt: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)}}).Render(Config{})
	if strings.Contains(body, "키를 회전하면") || !strings.Contains(body, "새 키를 발급") {
		t.Fatalf("만료 임박 안내는 회전이 아니라 새 키 발급을 권해야 한다:\n%s", body)
	}
}
