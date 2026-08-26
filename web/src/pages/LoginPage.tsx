import { useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import LoginRounded from "@mui/icons-material/LoginRounded";
import CorporateFareRounded from "@mui/icons-material/CorporateFareRounded";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { useAuth } from "../auth";

export function LoginPage() {
  const { user, config, version, login, sessionEnded, clearSessionEnded } =
      useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username, password);
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그인하지 못했습니다");
    } finally {
      setBusy(false);
    }
  };
  const queryError = new URLSearchParams(location.search).get("error");
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "1.05fr .95fr" },
        bgcolor: "#F4F7F9",
      }}
    >
      <Box
        sx={{
          display: { xs: "none", lg: "flex" },
          position: "relative",
          overflow: "hidden",
          p: 8,
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(circle at 18% 15%, #174B5A 0, #071A2B 56%, #04121D 100%)",
          color: "white",
          "&::after": {
            content: '""',
            position: "absolute",
            width: 520,
            height: 520,
            border: "1px solid rgba(99,209,217,.18)",
            borderRadius: "50%",
            right: -130,
            bottom: -120,
            boxShadow:
              "0 0 0 75px rgba(99,209,217,.035), 0 0 0 150px rgba(99,209,217,.025)",
          },
        }}
      >
        <Logo inverse />
        <Box sx={{ position: "relative", zIndex: 1, maxWidth: 620 }}>
          <Typography
            variant="overline"
            sx={{ color: "#63D1D9", letterSpacing: 2 }}
          >
            SMART OFFICE DIGITAL MAP
          </Typography>
          <Typography
            variant="h2"
            sx={{
              mt: 2,
              fontWeight: 800,
              fontSize: { lg: 56, xl: 68 },
              lineHeight: 1.08,
              letterSpacing: "-.055em",
            }}
          >
            사람과 공간이
            <br />더 잘 만나는 자리.
          </Typography>
          <Typography
            sx={{
              mt: 3,
              fontSize: 18,
              color: "rgba(255,255,255,.62)",
              lineHeight: 1.75,
            }}
          >
            도면을 이해하고, 조직의 변화를 감지하고,
            <br />
            확인이 필요한 예외만 알려주는 좌석 운영.
          </Typography>
        </Box>
        <Typography variant="body2" color="rgba(255,255,255,.42)">
          Private · Offline · Auditable
        </Typography>
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: { xs: 2.5, sm: 5 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: "100%",
            maxWidth: 450,
            p: { xs: 3, sm: 5 },
            border: "1px solid #E2E9ED",
            boxShadow: "0 20px 60px rgba(16,42,59,.08)",
          }}
        >
          <Box sx={{ display: { lg: "none" }, mb: 4 }}>
            <Logo />
          </Box>
          <Typography variant="h4">다시 만나서 반가워요</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 4 }}>
            {config?.companyName ? `${config.companyName} ` : ""}SeatOn에
            로그인하세요.
          </Typography>
          {/* 세션이 끊겨 돌아온 경우와 로그인 실패를 구분해 알린다. */}
          {sessionEnded && !error && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              onClose={clearSessionEnded}
            >
              {sessionEnded}
            </Alert>
          )}
          {(error || queryError) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error || "SSO 인증을 완료하지 못했습니다."}
            </Alert>
          )}
          {config?.oidcEnabled && (
            <Button
              fullWidth
              size="large"
              variant="contained"
              startIcon={<CorporateFareRounded />}
              href="/api/v1/auth/oidc/start"
              sx={{ mb: 2, height: 48 }}
            >
              사내 SSO로 로그인
            </Button>
          )}
          {config?.oidcEnabled && config.localEnabled && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, my: 2 }}>
              <Box sx={{ height: 1, bgcolor: "divider", flex: 1 }} />
              <Typography variant="caption" color="text.secondary">
                또는 관리자 로그인
              </Typography>
              <Box sx={{ height: 1, bgcolor: "divider", flex: 1 }} />
            </Box>
          )}
          {config?.localEnabled && (
            <Box component="form" onSubmit={submit}>
              <Stack spacing={2}>
                <TextField
                  label="관리자 아이디"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  fullWidth
                />
                <TextField
                  label="비밀번호"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  fullWidth
                />
                <Button
                  type="submit"
                  fullWidth
                  size="large"
                  variant={config?.oidcEnabled ? "outlined" : "contained"}
                  startIcon={
                    busy ? <CircularProgress size={17} /> : <LoginRounded />
                  }
                  disabled={busy}
                  sx={{ height: 48 }}
                >
                  {busy ? "확인 중…" : "로그인"}
                </Button>
              </Stack>
            </Box>
          )}
          {!config?.localEnabled && !config?.oidcEnabled && (
            <Alert severity="warning">
              사용 가능한 로그인 방식이 없습니다. 부트스트랩 관리자 설정을
              확인하세요.
            </Alert>
          )}
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: "block", textAlign: "center", mt: 4 }}
          >
            SeatOn {version?.version ?? "dev"}
            {version?.commit && version.commit !== "unknown"
              ? ` · ${version.commit.slice(0, 8)}`
              : ""}
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
