package mail

import (
	"context"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
)

// Directory 는 계정 id 를 메일 주소로 바꾼다. 이 앱은 이미 사용자를 알고
// 있으므로 조회 하나만 빌려 쓰고, 메일 쪽은 자기 명부를 갖지 않는다.
type Directory interface {
	LookupEmails(ctx context.Context, ids []string) (map[string]string, error)
}

// Store 는 발송 기록을 남기는 곳이다. 본문은 담지 않는다 — 제목과 수신자면
// 충분하고, 본문까지 담으면 알림 기록이 그 자체로 유출 경로가 된다.
type Store interface {
	Insert(ctx context.Context, delivery Delivery) error
	Update(ctx context.Context, id, status string, attempts int, errorMessage string, at time.Time) error
	List(ctx context.Context, status string, limit int) (Page, error)
}

// Delivery 는 시도 한 번의 기록이다. 성공도 실패도 남긴다 — 실패만 남기면
// "안 왔다" 는 문의에 답할 수 없다.
type Delivery struct {
	ID           string    `json:"id"`
	Event        string    `json:"event"`
	Recipient    string    `json:"recipient"`
	Subject      string    `json:"subject"`
	Reference    string    `json:"reference,omitempty"`
	ActorID      string    `json:"actorId,omitempty"`
	Status       string    `json:"status"`
	Attempts     int       `json:"attempts"`
	ErrorMessage string    `json:"errorMessage,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Summary struct {
	Total  int            `json:"total"`
	Status map[string]int `json:"status"`
}

type Page struct {
	Items   []Delivery `json:"items"`
	Summary Summary    `json:"summary"`
}

const (
	StatusQueued = "queued"
	StatusSent   = "sent"
	StatusFailed = "failed"
)

// sendGrace 는 연결 마감(mail.go 의 2*Timeout) 위에 더 주는 발송 여유다.
// 테스트가 줄인다.
var sendGrace = 15 * time.Second

// recordTimeout 은 발송 결과를 기록하는 데 주는 시간이다. 발송과 따로 센다.
const recordTimeout = 10 * time.Second

type Service struct {
	store     Store
	settings  func(context.Context) (map[string]string, error)
	directory Directory
	logger    *slog.Logger
	now       func() time.Time
	send      func(context.Context, Config, Message) error
	newID     func() string
	// pending 은 배경 발송 고루틴을 센다. 테스트가 결과를 기다릴 때 쓴다.
	pending sync.WaitGroup
}

// NewService 는 발송 기록·설정 읽기·사용자 조회·id 생성을 받아 서비스를 만든다.
func NewService(store Store, settings func(context.Context) (map[string]string, error), directory Directory, newID func() string, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{store: store, settings: settings, directory: directory, logger: logger, newID: newID,
		now: func() time.Time { return time.Now().UTC() }, send: Deliver}
}

// SetSender 는 전송을 바꾼다. 테스트가 실제 릴레이 없이 서비스를 돌릴 때 쓴다.
func (s *Service) SetSender(sender func(context.Context, Config, Message) error) { s.send = sender }

// Wait 는 배경 발송이 모두 끝날 때까지 기다린다. 테스트용이다.
func (s *Service) Wait() { s.pending.Wait() }

func (s *Service) Config(ctx context.Context) (Config, error) {
	if s.settings == nil {
		return ReadConfig(nil), nil
	}
	values, err := s.settings(ctx)
	if err != nil {
		return Config{}, err
	}
	return ReadConfig(values), nil
}

// Notify 는 받는 사람을 찾아 배경에서 보낸다. 어떤 요청도 메일 서버를
// 기다리지 않는다. 주소가 없는 사람은 조용히 건너뛰고, 자기가 한 일은
// 자기에게 보내지 않는다.
func (s *Service) Notify(ctx context.Context, notification Notification, actorID string, recipients []string) {
	config, err := s.Config(ctx)
	if err != nil {
		s.logger.Warn("메일 설정을 읽지 못했습니다", "error", err)
		return
	}
	if !config.Enabled || !config.Allows(notification.Event) {
		return
	}
	if err := config.Validate(); err != nil {
		// 켰지만 모자란 설정은 이유를 남긴다. 조용히 안 가면 아무도 모른다.
		s.logger.Warn("메일 설정이 모자라 알림을 보내지 않았습니다", "event", notification.Event, "reason", err.Error())
		return
	}
	addresses := s.resolve(ctx, recipients, actorID)
	if len(addresses) == 0 {
		return
	}
	body := notification.Render(config)
	for _, address := range addresses {
		delivery := Delivery{
			ID: s.newID(), Event: notification.Event, Recipient: address, Subject: notification.Subject,
			Reference: notification.Reference, ActorID: actorID, Status: StatusQueued, CreatedAt: s.now(), UpdatedAt: s.now(),
		}
		s.record(ctx, delivery)
		s.pending.Add(1)
		go func(delivery Delivery, message Message) {
			defer s.pending.Done()
			s.deliver(delivery, config, message)
		}(delivery, Message{To: address, Subject: notification.Subject, Body: body})
	}
}

// SendNow 는 바로 보내고 결과를 돌려준다. 관리자 화면의 시험 발송이 쓴다.
func (s *Service) SendNow(ctx context.Context, notification Notification, actorID, recipient string) error {
	config, err := s.Config(ctx)
	if err != nil {
		return err
	}
	if !config.Enabled {
		return ErrDisabled
	}
	if err := config.Validate(); err != nil {
		return err
	}
	delivery := Delivery{ID: s.newID(), Event: notification.Event, Recipient: recipient, Subject: notification.Subject,
		ActorID: actorID, Status: StatusQueued, CreatedAt: s.now(), UpdatedAt: s.now()}
	s.record(ctx, delivery)
	sendContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), config.Timeout+sendGrace)
	defer cancel()
	err = s.send(sendContext, config, Message{To: recipient, Subject: notification.Subject, Body: notification.Render(config)})
	delivery.Attempts = 1
	s.complete(sendContext, delivery, err)
	return err
}

// deliver 는 한 번 더 시도한다. 잠깐 연결을 거부하는 릴레이는 흔하고, 알림을
// 잃는 것이 몇 초 기다리는 것보다 나쁘다.
func (s *Service) deliver(delivery Delivery, config Config, message Message) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*config.Timeout+sendGrace)
	defer cancel()
	var err error
	for attempt := 1; attempt <= 2; attempt++ {
		delivery.Attempts = attempt
		if err = s.send(ctx, config, message); err == nil {
			break
		}
		if attempt == 1 {
			select {
			case <-ctx.Done():
			case <-time.After(2 * time.Second):
			}
		}
	}
	s.complete(ctx, delivery, err)
}

// complete 는 결과를 기록한다. 발송 컨텍스트는 쓰지 않는다 — 멈춘 릴레이는
// 연결 마감까지 매달려 발송 컨텍스트를 먼저 소진하는데, 그때 기록까지
// 같이 죽으면 정확히 진단이 필요한 장애가 '대기' 로 남는다.
func (s *Service) complete(ctx context.Context, delivery Delivery, cause error) {
	status, message := StatusSent, ""
	if cause != nil {
		status, message = StatusFailed, cause.Error()
		s.logger.Warn("알림 메일 발송 실패", "event", delivery.Event, "recipient", delivery.Recipient, "error", cause)
	}
	if s.store == nil {
		return
	}
	recordContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), recordTimeout)
	defer cancel()
	if err := s.store.Update(recordContext, delivery.ID, status, max(delivery.Attempts, 1), trim(message, 1000), s.now()); err != nil {
		s.logger.Warn("메일 발송 결과를 기록하지 못했습니다", "error", err)
	}
}

func (s *Service) record(ctx context.Context, delivery Delivery) {
	if s.store == nil {
		return
	}
	delivery.Subject = trim(delivery.Subject, 300)
	if err := s.store.Insert(ctx, delivery); err != nil {
		s.logger.Warn("메일 발송을 기록하지 못했습니다", "error", err)
	}
}

// resolve 는 계정 id 를 겹치지 않는 주소로 바꾼다. 행위자는 id 로도 주소로도
// 뺀다 — 관리자 계정과 그 사람의 직원 레코드가 다른 id 를 쓰기 때문이다.
func (s *Service) resolve(ctx context.Context, recipients []string, actorID string) []string {
	actorID = strings.TrimSpace(actorID)
	wanted := make([]string, 0, len(recipients))
	for _, recipient := range recipients {
		trimmed := strings.TrimSpace(recipient)
		if trimmed == "" || strings.EqualFold(trimmed, actorID) {
			continue
		}
		wanted = append(wanted, trimmed)
	}
	if len(wanted) == 0 || s.directory == nil {
		return nil
	}
	lookup := wanted
	if actorID != "" {
		lookup = append(append([]string{}, wanted...), actorID)
	}
	emails, err := s.directory.LookupEmails(ctx, lookup)
	if err != nil {
		s.logger.Warn("알림 받는 사람을 찾지 못했습니다", "error", err)
		return nil
	}
	seen := map[string]struct{}{}
	if actorAddress := strings.ToLower(strings.TrimSpace(emails[actorID])); actorAddress != "" {
		seen[actorAddress] = struct{}{}
	}
	addresses := make([]string, 0, len(wanted))
	for _, recipient := range wanted {
		address := strings.TrimSpace(emails[recipient])
		if address == "" && strings.Contains(recipient, "@") {
			// 이미 주소인 식별자는 명부가 필요 없다.
			address = recipient
		}
		if address == "" {
			continue
		}
		key := strings.ToLower(address)
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		addresses = append(addresses, address)
	}
	return addresses
}

// Deliveries 는 나간 것을 최신순으로 보여 준다.
func (s *Service) Deliveries(ctx context.Context, status string, limit int) (Page, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if s.store == nil {
		return Page{Items: []Delivery{}, Summary: Summary{Status: map[string]int{}}}, nil
	}
	return s.store.List(ctx, strings.TrimSpace(status), limit)
}

func trim(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

// MemoryStore 는 데이터베이스 없이 기록을 담는다. 테스트가 쓴다.
type MemoryStore struct {
	mu    sync.Mutex
	items []Delivery
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{} }

func (m *MemoryStore) Insert(_ context.Context, delivery Delivery) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.items = append(m.items, delivery)
	return nil
}

func (m *MemoryStore) Update(_ context.Context, id, status string, attempts int, errorMessage string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for index := range m.items {
		if m.items[index].ID == id {
			m.items[index].Status = status
			m.items[index].Attempts = attempts
			m.items[index].ErrorMessage = errorMessage
			m.items[index].UpdatedAt = at
		}
	}
	return nil
}

func (m *MemoryStore) List(_ context.Context, status string, limit int) (Page, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	page := Page{Items: []Delivery{}, Summary: Summary{Status: map[string]int{}}}
	items := append([]Delivery{}, m.items...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	for _, item := range items {
		page.Summary.Status[item.Status]++
		page.Summary.Total++
		if (status == "" || item.Status == status) && len(page.Items) < limit {
			page.Items = append(page.Items, item)
		}
	}
	return page, nil
}
