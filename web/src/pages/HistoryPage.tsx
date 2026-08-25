import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Skeleton,
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
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import HistoryToggleOffRounded from "@mui/icons-material/HistoryToggleOffRounded";
import RestartAltRounded from "@mui/icons-material/RestartAltRounded";
import { api } from "../api";
import { PageHeader } from "../components/AdminUI";
import {
  absoluteTime,
  dayRangeToISO,
  relativeTime,
  safeFileName,
  SOURCE_LABELS,
  sourceLabel,
  toCSV,
} from "../lib/format";

type Item = {
  id: string;
  changedAt: string;
  employeeNo: string;
  employeeName: string;
  previousSeat: string;
  newSeat: string;
  actor: string;
  reason: string;
  source: string;
};

const PAGE_SIZE = 100;
const EMPTY_FILTERS = { q: "", source: "", from: "", to: "" };

export function HistoryPage() {
  const [items, setItems] = useState<Item[]>([]),
    [total, setTotal] = useState(0),
    [limit, setLimit] = useState(PAGE_SIZE),
    [filters, setFilters] = useState(EMPTY_FILTERS),
    // 입력 중에 매 글자 요청하지 않도록 확정된 조건만 따로 둔다.
    [applied, setApplied] = useState(EMPTY_FILTERS),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (applied.q) params.set("q", applied.q);
      if (applied.source) params.set("source", applied.source);
      // 날짜 경계는 사용자 시간대를 아는 브라우저가 시각으로 바꿔 넘긴다.
      const range = dayRangeToISO(applied.from, applied.to);
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      const data = await api<{ items: Item[]; total: number }>(
        `/api/v1/seat-history?${params}`,
      );
      setItems(data.items);
      setTotal(data.total ?? data.items.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이력을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, [applied, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtering = useMemo(
    () => Object.values(applied).some(Boolean),
    [applied],
  );
  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    setLimit(PAGE_SIZE);
    setApplied(filters);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setLimit(PAGE_SIZE);
  };

  // 감사 목적으로 조회한 그대로를 파일로 남길 수 있어야 한다.
  const exportCsv = () => {
    const csv = toCSV(
      [
        "변경일시",
        "사번",
        "직원",
        "이전 좌석",
        "새 좌석",
        "처리자",
        "사유",
        "방식",
      ],
      items.map((x) => [
        absoluteTime(x.changedAt),
        x.employeeNo,
        x.employeeName,
        x.previousSeat || "미배정",
        x.newSeat || "해제",
        x.actor,
        x.reason,
        sourceLabel(x.source),
      ]),
    );
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = safeFileName(
      `좌석변경이력_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
      <PageHeader
        eyebrow="AUDIT TRAIL"
        title="변경 이력"
        description="좌석 이동은 별도 입력 없이 처리 주체와 사유까지 자동 기록됩니다."
        actions={
          <Button
            variant="outlined"
            startIcon={<DownloadRounded />}
            onClick={exportCsv}
            disabled={!items.length}
          >
            CSV 내보내기
          </Button>
        }
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Paper component="form" onSubmit={submit} sx={{ p: 2, mb: 2.5 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ md: "center" }}
        >
          <TextField
            size="small"
            fullWidth
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="이름, 사번, 좌석 번호"
            slotProps={{
              input: {
                startAdornment: (
                  <SearchRounded sx={{ mr: 1, color: "text.disabled" }} />
                ),
              },
            }}
          />
          <TextField
            select
            size="small"
            label="방식"
            value={filters.source}
            onChange={(e) =>
              setFilters((f) => ({ ...f, source: e.target.value }))
            }
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">전체</MenuItem>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="시작일"
            value={filters.from}
            onChange={(e) =>
              setFilters((f) => ({ ...f, from: e.target.value }))
            }
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="종료일"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={1}>
            <Button type="submit" variant="contained">
              조회
            </Button>
            <Tooltip title="조건 초기화">
              <span>
                <Button
                  onClick={reset}
                  disabled={!filtering && !Object.values(filters).some(Boolean)}
                >
                  <RestartAltRounded />
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Paper>

      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ mb: 1.5, minHeight: 28 }}
      >
        {loading ? (
          <CircularProgress size={16} />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {filtering
              ? `조건에 맞는 ${total}건 중 ${items.length}건`
              : `전체 ${total}건 중 ${items.length}건`}
          </Typography>
        )}
      </Stack>

      {loading ? (
        <Paper sx={{ p: 2 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </Paper>
      ) : items.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: "center" }}>
          <HistoryToggleOffRounded
            sx={{ fontSize: 44, color: "text.disabled", mb: 1 }}
          />
          <Typography color="text.secondary">
            {filtering
              ? "조건에 맞는 변경 이력이 없습니다."
              : "아직 좌석 변경 이력이 없습니다."}
          </Typography>
          {filtering && (
            <Button onClick={reset} sx={{ mt: 1.5 }}>
              조건 초기화
            </Button>
          )}
        </Paper>
      ) : (
        <>
          <TableContainer component={Paper} sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label="좌석 변경 이력">
              <TableHead>
                <TableRow>
                  <TableCell>변경일시</TableCell>
                  <TableCell>직원</TableCell>
                  <TableCell>좌석 변경</TableCell>
                  <TableCell>처리자</TableCell>
                  <TableCell>사유</TableCell>
                  <TableCell>방식</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((x) => (
                  <TableRow key={x.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title={absoluteTime(x.changedAt)}>
                        <span>{relativeTime(x.changedAt)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>
                        {x.employeeName || "-"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {x.employeeNo}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={x.previousSeat || "미배정"}
                      />
                      <ArrowForwardRounded
                        sx={{ fontSize: 16, verticalAlign: "middle", mx: 0.5 }}
                      />
                      <Chip
                        size="small"
                        color={x.newSeat ? "primary" : "default"}
                        label={x.newSeat || "해제"}
                      />
                    </TableCell>
                    <TableCell>{x.actor}</TableCell>
                    <TableCell>{x.reason || "-"}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={sourceLabel(x.source)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {items.length < total && (
            <Stack alignItems="center" sx={{ mt: 2 }}>
              <Button
                onClick={() => setLimit((n) => Math.min(500, n + PAGE_SIZE))}
                disabled={loading || limit >= 500}
              >
                {limit >= 500
                  ? "한 번에 최대 500건까지 볼 수 있습니다"
                  : `더 보기 (남은 ${total - items.length}건)`}
              </Button>
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}
