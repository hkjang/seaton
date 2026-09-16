package mail

import (
	"strconv"
	"strings"
	"time"
)

// KeyPrefix 는 settings 테이블에서 메일 설정이 쓰는 앞머리다. 키 이름은
// 사내 표준(kanpic 과 같은 이름)을 그대로 쓴다 — 앱마다 다르면 운영자가
// 스무 번 다르게 배운다.
const KeyPrefix = "mail."

// 기본값은 흔한 경우를 겨냥한다: 포트 25 로 자격 증명 없이 받아 주는 사내 릴레이.
const (
	defaultPort     = 25
	defaultSecurity = "auto"
	defaultTimeout  = 10 * time.Second
	defaultFromName = "SeatOn"
)

// EventSettings 는 이벤트 종류별 스위치의 설정 키다. 관리자는 종류별로 끌 수 있다.
var EventSettings = map[string]string{
	EventSeatAssigned:     "mail.notify_seat_assigned",
	EventAnalysisFinished: "mail.notify_analysis",
	EventHRSyncFailed:     "mail.notify_hr_sync",
	EventAPIKeyExpiring:   "mail.notify_api_key_expiring",
}

// ReadConfig 는 settings 의 문자열 값에서 구성을 읽는다. SeatOn 의 설정은
// 모두 문자열이라("true"/"false", 숫자도 글자) 여기서 한 번만 해석한다.
func ReadConfig(values map[string]string) Config {
	config := Config{Port: defaultPort, Security: defaultSecurity, Timeout: defaultTimeout, Events: map[string]bool{}}
	config.Enabled = boolValue(values, "mail.enabled")
	config.Host = stringValue(values, "mail.smtp_host", "")
	config.Username = stringValue(values, "mail.username", "")
	config.Password = stringValue(values, "mail.password", "")
	config.FromAddress = stringValue(values, "mail.from_address", "")
	config.FromName = stringValue(values, "mail.from_name", defaultFromName)
	config.Security = strings.ToLower(stringValue(values, "mail.security", defaultSecurity))
	config.BaseURL = stringValue(values, "mail.base_url", "")
	config.SkipVerify = boolValue(values, "mail.skip_tls_verify")
	if port, ok := numberValue(values, "mail.smtp_port"); ok && port > 0 {
		config.Port = port
	}
	if seconds, ok := numberValue(values, "mail.timeout_seconds"); ok && seconds > 0 {
		config.Timeout = time.Duration(seconds) * time.Second
	}
	// 암시적 TLS 포트의 릴레이는 따로 적지 않아도 된다.
	if config.Security == defaultSecurity && config.Port == 465 {
		config.Security = "tls"
	}
	for event, key := range EventSettings {
		if value, ok := values[key]; ok && strings.TrimSpace(value) != "" {
			config.Events[event] = boolValue(values, key)
		}
	}
	if config.FromAddress == "" && config.Host != "" {
		config.FromAddress = "seaton@" + config.Host
	}
	return config
}

func stringValue(values map[string]string, key, fallback string) string {
	if value := strings.TrimSpace(values[key]); value != "" {
		return value
	}
	return fallback
}

func boolValue(values map[string]string, key string) bool {
	return strings.EqualFold(strings.TrimSpace(values[key]), "true")
}

func numberValue(values map[string]string, key string) (int, bool) {
	number, err := strconv.Atoi(strings.TrimSpace(values[key]))
	if err != nil {
		return 0, false
	}
	return number, true
}
