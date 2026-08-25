import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRounded from "@mui/icons-material/AddRounded";
import AutorenewRounded from "@mui/icons-material/AutorenewRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import VpnKeyRounded from "@mui/icons-material/VpnKeyRounded";
import { api, postJSON } from "../api";
import { EmptyState, PageHeader, TableSkeleton } from "../components/AdminUI";
type KeyItem = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  version: number;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  graceUntil?: string;
};
export function KeysPage() {
  const [items, setItems] = useState<KeyItem[]>([]),
    [createOpen, setCreateOpen] = useState(false),
    [name, setName] = useState("내 연동 키"),
    [scopes, setScopes] = useState(["read", "mcp"]),
    [revealed, setRevealed] = useState<{ key: string; message: string } | null>(
      null,
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = async () => {
    try {
      const data = await api<{ items: KeyItem[] }>("/api/v1/api-keys");
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "키를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const create = async () => {
    try {
      const x = await postJSON<{ key: string; message: string }>(
        "/api/v1/api-keys",
        { name, scopes },
      );
      setCreateOpen(false);
      setRevealed(x);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "키를 만들지 못했습니다");
    }
  };
  const rotate = async (id: string) => {
    try {
      const x = await postJSON<{ key: string; message: string }>(
        `/api/v1/api-keys/${id}/rotate`,
        {},
      );
      setRevealed(x);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "키를 회전하지 못했습니다");
    }
  };
  const revoke = async (id: string) => {
    if (!confirm("이 키를 즉시 폐기할까요? 되돌릴 수 없습니다.")) return;
    await api(`/api/v1/api-keys/${id}`, { method: "DELETE" });
    await load();
  };
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <PageHeader
        eyebrow="PERSONAL ACCESS"
        title="내 API 키"
        description="REST API와 MCP에 사용하는 개인별 키를 생성하고 주기적으로 회전합니다."
        actions={
          <Button
            variant="contained"
            startIcon={<AddRounded />}
            onClick={() => setCreateOpen(true)}
          >
            키 만들기
          </Button>
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Alert severity="info" sx={{ mb: 2 }}>
        키 원문은 생성·회전 직후 한 번만 표시됩니다. 서버에는 복원할 수 없는
        HMAC 해시만 저장됩니다.
      </Alert>
      {loading ? (
        <TableSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<VpnKeyRounded />}
          title="아직 발급한 키가 없습니다."
          description="키를 만들면 REST API와 MCP 클라이언트에서 SeatOn에 접근할 수 있습니다."
          action={
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => setCreateOpen(true)}
            >
              키 만들기
            </Button>
          }
        />
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>이름 / 식별자</TableCell>
                <TableCell>범위</TableCell>
                <TableCell>버전</TableCell>
                <TableCell>마지막 사용</TableCell>
                <TableCell>만료</TableCell>
                <TableCell align="right">관리</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((k) => (
                <TableRow
                  key={k.id}
                  sx={{ opacity: k.revokedAt && !k.graceUntil ? 0.5 : 1 }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>
                      {k.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {k.prefix}••••••
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {k.scopes.map((s) => (
                      <Chip key={s} size="small" label={s} sx={{ mr: 0.5 }} />
                    ))}
                  </TableCell>
                  <TableCell>
                    v{k.version}
                    {k.graceUntil && (
                      <Chip
                        size="small"
                        color="warning"
                        label="회전 유예"
                        sx={{ ml: 1 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {k.lastUsedAt
                      ? new Date(k.lastUsedAt).toLocaleString("ko-KR")
                      : "사용 전"}
                  </TableCell>
                  <TableCell>
                    {k.expiresAt
                      ? new Date(k.expiresAt).toLocaleDateString("ko-KR")
                      : "제한 없음"}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="회전">
                      <IconButton
                        onClick={() => void rotate(k.id)}
                        disabled={Boolean(k.revokedAt)}
                      >
                        <AutorenewRounded />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="폐기">
                      <IconButton
                        color="error"
                        onClick={() => void revoke(k.id)}
                        disabled={Boolean(k.revokedAt)}
                      >
                        <DeleteOutlineRounded />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Typography variant="body2" color="text.secondary" mt={2}>
        MCP Endpoint: <code>{window.location.origin}/mcp</code> · Authorization:{" "}
        <code>Bearer seat_…</code>
      </Typography>
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogTitle>개인 API 키 만들기</DialogTitle>
        <DialogContent>
          <TextField
            label="키 이름"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mt: 1 }}
          />
          <Typography variant="subtitle2" mt={2}>
            허용 범위
          </Typography>
          <FormGroup row>
            {["read", "write", "mcp"].map((scope) => (
              <FormControlLabel
                key={scope}
                control={
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onChange={(e) =>
                      setScopes((v) =>
                        e.target.checked
                          ? [...v, scope]
                          : v.filter((x) => x !== scope),
                      )
                    }
                  />
                }
                label={scope}
              />
            ))}
          </FormGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>취소</Button>
          <Button
            variant="contained"
            disabled={!name || !scopes.length}
            onClick={() => void create()}
          >
            생성
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(revealed)}
        onClose={() => setRevealed(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>지금 키를 복사하세요</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {revealed?.message}
          </Alert>
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              fontFamily: "monospace",
              wordBreak: "break-all",
              bgcolor: "#F5F8F9",
            }}
          >
            {revealed?.key}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<ContentCopyRounded />}
            onClick={() =>
              void navigator.clipboard.writeText(revealed?.key || "")
            }
          >
            복사
          </Button>
          <Button variant="contained" onClick={() => setRevealed(null)}>
            보관 완료
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
