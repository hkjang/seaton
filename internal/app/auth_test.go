package app

import (
	"net/http/httptest"
	"net/url"
	"testing"

	"golang.org/x/oauth2"
)

// 조용한 SSO(prompt=none)의 전부는 무한 루프를 막는 것이다. 서버 쪽 규칙 —
// 관리자 설정이 꺼져 있으면 시도하지 않고, 거절은 주소에 표시로 남긴다 — 를
// 여기서 확인한다.

func TestSilentLoginRequiresAutoLoginSetting(t *testing.T) {
	plain := httptest.NewRequest("GET", "/api/v1/auth/oidc/start", nil)
	silent := httptest.NewRequest("GET", "/api/v1/auth/oidc/start?prompt=none", nil)
	if silentLoginRequested(plain, true) {
		t.Fatal("prompt=none 이 없으면 조용한 시도가 아니어야 한다")
	}
	if silentLoginRequested(silent, false) {
		t.Fatal("auto_login 이 꺼져 있으면 ?prompt=none 을 붙여도 평범한 로그인으로 바꿔야 한다")
	}
	if !silentLoginRequested(silent, true) {
		t.Fatal("auto_login 이 켜져 있고 prompt=none 을 요청하면 조용한 시도여야 한다")
	}
}

func TestOIDCAuthCodeURLCarriesPromptNoneOnlyWhenSilent(t *testing.T) {
	cfg := oauth2.Config{ClientID: "seaton", Endpoint: oauth2.Endpoint{AuthURL: "https://keycloak.intra/auth"}, RedirectURL: "https://seaton.intra/api/v1/auth/oidc/callback", Scopes: []string{"openid"}}
	for _, silent := range []bool{false, true} {
		raw := oidcAuthCodeURL(cfg, "state", "nonce", "verifier", silent)
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("인가 주소를 읽지 못함: %v", err)
		}
		got := parsed.Query().Get("prompt")
		if silent && got != "none" {
			t.Fatalf("조용한 시도에는 prompt=none 이 있어야 한다: %s", raw)
		}
		if !silent && got != "" {
			t.Fatalf("평범한 로그인에는 prompt 가 없어야 한다: %s", raw)
		}
		if parsed.Query().Get("nonce") != "nonce" || parsed.Query().Get("code_challenge_method") != "S256" {
			t.Fatalf("nonce 와 PKCE 는 그대로 있어야 한다: %s", raw)
		}
	}
}

func TestOIDCErrorRedirectMarksSilentRefusal(t *testing.T) {
	cases := []struct {
		silent bool
		err    string
		want   string
	}{
		// 세션이 없다는 평범한 대답은 주소에 표시만 남기고 오류로 알리지 않는다.
		{true, "login_required", "/login?sso=none"},
		{true, "interaction_required", "/login?sso=none"},
		{true, "consent_required", "/login?sso=none"},
		// 조용한 시도가 다른 이유로 거절되면 다시 시도하지 말라는 표시와 함께 알린다.
		{true, "invalid_scope", "/login?sso=none&error=invalid_scope"},
		// 사람이 단추를 눌러 시작한 로그인의 거절은 이전과 같이 오류로 알린다.
		{false, "login_required", "/login?error=login_required"},
		{false, "access_denied", "/login?error=access_denied"},
	}
	for _, c := range cases {
		if got := oidcErrorRedirect(c.silent, c.err); got != c.want {
			t.Errorf("silent=%v error=%s: got %s want %s", c.silent, c.err, got, c.want)
		}
	}
}

func TestSafeReturnToStaysOnSite(t *testing.T) {
	ok := []string{"/", "/admin/maps", "/admin/maps?floor=3#seat", "/profile/keys"}
	for _, v := range ok {
		if !safeReturnTo(v) {
			t.Errorf("%q 는 받아야 한다", v)
		}
	}
	bad := []string{"", "admin", "//evil.example", "/\\evil.example", "https://evil.example/", "/login\r\nSet-Cookie: x=y", "javascript:alert(1)"}
	for _, v := range bad {
		if safeReturnTo(v) {
			t.Errorf("%q 는 거절해야 한다", v)
		}
	}
}
