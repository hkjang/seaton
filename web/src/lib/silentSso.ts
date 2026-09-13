import type { AuthConfig } from "../types";

/**
 * 조용한 SSO(prompt=none)를 언제 시도할지 정하는 규칙.
 *
 * Keycloak에 이미 로그인한 사람은 로그인 화면 없이 바로 본 화면으로 들어가야
 * 한다. 그런데 prompt=none 은 세션이 없으면 login_required 로 돌아오고, 그때
 * 다시 시도하면 브라우저가 제공자와 앱 사이를 끝없이 오간다. 이 파일의 전부는
 * 그 루프를 막는 것이다 — 한 탭 세션에 한 번, 스스로 로그아웃했으면 억제,
 * 콜백이 거절을 주소에 남기면 다시 하지 않는다.
 */

// localStorage 가 아니라 sessionStorage 다. 새 탭에서는 다시 시도하고, 거절당한
// 뒤 새로고침하면 다시 시도하지 않는 것이 맞다.
const ATTEMPTED_KEY = "seaton.sso.silentAttempted";
const SIGNED_OUT_KEY = "seaton.sso.signedOut";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** 저장소를 여는 함수. 사생활 보호 모드에서는 여는 것 자체가 예외를 낸다. */
export type StorageOpener = () => FlagStorage;
const defaultStorage: StorageOpener = () => window.sessionStorage;

function readFlag(key: string, open: StorageOpener): boolean {
  try {
    return open().getItem(key) === "true";
  } catch {
    // 저장소를 읽지 못하면 "이미 시도했다"로 친다. 이것을 "아직 안 했다"로
    // 읽으면 사생활 보호 모드에서 바로 루프가 된다. 막히는 쪽으로 실패한다.
    return true;
  }
}

function writeFlag(key: string, value: boolean, open: StorageOpener) {
  try {
    if (value) open().setItem(key, "true");
    else open().removeItem(key);
  } catch {
    /* 읽기 쪽이 이미 막히는 쪽으로 실패하므로 할 일이 없다 */
  }
}

/** 스스로 로그아웃했다는 표시. 로그아웃 직후 다시 조용히 로그인시키지 않는다. */
export function markSignedOut(open: StorageOpener = defaultStorage) {
  writeFlag(SIGNED_OUT_KEY, true, open);
  writeFlag(ATTEMPTED_KEY, true, open);
}

/** 다시 세션이 생기면 억제를 푼다. */
export function clearSilentSsoState(open: StorageOpener = defaultStorage) {
  writeFlag(SIGNED_OUT_KEY, false, open);
  writeFlag(ATTEMPTED_KEY, false, open);
}

/** 브라우저 이동으로 그린 화면이 아닌 경로. 여기서는 절대 시도하지 않는다. */
const NEVER_PREFIXES = ["/login", "/api/", "/mcp", "/healthz", "/readyz"];

export interface SilentSsoLocation {
  pathname: string;
  search: string;
}

/**
 * 로그인 화면을 그리기 전에 조용한 로그인을 시도할지 정한다.
 *
 * 한 탭의 브라우징 세션에 한 번을 넘겨서는 안 된다. prompt=none 은 곧바로
 * 답하거나 login_required 로 돌아오는데, 그것을 페이지가 열릴 때마다 다시 하면
 * 화면이 깜빡이기만 한다.
 */
export function shouldAttemptSilentSso(
  config: Pick<AuthConfig, "oidcEnabled" | "oidcAutoLogin"> | null,
  location: SilentSsoLocation,
  open: StorageOpener = defaultStorage,
): boolean {
  if (!config?.oidcEnabled || !config.oidcAutoLogin) return false;
  // 콜백·로그인 경로는 가장 흔한 루프의 출처고, API·MCP·헬스 경로는 브라우저
  // 이동이 아니다.
  if (NEVER_PREFIXES.some((prefix) => location.pathname.startsWith(prefix)))
    return false;
  // 콜백은 제공자에 세션이 없을 때 이 표시를 붙인다. sessionStorage 가 그새
  // 지워졌더라도 거절을 기억하게 한다.
  const sso = new URLSearchParams(location.search).get("sso");
  if (sso === "none" || sso === "error") return false;
  if (readFlag(SIGNED_OUT_KEY, open)) return false;
  if (readFlag(ATTEMPTED_KEY, open)) return false;
  return true;
}

/** 로그인 뒤 돌아갈 자리. '/' 로 시작하고 '//'·'/\' 로 시작하지 않는 값만 받는다. */
export function safeReturnTo(value: string): string {
  return value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
    ? value
    : "/";
}

/** 조용한 시도의 시작 주소. 시도했다는 표시를 먼저 남긴다. */
export function silentSsoStartUrl(
  returnTo: string,
  open: StorageOpener = defaultStorage,
): string {
  writeFlag(ATTEMPTED_KEY, true, open);
  return `/api/v1/auth/oidc/start?prompt=none&returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/**
 * 숨은 iframe 이 아니라 최상위 이동이다. 서드파티 쿠키가 막힌 브라우저에서도
 * 동작하고, 제공자가 프레임을 허용하는지 신경 쓰지 않아도 된다.
 */
export function beginSilentSso(returnTo: string) {
  window.location.assign(silentSsoStartUrl(returnTo));
}
