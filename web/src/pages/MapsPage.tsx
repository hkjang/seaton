import { useEffect, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddBusinessRounded from "@mui/icons-material/AddBusinessRounded";
import LayersRounded from "@mui/icons-material/LayersRounded";
import UploadFileRounded from "@mui/icons-material/UploadFileRounded";
import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded";
import PublishRounded from "@mui/icons-material/PublishRounded";
import GridOnRounded from "@mui/icons-material/GridOnRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import EditLocationAltRounded from "@mui/icons-material/EditLocationAltRounded";
import EventSeatRounded from "@mui/icons-material/EventSeatRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import { useNavigate } from "react-router-dom";
import { api, postJSON } from "../api";
import { PageHeader } from "../components/AdminUI";
import type { Building, Floor, FloorMap } from "../types";

type DialogName = "building" | "floor" | "upload" | "grid" | null;
export function MapsPage() {
  const navigate = useNavigate();
  const [buildings, setBuildings] = useState<Building[]>([]),
    [floors, setFloors] = useState<Floor[]>([]),
    [maps, setMaps] = useState<FloorMap[]>([]),
    [dialog, setDialog] = useState<DialogName>(null),
    [selectedMap, setSelectedMap] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const load = async () => {
    try {
      const [b, f, m] = await Promise.all([
        api<{ items: Building[] }>("/api/v1/buildings"),
        api<{ items: Floor[] }>("/api/v1/floors"),
        api<{ items: FloorMap[] }>("/api/v1/floor-maps"),
      ]);
      setBuildings(b.items);
      setFloors(f.items);
      setMaps(m.items);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "도면 정보를 불러오지 못했습니다",
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const action = async (path: string, label: string) => {
    try {
      const result = await api<{ message?: string }>(path, { method: "POST" });
      setMessage(result?.message || label);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청에 실패했습니다");
    }
  };
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
      <PageHeader
        eyebrow="OFFICE DIGITAL TWIN"
        title="도면 · 좌석"
        description="사업장 구성부터 AI 분석, 좌석 보정, 게시까지 한 흐름으로 관리합니다."
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={<AddBusinessRounded />}
              onClick={() => setDialog("building")}
            >
              사업장
            </Button>
            <Button
              variant="outlined"
              startIcon={<LayersRounded />}
              onClick={() => setDialog("floor")}
              disabled={!buildings.length}
            >
              층
            </Button>
            <Button
              variant="contained"
              startIcon={<UploadFileRounded />}
              onClick={() => setDialog("upload")}
              disabled={!floors.length}
            >
              도면 업로드
            </Button>
          </Stack>
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
      <Paper sx={{ p: 2, mb: 2.5 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          divider={
            <ArrowForwardRounded
              sx={{ color: "text.disabled", alignSelf: "center" }}
            />
          }
          spacing={1}
        >
          {[
            {
              label: "1. 사업장",
              done: buildings.length > 0,
              detail: `${buildings.length}개`,
            },
            {
              label: "2. 층",
              done: floors.length > 0,
              detail: `${floors.length}개`,
            },
            {
              label: "3. 도면",
              done: maps.length > 0,
              detail: `${maps.length}개 버전`,
            },
            {
              label: "4. AI 분석",
              done: maps.some((map) => map.status !== "uploaded"),
              detail: `${maps.reduce((sum, map) => sum + (map.seatCount ?? 0), 0)}석`,
            },
            {
              label: "5. 게시",
              done: maps.some((map) => map.active),
              detail: maps.some((map) => map.active) ? "서비스 중" : "대기",
            },
          ].map((step) => (
            <Stack
              key={step.label}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ flex: 1, minWidth: 0, p: 1 }}
            >
              <CheckCircleRounded color={step.done ? "success" : "disabled"} />
              <Box minWidth={0}>
                <Typography variant="body2" fontWeight={750}>
                  {step.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {step.detail}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Paper>
      {maps.length === 0 ? (
        <Paper
          sx={{
            p: 6,
            textAlign: "center",
            borderStyle: "dashed",
            boxShadow: "none",
          }}
        >
          <LayersRounded sx={{ fontSize: 50, color: "text.disabled" }} />
          <Typography variant="h6" mt={1}>
            도면을 등록해 시작하세요
          </Typography>
          <Typography color="text.secondary">
            사업장 → 층 → PNG/JPG/PDF 도면 순으로 등록합니다.
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {maps.map((m) => (
            <Grid key={m.id} size={{ xs: 12, md: 6, lg: 4 }}>
              <Card>
                <Box
                  sx={{
                    height: 160,
                    bgcolor: "#E9EFF2",
                    backgroundImage: m.contentType.startsWith("image/")
                      ? `url(${m.contentUrl})`
                      : "none",
                    backgroundSize: "contain",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {m.contentType === "application/pdf" && (
                    <Typography color="text.secondary">
                      PDF · {m.fileName}
                    </Typography>
                  )}
                </Box>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between">
                    <Box>
                      <Typography fontWeight={750}>
                        {m.buildingName} · {m.floorName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Version {m.version}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      color={
                        m.active
                          ? "success"
                          : m.status === "failed"
                            ? "error"
                            : m.status === "review"
                              ? "warning"
                              : "default"
                      }
                      label={
                        m.active
                          ? "게시 중"
                          : m.status === "uploaded"
                            ? "분석 전"
                            : m.status === "review"
                              ? "검토 필요"
                              : m.status === "failed"
                                ? "분석 실패"
                                : m.status
                      }
                    />
                  </Stack>
                  <Stack direction="row" spacing={2.5} sx={{ mt: 2 }}>
                    <Stack direction="row" spacing={0.7} alignItems="center">
                      <EventSeatRounded fontSize="small" color="action" />
                      <Typography variant="body2">
                        <strong>{m.seatCount ?? 0}</strong>석
                      </Typography>
                    </Stack>
                    <Typography
                      variant="body2"
                      color={
                        (m.reviewCount ?? 0) > 0
                          ? "warning.main"
                          : "text.secondary"
                      }
                    >
                      검토 {m.reviewCount ?? 0}건
                    </Typography>
                  </Stack>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2, flexWrap: "wrap" }}>
                  <Button
                    size="small"
                    startIcon={<AutoAwesomeRounded />}
                    disabled={m.active}
                    onClick={() =>
                      void action(
                        `/api/v1/floor-maps/${m.id}/analyze`,
                        "AI 분석 완료",
                      )
                    }
                  >
                    AI 분석
                  </Button>
                  <Button
                    size="small"
                    startIcon={<GridOnRounded />}
                    onClick={() => {
                      setSelectedMap(m.id);
                      setDialog("grid");
                    }}
                  >
                    좌석 일괄
                  </Button>
                  <Button
                    size="small"
                    startIcon={<EditLocationAltRounded />}
                    onClick={() => navigate(`/?map=${m.id}&edit=1`)}
                  >
                    배치 편집
                  </Button>
                  {!m.active && (
                    <Button
                      size="small"
                      startIcon={<PublishRounded />}
                      onClick={() =>
                        void action(
                          `/api/v1/floor-maps/${m.id}/publish`,
                          "도면을 게시했습니다",
                        )
                      }
                    >
                      게시
                    </Button>
                  )}
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      <BuildingDialog
        open={dialog === "building"}
        onClose={() => setDialog(null)}
        done={load}
      />
      <FloorDialog
        open={dialog === "floor"}
        buildings={buildings}
        onClose={() => setDialog(null)}
        done={load}
      />
      <UploadDialog
        open={dialog === "upload"}
        floors={floors}
        onClose={() => setDialog(null)}
        done={load}
      />
      <GridDialog
        open={dialog === "grid"}
        mapId={selectedMap}
        onClose={() => setDialog(null)}
        done={() => {
          setMessage("좌석을 일괄 생성했습니다");
          return load();
        }}
      />
    </Box>
  );
}

function BuildingDialog({
  open,
  onClose,
  done,
}: {
  open: boolean;
  onClose: () => void;
  done: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [address, setAddress] = useState(""),
    [error, setError] = useState("");
  const save = async () => {
    try {
      await postJSON("/api/v1/buildings", { name, code, address });
      await done();
      onClose();
      setName("");
      setCode("");
      setAddress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>사업장 추가</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="사업장명"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="코드"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            helperText="예: HQ"
          />
          <TextField
            label="주소 (선택)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button variant="contained" onClick={() => void save()}>
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function FloorDialog({
  open,
  buildings,
  onClose,
  done,
}: {
  open: boolean;
  buildings: Building[];
  onClose: () => void;
  done: () => Promise<void>;
}) {
  const [buildingId, setBuildingId] = useState(""),
    [name, setName] = useState(""),
    [code, setCode] = useState("");
  const save = async () => {
    await postJSON("/api/v1/floors", { buildingId, name, code });
    await done();
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>층 추가</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <FormControl>
            <Select
              displayEmpty
              value={buildingId}
              onChange={(e) => setBuildingId(e.target.value)}
            >
              <MenuItem value="" disabled>
                사업장 선택
              </MenuItem>
              {buildings.map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="층 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="12층"
          />
          <TextField
            label="층 코드"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="12F"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button
          variant="contained"
          disabled={!buildingId || !name || !code}
          onClick={() => void save()}
        >
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function UploadDialog({
  open,
  floors,
  onClose,
  done,
}: {
  open: boolean;
  floors: Floor[];
  onClose: () => void;
  done: () => Promise<void>;
}) {
  const [floorId, setFloorId] = useState(""),
    [version, setVersion] = useState("1"),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("floorId", floorId);
    form.append("version", version);
    form.append("file", file);
    try {
      await api("/api/v1/floor-maps", { method: "POST", body: form });
      await done();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={save}>
        <DialogTitle>도면 업로드</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <FormControl>
              <Select
                displayEmpty
                value={floorId}
                onChange={(e) => setFloorId(e.target.value)}
              >
                <MenuItem value="" disabled>
                  층 선택
                </MenuItem>
                {floors.map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.buildingName} · {x.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="도면 버전"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              helperText="예: 2026-08 또는 1"
            />
            <Button
              component="label"
              variant="outlined"
              startIcon={<UploadFileRounded />}
            >
              {file ? file.name : "PNG, JPG, PDF 선택"}
              <input
                hidden
                type="file"
                accept="image/png,image/jpeg,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>취소</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!floorId || !version || !file || busy}
          >
            업로드
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
function GridDialog({
  open,
  mapId,
  onClose,
  done,
}: {
  open: boolean;
  mapId: string;
  onClose: () => void;
  done: () => Promise<void>;
}) {
  const [prefix, setPrefix] = useState("A-"),
    [rows, setRows] = useState(4),
    [columns, setColumns] = useState(8);
  const save = async () => {
    await postJSON("/api/v1/seats/grid", {
      floorMapId: mapId,
      prefix,
      start: 1,
      rows,
      columns,
      x: 0.1,
      y: 0.15,
      seatWidth: 0.06,
      seatHeight: 0.07,
      gapX: 0.035,
      gapY: 0.08,
    });
    await done();
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>좌석 일괄 생성</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Alert severity="info">
            도면 좌측 상단 기준으로 생성됩니다. 생성 후 좌석맵의 배치 편집에서
            여러 좌석을 선택하고 바로 이동할 수 있습니다.
          </Alert>
          <TextField
            label="좌석 번호 접두어"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="행"
              type="number"
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />
            <TextField
              label="열"
              type="number"
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
            />
          </Stack>
          <Typography fontWeight={700}>총 {rows * columns}석</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={rows * columns < 1 || rows * columns > 500}
        >
          생성
        </Button>
      </DialogActions>
    </Dialog>
  );
}
