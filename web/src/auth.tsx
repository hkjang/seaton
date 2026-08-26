import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, postJSON, setCSRF, setSessionEndedHandler } from "./api";
import type { AuthConfig, User, VersionInfo } from "./types";

interface AuthState {
  user: User | null;
  config: AuthConfig | null;
  version: VersionInfo | null;
  loading: boolean;
  /** 세션이 끊겨 로그아웃된 이유. 로그인 화면에서 사용자에게 알린다. */
  sessionEnded: string;
  /**
   * 로그인 방식 설정을 서버에서 받아오지 못한 이유. 값이 있으면 설정이 잘못된
   * 것이 아니라 서버에 닿지 못한 것이므로, 화면은 설정을 고치라고 하는 대신
   * 다시 시도할 길을 줘야 한다.
   */
  configError: string;
  clearSessionEnded: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState<AuthConfig | null>(null),
    [version, setVersion] = useState<VersionInfo | null>(null),
    [sessionEnded, setSessionEnded] = useState(""),
    [configError, setConfigError] = useState(""),
    [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const c = await api<AuthConfig>("/api/v1/auth/config");
      setConfig(c);
      setVersion(c.version);
      setConfigError("");
      try {
        const me = await api<{
          user: User;
          csrfToken: string;
          version: VersionInfo;
        }>("/api/v1/auth/me");
        setUser(me.user);
        setVersion(me.version);
        setCSRF(me.csrfToken);
      } catch {
        setUser(null);
        setCSRF("");
      }
    } catch (e) {
      // 설정을 못 받아 온 것은 설정이 비어 있다는 뜻이 아니라 서버에 닿지
      // 못했다는 뜻이다. 여기서 잡지 않으면 처리되지 않은 거부로 흘러가고,
      // 로그인 화면은 로그인 방식이 없다고 잘못 안내한다.
      setConfigError(
        e instanceof Error ? e.message : "서버에 연결하지 못했습니다",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  // 어떤 화면에서 요청하다 세션이 끊겨도 한 곳에서 정리하고 로그인으로 보낸다.
  // 각 화면이 401을 저마다 다루면 "요청 실패 (401)"만 뜨고 원인을 알 수 없다.
  useEffect(() => {
    setSessionEndedHandler((reason) => {
      setUser(null);
      setCSRF("");
      setSessionEnded(reason || "세션이 만료되었습니다. 다시 로그인해 주세요.");
    });
    return () => setSessionEndedHandler(null);
  }, []);
  const login = useCallback(
    async (username: string, password: string) => {
      await postJSON<User>("/api/v1/auth/login", { username, password });
      setSessionEnded("");
      await reload();
    },
    [reload],
  );
  const clearSessionEnded = useCallback(() => setSessionEnded(""), []);
  const logout = useCallback(async () => {
    try {
      await api<void>("/api/v1/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setCSRF("");
    }
  }, []);
  const value = useMemo(
    () => ({
      user,
      config,
      version,
      loading,
      sessionEnded,
      configError,
      clearSessionEnded,
      login,
      logout,
      reload,
    }),
    [
      user,
      config,
      version,
      loading,
      sessionEnded,
      configError,
      clearSessionEnded,
      login,
      logout,
      reload,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider missing");
  return value;
}
