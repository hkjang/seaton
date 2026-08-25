import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Chip,
  TextField,
  Tooltip,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import PeopleAltRounded from "@mui/icons-material/PeopleAltRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import { api, patchJSON } from "../api";
import { EmptyState, PageHeader, TableSkeleton } from "../components/AdminUI";
import { relativeTime, absoluteTime } from "../lib/format";
import type { Role, User } from "../types";
const labels: Record<Role, string> = {
  employee: "직원",
  department_manager: "부서 관리자",
  seat_manager: "좌석 관리자",
  system_admin: "시스템 관리자",
};
export function UsersPage() {
  const [items, setItems] = useState<User[]>([]),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = async () => {
    try {
      const data = await api<{ items: User[] }>("/api/v1/users");
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "사용자를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  // 사용자 수가 늘면 이름으로 찾는 것이 유일하게 현실적인 방법이다.
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((u) =>
      [u.displayName, u.username, u.email ?? ""].some((v) =>
        v.toLowerCase().includes(term),
      ),
    );
  }, [items, query]);
  const change = async (id: string, role: Role) => {
    try {
      await patchJSON(`/api/v1/users/${id}`, { role });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "권한을 변경하지 못했습니다");
    }
  };
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <PageHeader
        eyebrow="ACCESS CONTROL"
        title="사용자 권한"
        description="SSO 사용자는 최초 로그인 시 자동 생성되고 Keycloak 그룹으로 기본 권한이 결정됩니다."
        actions={
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름, 계정, 이메일"
            slotProps={{
              input: {
                startAdornment: (
                  <SearchRounded sx={{ mr: 1, color: "text.disabled" }} />
                ),
              },
            }}
          />
        }
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {loading ? (
        <TableSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<PeopleAltRounded />}
          title={
            query
              ? "조건에 맞는 사용자가 없습니다."
              : "아직 등록된 사용자가 없습니다."
          }
          description={
            query
              ? undefined
              : "Keycloak SSO로 로그인하면 사용자가 자동으로 만들어집니다."
          }
        />
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>사용자</TableCell>
                <TableCell>로그인 방식</TableCell>
                <TableCell>최근 로그인</TableCell>
                <TableCell>권한</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Avatar
                        sx={{
                          width: 34,
                          height: 34,
                          bgcolor: "primary.main",
                          fontSize: 13,
                        }}
                      >
                        {u.displayName.slice(0, 1)}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={700}>
                          {u.displayName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {u.email || u.username}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={u.source === "oidc" ? "Keycloak SSO" : "Local"}
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {u.lastLoginAt ? (
                      <Tooltip title={absoluteTime(u.lastLoginAt)}>
                        <span>{relativeTime(u.lastLoginAt)}</span>
                      </Tooltip>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      value={u.role}
                      onChange={(e) =>
                        void change(u.id, e.target.value as Role)
                      }
                    >
                      {Object.entries(labels).map(([value, label]) => (
                        <MenuItem key={value} value={value}>
                          {label}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
