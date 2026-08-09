import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import SaveRounded from "@mui/icons-material/SaveRounded";
import LinkRounded from "@mui/icons-material/LinkRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import WarningAmberRounded from "@mui/icons-material/WarningAmberRounded";
import { api, postJSON, putJSON } from "../api";
import { PageHeader } from "../components/AdminUI";

type Setting = {
  key: string;
  value: string;
  secret: boolean;
  configured: boolean;
};
const fields: Record<
  string,
  {
    key: string;
    label: string;
    help?: string;
    secret?: boolean;
    type?: string;
  }[]
> = {
  general: [
    { key: "general.service_name", label: "서비스 이름" },
    { key: "general.company_name", label: "회사/조직명" },
    { key: "general.default_locale", label: "기본 언어" },
  ],
  oidc: [
    {
      key: "oidc.issuer_url",
      label: "Keycloak Issuer URL",
      help: "예: https://keycloak.intra/realms/company",
    },
    { key: "oidc.client_id", label: "Client ID" },
    { key: "oidc.client_secret", label: "Client Secret", secret: true },
    { key: "oidc.scopes", label: "Scopes" },
    { key: "oidc.admin_group", label: "시스템 관리자 그룹" },
    { key: "oidc.seat_manager_group", label: "좌석 관리자 그룹" },
  ],
  security: [
    {
      key: "security.session_hours",
      label: "세션 유효시간 (시간)",
      type: "number",
    },
    {
      key: "security.api_key_days",
      label: "개인 키 기본 유효기간 (일)",
      type: "number",
    },
    {
      key: "security.rotation_grace_hours",
      label: "키 회전 유예시간 (시간)",
      type: "number",
    },
  ],
  ai: [
    {
      key: "ai.confidence_threshold",
      label: "좌석 후보 최소 신뢰도",
      type: "number",
    },
    {
      key: "ai.auto_approve_threshold",
      label: "자동 승인 신뢰도",
      type: "number",
    },
  ],
  hr: [
    { key: "hr.api_url", label: "인사 시스템 API URL" },
    { key: "hr.api_token", label: "API Bearer Token", secret: true },
    {
      key: "hr.schedule",
      label: "동기화 일정 (Cron)",
      help: "기본: 매일 02:00",
    },
  ],
};
export function SettingsPage() {
  const [items, setItems] = useState<Setting[]>([]),
    [values, setValues] = useState<Record<string, string>>({}),
    [tab, setTab] = useState("general"),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState("");
  const load = async () => {
    try {
      const data = await api<{ items: Setting[] }>("/api/v1/settings");
      setItems(data.items);
      setValues(Object.fromEntries(data.items.map((x) => [x.key, x.value])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "설정을 불러오지 못했습니다");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const configured = useMemo(
    () => Object.fromEntries(items.map((x) => [x.key, x.configured])),
    [items],
  );
  const dirty = useMemo(
    () => items.some((item) => (values[item.key] ?? "") !== item.value),
    [items, values],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = async () => {
    setSaving(true);
    try {
      await putJSON("/api/v1/settings", { settings: values });
      setMessage("설정을 저장했습니다. 새 요청부터 즉시 적용됩니다.");
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다");
      return false;
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    try {
      if (!(await save())) return;
      const result = await api<{ issuer: string; redirectUri: string }>(
        "/api/v1/settings/oidc/test",
        { method: "POST" },
      );
      setMessage(
        `Keycloak Discovery 연결 성공 · Callback ${result.redirectUri}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결하지 못했습니다");
    }
  };
  const syncNow = async () => {
    try {
      if (!(await save())) return;
      const result = await api<{ employees: number; organizations: number }>(
        "/api/v1/settings/hr/sync",
        { method: "POST" },
      );
      setMessage(
        `인사 동기화 완료 · 직원 ${result.employees}명, 조직 ${result.organizations}개`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "동기화하지 못했습니다");
    }
  };
  const changePassword = async () => {
    try {
      await postJSON("/api/v1/auth/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setMessage(
        "관리자 비밀번호를 변경했습니다. 다른 세션은 로그아웃되었습니다.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "비밀번호를 변경하지 못했습니다",
      );
    }
  };
  const switchValue = (key: string) => (
    <FormControlLabel
      control={
        <Switch
          checked={values[key] === "true"}
          onChange={(e) =>
            setValues((v) => ({ ...v, [key]: String(e.target.checked) }))
          }
        />
      }
      label={
        key === "oidc.enabled"
          ? "Keycloak SSO 사용"
          : key === "auth.local_enabled"
            ? "로컬 관리자 로그인 허용"
            : key === "oidc.auto_provision"
              ? "SSO 사용자 자동 생성"
              : "자동 동기화 사용"
      }
    />
  );
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <PageHeader
        eyebrow="SYSTEM CONTROL"
        title="시스템 설정"
        description="최초 실행 환경변수는 3개뿐이며, 이후 SSO·인사·AI·보안 정책은 이 화면에서 운영합니다."
        actions={
          dirty ? (
            <Chip
              icon={<WarningAmberRounded />}
              color="warning"
              label="저장하지 않은 변경"
            />
          ) : (
            <Chip
              icon={<CheckCircleRounded />}
              color="success"
              variant="outlined"
              label="모든 변경 저장됨"
            />
          )
        }
      />
      {message && (
        <Alert severity="success" onClose={() => setMessage("")} sx={{ mb: 2 }}>
          {message}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Card>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ px: 2.5, pt: 2 }}
        >
          <Chip
            size="small"
            color={values["oidc.enabled"] === "true" ? "success" : "default"}
            variant="outlined"
            label={`Keycloak ${values["oidc.enabled"] === "true" ? "활성" : "비활성"}`}
          />
          <Chip
            size="small"
            color={values["hr.sync_enabled"] === "true" ? "success" : "default"}
            variant="outlined"
            label={`인사 동기화 ${values["hr.sync_enabled"] === "true" ? "활성" : "비활성"}`}
          />
          <Chip size="small" variant="outlined" label="오프라인 CV 엔진" />
        </Stack>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          sx={{ px: 2, borderBottom: "1px solid #E3EAEE" }}
        >
          <Tab value="general" label="일반" />
          <Tab value="oidc" label="Keycloak SSO" />
          <Tab value="security" label="보안 · 키" />
          <Tab value="ai" label="AI 분석" />
          <Tab value="hr" label="인사 연동" />
        </Tabs>
        <CardContent sx={{ p: { xs: 2, md: 4 } }}>
          {tab === "oidc" && (
            <>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={3}>
                {switchValue("oidc.enabled")}
                {switchValue("auth.local_enabled")}
                {switchValue("oidc.auto_provision")}
              </Stack>
              <Alert severity="info" sx={{ mb: 3 }}>
                Keycloak Client의 Valid Redirect URI에{" "}
                <strong>
                  {window.location.origin}/api/v1/auth/oidc/callback
                </strong>{" "}
                을 등록하세요. Client authentication은 ON으로 설정합니다.
              </Alert>
            </>
          )}
          {tab === "hr" && <Box mb={3}>{switchValue("hr.sync_enabled")}</Box>}
          <Grid container spacing={2.5}>
            {fields[tab].map((f) => (
              <Grid key={f.key} size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  label={f.label}
                  type={f.secret ? "password" : f.type || "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                  helperText={
                    f.help ||
                    (f.secret && configured[f.key]
                      ? "암호화되어 저장되어 있습니다. 변경할 때만 새 값을 입력하세요."
                      : " ")
                  }
                />
              </Grid>
            ))}
          </Grid>
          {tab === "ai" && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              SeatOn 기본 분석기는 오프라인 CV 엔진입니다. 신뢰도 기준을 높이면
              자동 생성 수가 줄고 관리자 확인 품질이 높아집니다.
            </Alert>
          )}
          {tab === "security" && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="h6">내 로컬 관리자 비밀번호</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                SSO 계정은 Keycloak에서 변경합니다. 변경 시 현재 세션을 제외한
                다른 세션이 종료됩니다.
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  type="password"
                  label="현재 비밀번호"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
                <TextField
                  type="password"
                  label="새 비밀번호 (12자 이상)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  variant="outlined"
                  disabled={!currentPassword || newPassword.length < 12}
                  onClick={() => void changePassword()}
                >
                  비밀번호 변경
                </Button>
              </Stack>
            </Box>
          )}
          <Divider sx={{ my: 3 }} />
          <Stack
            direction={{ xs: "column-reverse", sm: "row" }}
            justifyContent="flex-end"
            spacing={1}
            sx={{
              position: "sticky",
              bottom: 0,
              bgcolor: "background.paper",
              py: 1,
              zIndex: 1,
            }}
          >
            {tab === "hr" && (
              <Button
                startIcon={<LinkRounded />}
                onClick={() => void syncNow()}
              >
                저장 후 지금 동기화
              </Button>
            )}
            {tab === "oidc" && (
              <Button startIcon={<LinkRounded />} onClick={() => void test()}>
                저장 후 연결 테스트
              </Button>
            )}
            <Button
              variant="contained"
              startIcon={<SaveRounded />}
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? "저장 중…" : "설정 저장"}
            </Button>
          </Stack>
        </CardContent>
      </Card>
      <Stack direction="row" spacing={1} mt={2}>
        <Chip label="비밀값 AES-256-GCM 암호화" variant="outlined" />
        <Chip label="설정 변경 감사로그" variant="outlined" />
      </Stack>
    </Box>
  );
}
