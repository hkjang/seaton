// Package mail 은 사내 SMTP 릴레이로 이벤트 알림을 보낸다.
//
// 사내 릴레이는 포트 25 · 인증 없음 · TLS 없음이 흔하므로 그것이 기본값이고,
// 인증과 암호화는 서버가 알리는 대로 맞추는 선택 사항이다. 여기서는 어떤
// 요청도 막지 않는다 — 발송은 배경에서 하고, 시도마다 기록을 남겨 관리자가
// 무엇이 건물 밖으로 나갔는지 볼 수 있게 한다.
package mail

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

var (
	ErrDisabled = errors.New("메일 알림이 꺼져 있습니다")
	ErrInvalid  = errors.New("메일 설정이 올바르지 않습니다")
)

// 이벤트 이름. 이 앱에서 사람이 실제로 기다리는 일만 고른다 — 이 메일이 오지
// 않으면 누군가 손해를 보거나 화면을 계속 새로고침하는 것들이다.
const (
	// EventSeatAssigned 는 직원의 자리가 정해지거나 옮겨졌을 때 그 직원에게 간다.
	EventSeatAssigned = "seat.assigned"
	// EventAnalysisFinished 는 오래 걸리는 도면 분석이 끝나거나 실패했을 때
	// 분석을 요청한 사람에게 간다.
	EventAnalysisFinished = "analysis.finished"
	// EventHRSyncFailed 는 새벽에 도는 예약 인사 연동이 실패했을 때 관리자에게 간다.
	EventHRSyncFailed = "hr_sync.failed"
	// EventAPIKeyExpiring 은 개인 API 키가 곧 만료될 때 키 소유자에게 간다.
	EventAPIKeyExpiring = "api_key.expiring"
	// EventTest 는 관리자 화면의 시험 발송이다.
	EventTest = "test"
)

type Config struct {
	Enabled     bool
	Host        string
	Port        int
	Security    string
	SkipVerify  bool
	Username    string
	Password    string
	FromAddress string
	FromName    string
	BaseURL     string
	Timeout     time.Duration
	Events      map[string]bool
}

// Address 는 RFC 5322 From 헤더 값이다.
func (c Config) Address() string {
	from := strings.TrimSpace(c.FromAddress)
	if name := strings.TrimSpace(c.FromName); name != "" {
		return fmt.Sprintf("%s <%s>", name, from)
	}
	return from
}

func (c Config) endpoint() string { return net.JoinHostPort(c.Host, fmt.Sprint(c.Port)) }

// Allows 는 이 이벤트를 보내도 되는지 말한다. 모르는 이벤트는 보낸다 — 알림을
// 하나 더할 때마다 설정부터 손대게 하지 않기 위해서다.
func (c Config) Allows(event string) bool {
	if enabled, known := c.Events[event]; known {
		return enabled
	}
	return true
}

// Validate 는 켜져 있어도 보낼 수 없는 설정을 이유와 함께 돌려준다.
func (c Config) Validate() error {
	if strings.TrimSpace(c.Host) == "" {
		return fmt.Errorf("%w: mail.smtp_host 가 비어 있습니다", ErrInvalid)
	}
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("%w: mail.smtp_port 는 1~65535 사이여야 합니다", ErrInvalid)
	}
	if !strings.Contains(c.FromAddress, "@") {
		return fmt.Errorf("%w: mail.from_address 는 메일 주소여야 합니다", ErrInvalid)
	}
	switch c.Security {
	case "auto", "none", "starttls", "tls":
	default:
		return fmt.Errorf("%w: mail.security 는 auto, none, starttls, tls 중 하나여야 합니다", ErrInvalid)
	}
	return nil
}

type Message struct {
	To      string
	Subject string
	Body    string
}

// Deliver 는 연결을 열어 한 통을 보낸다. 관리자 화면의 시험 발송이 같은 길을
// 쓰므로, 여기서 되면 알림도 된다.
func Deliver(ctx context.Context, config Config, message Message) error {
	if err := config.Validate(); err != nil {
		return err
	}
	if strings.TrimSpace(message.To) == "" {
		return fmt.Errorf("%w: 받는 사람이 없습니다", ErrInvalid)
	}
	client, err := dial(ctx, config)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	if err := startSession(client, config); err != nil {
		return err
	}
	if err := client.Mail(strings.TrimSpace(config.FromAddress)); err != nil {
		return fmt.Errorf("MAIL FROM 실패: %w", err)
	}
	if err := client.Rcpt(strings.TrimSpace(message.To)); err != nil {
		return fmt.Errorf("RCPT TO 실패: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA 실패: %w", err)
	}
	if _, err := writer.Write([]byte(compose(config, message))); err != nil {
		return fmt.Errorf("본문 전송 실패: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("본문 종료 실패: %w", err)
	}
	return client.Quit()
}

func dial(ctx context.Context, config Config) (*smtp.Client, error) {
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	dialer := &net.Dialer{Timeout: timeout}
	var connection net.Conn
	var err error
	if config.Security == "tls" {
		connection, err = tls.DialWithDialer(dialer, "tcp", config.endpoint(), config.tlsConfig())
		if err != nil {
			return nil, fmt.Errorf("SMTP TLS 연결 실패: %w", err)
		}
	} else {
		connection, err = dialer.DialContext(ctx, "tcp", config.endpoint())
		if err != nil {
			return nil, fmt.Errorf("SMTP 연결 실패: %w", err)
		}
	}
	// 릴레이가 응답을 멈추면 배경 고루틴이 영원히 매달린다. 세션 전체에
	// 마감을 둔다.
	_ = connection.SetDeadline(time.Now().Add(2 * timeout))
	client, err := smtp.NewClient(connection, config.Host)
	if err != nil {
		_ = connection.Close()
		return nil, fmt.Errorf("SMTP 세션 시작 실패: %w", err)
	}
	return client, nil
}

// startSession 은 릴레이가 허락하는 만큼만 암호화하고 인증한다. 인증 없는
// 사내 릴레이와 둘 다 요구하는 외부 서비스가 같은 설정 항목으로 동작한다.
func startSession(client *smtp.Client, config Config) error {
	if err := client.Hello(helloName(config)); err != nil {
		return fmt.Errorf("EHLO 실패: %w", err)
	}
	if config.Security == "starttls" || config.Security == "auto" {
		if supported, _ := client.Extension("STARTTLS"); supported {
			if err := client.StartTLS(config.tlsConfig()); err != nil {
				return fmt.Errorf("STARTTLS 실패: %w", err)
			}
		} else if config.Security == "starttls" {
			return fmt.Errorf("%w: 서버가 STARTTLS 를 지원하지 않습니다", ErrInvalid)
		}
	}
	if strings.TrimSpace(config.Username) == "" {
		return nil
	}
	supported, mechanisms := client.Extension("AUTH")
	if !supported {
		return fmt.Errorf("%w: 서버가 인증을 지원하지 않습니다. 사용자 이름을 비우고 쓰세요", ErrInvalid)
	}
	var auth smtp.Auth
	switch {
	case strings.Contains(strings.ToUpper(mechanisms), "PLAIN"):
		auth = smtp.PlainAuth("", config.Username, config.Password, config.Host)
	case strings.Contains(strings.ToUpper(mechanisms), "LOGIN"):
		auth = loginAuth{username: config.Username, password: config.Password, host: config.Host}
	default:
		auth = smtp.CRAMMD5Auth(config.Username, config.Password)
	}
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("SMTP 인증 실패: %w", err)
	}
	return nil
}

func (c Config) tlsConfig() *tls.Config {
	return &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12, InsecureSkipVerify: c.SkipVerify} //nolint:gosec // 사설 인증서를 쓰는 사내 릴레이를 위한 선택 사항
}

// helloName 은 EHLO 이름을 보내는 주소의 도메인으로 한다. 인사말을 검사하는
// 릴레이는 컨테이너 호스트 이름보다 이쪽을 받아들인다.
func helloName(config Config) string {
	if index := strings.LastIndex(config.FromAddress, "@"); index >= 0 && index+1 < len(config.FromAddress) {
		return config.FromAddress[index+1:]
	}
	return "localhost"
}

// loginAuth 는 몇몇 사내 릴레이가 PLAIN 대신 쓰는 LOGIN 방식이다. 표준
// 라이브러리는 PLAIN 과 CRAM-MD5 만 제공한다.
type loginAuth struct{ username, password, host string }

func (a loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && server.Name != a.host {
		return "", nil, errors.New("LOGIN 인증은 신뢰할 수 있는 서버에서만 씁니다")
	}
	return "LOGIN", nil, nil
}

func (a loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	switch strings.ToLower(strings.TrimRight(string(fromServer), ": ")) {
	case "username":
		return []byte(a.username), nil
	case "password":
		return []byte(a.password), nil
	}
	return nil, fmt.Errorf("알 수 없는 LOGIN 요청: %s", fromServer)
}
