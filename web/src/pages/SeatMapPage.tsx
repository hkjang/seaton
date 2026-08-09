import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchRounded from "@mui/icons-material/SearchRounded";
import ZoomInRounded from "@mui/icons-material/ZoomInRounded";
import ZoomOutRounded from "@mui/icons-material/ZoomOutRounded";
import CenterFocusStrongRounded from "@mui/icons-material/CenterFocusStrongRounded";
import PersonPinCircleRounded from "@mui/icons-material/PersonPinCircleRounded";
import ApartmentRounded from "@mui/icons-material/ApartmentRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import OpenWithRounded from "@mui/icons-material/OpenWithRounded";
import GridOnRounded from "@mui/icons-material/GridOnRounded";
import UndoRounded from "@mui/icons-material/UndoRounded";
import RedoRounded from "@mui/icons-material/RedoRounded";
import DoneRounded from "@mui/icons-material/DoneRounded";
import VerticalAlignTopRounded from "@mui/icons-material/VerticalAlignTopRounded";
import AlignHorizontalLeftRounded from "@mui/icons-material/AlignHorizontalLeftRounded";
import RotateRightRounded from "@mui/icons-material/RotateRightRounded";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, patchJSON, postJSON } from "../api";
import { useAuth } from "../auth";
import type { Building, Employee, Floor, FloorMap, Seat } from "../types";

const seatColor = (seat: Seat) =>
  seat.type === "unavailable" || seat.status === "unavailable"
    ? "#8796A1"
    : seat.employeeId
      ? "#087E8B"
      : seat.type === "shared"
        ? "#3478C8"
        : "#FFFFFF";

type SeatPosition = Pick<Seat, "id" | "x" | "y" | "rotation">;
type MoveOperation = { before: SeatPosition[]; after: SeatPosition[] };
type ActiveDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  before: SeatPosition[];
  after: SeatPosition[];
};

const clamp = (value: number, maximum: number) =>
  Math.max(0, Math.min(maximum, value));

export function SeatMapPage() {
  const { user } = useAuth(),
    navigate = useNavigate(),
    [searchParams] = useSearchParams();
  const manager =
    user?.role === "seat_manager" || user?.role === "system_admin";
  const [buildings, setBuildings] = useState<Building[]>([]),
    [floors, setFloors] = useState<Floor[]>([]),
    [maps, setMaps] = useState<FloorMap[]>([]),
    [seats, setSeats] = useState<Seat[]>([]),
    [employees, setEmployees] = useState<Employee[]>([]);
  const [buildingId, setBuildingId] = useState(""),
    [floorId, setFloorId] = useState(""),
    [mapId, setMapId] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Seat | null>(null),
    [loading, setLoading] = useState(true),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<Partial<Seat> | null>(null);
  const [editMode, setEditMode] = useState(
      Boolean(manager && searchParams.get("edit") === "1"),
    ),
    [snapEnabled, setSnapEnabled] = useState(true),
    [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()),
    [undoStack, setUndoStack] = useState<MoveOperation[]>([]),
    [redoStack, setRedoStack] = useState<MoveOperation[]>([]),
    [moving, setMoving] = useState(false);
  const dragRef = useRef<ActiveDrag | null>(null);
  const lastSearchRef = useRef("");
  const loadBase = async () => {
    setLoading(true);
    try {
      const [b, f, m] = await Promise.all([
        api<{ items: Building[] }>("/api/v1/buildings"),
        api<{ items: Floor[] }>("/api/v1/floors"),
        api<{ items: FloorMap[] }>("/api/v1/floor-maps"),
      ]);
      setBuildings(b.items);
      setFloors(f.items);
      setMaps(m.items);
      const requestedMap = m.items.find(
        (item) => item.id === searchParams.get("map"),
      );
      const requestedFloor = f.items.find(
        (item) => item.id === requestedMap?.floorId,
      );
      const bid =
        requestedFloor?.buildingId || buildingId || b.items[0]?.id || "";
      setBuildingId(bid);
      const fid =
        requestedMap?.floorId ||
        floorId ||
        f.items.find((x) => x.buildingId === bid)?.id ||
        "";
      setFloorId(fid);
      const mid =
        requestedMap?.id ||
        m.items.find((x) => x.floorId === fid && x.active)?.id ||
        m.items.find((x) => x.floorId === fid)?.id ||
        "";
      setMapId(mid);
      if (mid) {
        const data = await api<{ items: Seat[] }>(
          `/api/v1/seats?floorMapId=${mid}`,
        );
        setSeats(data.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadBase();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const buildingFloors = useMemo(
    () => floors.filter((f) => f.buildingId === buildingId),
    [floors, buildingId],
  );
  const floorMaps = useMemo(
    () => maps.filter((m) => m.floorId === floorId),
    [maps, floorId],
  );
  const currentMap = maps.find((m) => m.id === mapId);
  const chooseBuilding = (id: string) => {
    setBuildingId(id);
    const fid = floors.find((f) => f.buildingId === id)?.id || "";
    chooseFloor(fid);
  };
  const chooseFloor = (id: string) => {
    setFloorId(id);
    const mid =
      maps.find((m) => m.floorId === id && m.active)?.id ||
      maps.find((m) => m.floorId === id)?.id ||
      "";
    void chooseMap(mid);
  };
  const chooseMap = async (id: string) => {
    setMapId(id);
    setSelected(null);
    setSelectedIds(new Set());
    setUndoStack([]);
    setRedoStack([]);
    if (!id) {
      setSeats([]);
      return;
    }
    try {
      const data = await api<{ items: Seat[] }>(
        `/api/v1/seats?floorMapId=${id}`,
      );
      setSeats(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "좌석을 불러오지 못했습니다");
    }
  };
  const runSearch = async (term: string) => {
    if (!term.trim()) {
      setEmployees([]);
      return;
    }
    try {
      const data = await api<{ items: Employee[] }>(
        `/api/v1/employees?q=${encodeURIComponent(term)}&limit=30`,
      );
      setEmployees(data.items);
      const first = data.items.find((x) => x.seatId);
      if (first?.seatId) {
        const found = seats.find((s) => s.id === first.seatId);
        if (found) setSelected(found);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색하지 못했습니다");
    }
  };
  const search = (event?: FormEvent) => {
    event?.preventDefault();
    void runSearch(query);
  };
  useEffect(() => {
    const term = searchParams.get("q")?.trim();
    const key = `${mapId}:${term}`;
    if (!term || !mapId || key === lastSearchRef.current) return;
    lastSearchRef.current = key;
    setQuery(term);
    void runSearch(term);
  }, [mapId, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps
  const drop = async (event: DragEvent, seat: Seat) => {
    event.preventDefault();
    if (!manager) return;
    const employeeId = event.dataTransfer.getData(
      "application/seaton-employee",
    );
    if (!employeeId) return;
    try {
      await postJSON("/api/v1/seat-assignments", {
        employeeId,
        seatId: seat.id,
        reason: "좌석맵 Drag & Drop",
        source: "manual",
      });
      await chooseMap(mapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "좌석을 배정하지 못했습니다");
    }
  };
  const openNewSeat = (x = 0.45, y = 0.45) =>
    setEditor({
      floorMapId: mapId,
      seatNo: `NEW-${String(seats.length + 1).padStart(3, "0")}`,
      type: "fixed",
      status: "available",
      x: Math.max(0, Math.min(0.94, x)),
      y: Math.max(0, Math.min(0.92, y)),
      width: 0.04,
      height: 0.055,
      rotation: 0,
    });
  const mapDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!manager || !editMode) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    openNewSeat(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    );
  };
  const saveSeat = async () => {
    if (!editor) return;
    try {
      const body = {
        seatNo: editor.seatNo,
        type: editor.type,
        status: editor.status,
        x: Number(editor.x),
        y: Number(editor.y),
        width: Number(editor.width),
        height: Number(editor.height),
        rotation: Number(editor.rotation),
      };
      if (editor.id) await patchJSON(`/api/v1/seats/${editor.id}`, body);
      else await postJSON("/api/v1/seats", { ...body, floorMapId: mapId });
      setEditor(null);
      await chooseMap(mapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "좌석을 저장하지 못했습니다");
    }
  };
  const removeSeat = async () => {
    if (!selected || selected.employeeId) return;
    if (!confirm(`${selected.seatNo} 좌석을 삭제할까요?`)) return;
    try {
      await api(`/api/v1/seats/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      await chooseMap(mapId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "좌석을 삭제하지 못했습니다");
    }
  };
  const updateLocalPositions = (positions: SeatPosition[]) => {
    const byID = new Map(positions.map((position) => [position.id, position]));
    setSeats((current) =>
      current.map((seat) => {
        const position = byID.get(seat.id);
        return position ? { ...seat, ...position } : seat;
      }),
    );
    setSelected((current) => {
      if (!current) return current;
      const position = byID.get(current.id);
      return position ? { ...current, ...position } : current;
    });
  };
  const persistPositions = async (positions: SeatPosition[]) =>
    patchJSON<{ updated: number }>("/api/v1/seats/bulk", {
      updates: positions,
    });
  const commitOperation = async (operation: MoveOperation) => {
    if (
      operation.before.every((position, index) => {
        const after = operation.after[index];
        return (
          after &&
          position.x === after.x &&
          position.y === after.y &&
          position.rotation === after.rotation
        );
      })
    )
      return;
    setMoving(true);
    try {
      await persistPositions(operation.after);
      setUndoStack((current) => [...current.slice(-39), operation]);
      setRedoStack([]);
    } catch (e) {
      updateLocalPositions(operation.before);
      setError(
        e instanceof Error ? e.message : "좌석 위치를 저장하지 못했습니다",
      );
    } finally {
      setMoving(false);
    }
  };
  const beginSeatMove = (event: ReactPointerEvent<SVGGElement>, seat: Seat) => {
    if (!manager || !editMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(seat);
    if (event.shiftKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(seat.id)) next.delete(seat.id);
        else next.add(seat.id);
        return next;
      });
      return;
    }
    const ids = selectedIds.has(seat.id)
      ? selectedIds
      : new Set<string>([seat.id]);
    setSelectedIds(new Set(ids));
    const before = seats
      .filter((item) => ids.has(item.id))
      .map(({ id, x, y, rotation }) => ({ id, x, y, rotation }));
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
      before,
      after: before,
    };
  };
  const moveSeats = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / drag.width;
    const dy = (event.clientY - drag.startY) / drag.height;
    const step = snapEnabled ? 0.005 : 0.001;
    const after = drag.before.map((position) => {
      const seat = seats.find((item) => item.id === position.id);
      const x = clamp(
        Math.round((position.x + dx) / step) * step,
        1 - (seat?.width ?? 0),
      );
      const y = clamp(
        Math.round((position.y + dy) / step) * step,
        1 - (seat?.height ?? 0),
      );
      return { ...position, x, y };
    });
    drag.after = after;
    updateLocalPositions(after);
  };
  const finishSeatMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    void commitOperation({ before: drag.before, after: drag.after });
  };
  const applyTransform = (
    kind: "left" | "top" | "rotate" | "nudge",
    dx = 0,
    dy = 0,
  ) => {
    const chosen = seats.filter((seat) => selectedIds.has(seat.id));
    if (!chosen.length) return;
    const before = chosen.map(({ id, x, y, rotation }) => ({
      id,
      x,
      y,
      rotation,
    }));
    const left = Math.min(...chosen.map((seat) => seat.x));
    const top = Math.min(...chosen.map((seat) => seat.y));
    const after = chosen.map((seat) => ({
      id: seat.id,
      x: kind === "left" ? left : clamp(seat.x + dx, 1 - seat.width),
      y: kind === "top" ? top : clamp(seat.y + dy, 1 - seat.height),
      rotation: kind === "rotate" ? (seat.rotation + 90) % 360 : seat.rotation,
    }));
    updateLocalPositions(after);
    void commitOperation({ before, after });
  };
  const undo = async () => {
    const operation = undoStack.at(-1);
    if (!operation || moving) return;
    setMoving(true);
    updateLocalPositions(operation.before);
    try {
      await persistPositions(operation.before);
      setUndoStack((current) => current.slice(0, -1));
      setRedoStack((current) => [...current, operation]);
    } catch (e) {
      updateLocalPositions(operation.after);
      setError(
        e instanceof Error ? e.message : "실행 취소를 저장하지 못했습니다",
      );
    } finally {
      setMoving(false);
    }
  };
  const redo = async () => {
    const operation = redoStack.at(-1);
    if (!operation || moving) return;
    setMoving(true);
    updateLocalPositions(operation.after);
    try {
      await persistPositions(operation.after);
      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [...current, operation]);
    } catch (e) {
      updateLocalPositions(operation.before);
      setError(
        e instanceof Error ? e.message : "다시 실행을 저장하지 못했습니다",
      );
    } finally {
      setMoving(false);
    }
  };
  useEffect(() => {
    if (!editMode) return;
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void redo();
        else void undo();
        return;
      }
      if (event.key === "Escape") {
        setSelectedIds(new Set());
        setSelected(null);
        return;
      }
      const distance = event.shiftKey ? 0.02 : 0.005;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-distance, 0],
        ArrowRight: [distance, 0],
        ArrowUp: [0, -distance],
        ArrowDown: [0, distance],
      };
      if (delta[event.key]) {
        event.preventDefault();
        applyTransform("nudge", ...delta[event.key]);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });
  const selectedEmployee = selected?.employeeId
    ? employees.find((e) => e.id === selected.employeeId)
    : undefined;
  if (loading)
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Skeleton height={60} />
        <Skeleton variant="rounded" height="70vh" />
      </Box>
    );
  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        height: { md: "calc(100vh - 72px)" },
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Box
        sx={{
          display: "flex",
          alignItems: { xs: "stretch", md: "center" },
          gap: 1.5,
          flexDirection: { xs: "column", md: "row" },
        }}
      >
        <Box>
          <Typography variant="h5">좌석맵</Typography>
          <Typography variant="body2" color="text.secondary">
            사람과 조직의 현재 위치를 한눈에 확인하세요.
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {manager && currentMap && (
          <Stack direction="row" spacing={1}>
            {editMode && (
              <Button
                variant="outlined"
                startIcon={<AddRounded />}
                onClick={() => openNewSeat()}
              >
                좌석 추가
              </Button>
            )}
            <Button
              variant={editMode ? "contained" : "outlined"}
              startIcon={editMode ? <DoneRounded /> : <OpenWithRounded />}
              onClick={() => {
                setEditMode((value) => !value);
                setSelectedIds(new Set());
              }}
            >
              {editMode ? "편집 완료" : "배치 편집"}
            </Button>
          </Stack>
        )}
        <Stack direction="row" spacing={1} sx={{ overflowX: "auto" }}>
          <FormControl sx={{ minWidth: 145 }}>
            <Select
              value={buildingId}
              displayEmpty
              onChange={(e) => chooseBuilding(e.target.value)}
            >
              {buildings.length ? (
                buildings.map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {x.name}
                  </MenuItem>
                ))
              ) : (
                <MenuItem value="">사업장 없음</MenuItem>
              )}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 120 }}>
            <Select
              value={floorId}
              displayEmpty
              onChange={(e) => chooseFloor(e.target.value)}
            >
              {buildingFloors.map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {floorMaps.length > 1 && (
            <FormControl sx={{ minWidth: 110 }}>
              <Select
                value={mapId}
                onChange={(e) => void chooseMap(e.target.value)}
              >
                {floorMaps.map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    V{x.version}
                    {x.active ? " · 게시" : ""}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Stack>
      </Box>
      {!currentMap ? (
        <Paper
          sx={{
            flex: 1,
            minHeight: 420,
            display: "grid",
            placeItems: "center",
            borderStyle: "dashed",
            boxShadow: "none",
          }}
        >
          <Stack alignItems="center" spacing={2}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                bgcolor: "rgba(8,126,139,.09)",
                color: "primary.main",
              }}
            >
              <ApartmentRounded fontSize="large" />
            </Box>
            <Box textAlign="center">
              <Typography variant="h6">표시할 좌석맵이 없습니다</Typography>
              <Typography color="text.secondary">
                관리자가 사업장과 도면을 등록하면 이곳에서 바로 찾을 수 있어요.
              </Typography>
            </Box>
            {manager && (
              <Button
                variant="contained"
                startIcon={<AddRounded />}
                onClick={() => navigate("/admin/maps")}
              >
                첫 도면 등록
              </Button>
            )}
          </Stack>
        </Paper>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              lg: "260px minmax(500px,1fr) 270px",
            },
            gap: 2,
            flex: 1,
            minHeight: 0,
          }}
        >
          <Paper
            sx={{
              p: 2,
              display: "flex",
              flexDirection: "column",
              minHeight: { xs: 240, lg: 0 },
              overflow: "hidden",
            }}
          >
            <Box component="form" onSubmit={search}>
              <TextField
                fullWidth
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름, 사번, 조직 검색"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRounded />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1.5, mb: 1 }}
            >
              {employees.length
                ? `${employees.length}명 검색됨`
                : "사람 또는 조직을 검색하세요"}
            </Typography>
            <Stack spacing={0.75} sx={{ overflowY: "auto" }}>
              {employees.map((e) => (
                <Box
                  key={e.id}
                  draggable={manager}
                  onDragStart={(event) =>
                    event.dataTransfer.setData(
                      "application/seaton-employee",
                      e.id,
                    )
                  }
                  onClick={() => {
                    const seat = seats.find((s) => s.id === e.seatId);
                    if (seat) setSelected(seat);
                  }}
                  sx={{
                    display: "flex",
                    gap: 1.2,
                    p: 1,
                    borderRadius: 2,
                    cursor: e.seatId ? "pointer" : "default",
                    "&:hover": { bgcolor: "#F1F6F7" },
                  }}
                >
                  <Avatar
                    sx={{
                      width: 34,
                      height: 34,
                      fontSize: 13,
                      bgcolor: e.seatId ? "primary.main" : "grey.400",
                    }}
                  >
                    {e.name.slice(0, 1)}
                  </Avatar>
                  <Box minWidth={0}>
                    <Typography variant="body2" fontWeight={700} noWrap>
                      {e.name}{" "}
                      <Typography
                        component="span"
                        variant="caption"
                        color="text.secondary"
                      >
                        {e.employeeNo}
                      </Typography>
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      display="block"
                    >
                      {e.organizationName || "소속 없음"} ·{" "}
                      {e.seatNo || "미배정"}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Stack>
          </Paper>
          <Paper
            sx={{
              position: "relative",
              overflow: "hidden",
              minHeight: { xs: 430, lg: 0 },
              bgcolor: "#E9EFF2",
            }}
          >
            {editMode && (
              <Box
                sx={{
                  position: "absolute",
                  top: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 3,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  p: 0.5,
                  bgcolor: "rgba(7,26,43,.92)",
                  color: "white",
                  borderRadius: 2,
                  boxShadow: 3,
                }}
              >
                <Chip
                  size="small"
                  icon={<GridOnRounded />}
                  label={snapEnabled ? "5px 스냅" : "자유 이동"}
                  onClick={() => setSnapEnabled((value) => !value)}
                  sx={{ bgcolor: "rgba(255,255,255,.12)", color: "white" }}
                />
                <Tooltip title="실행 취소 · Ctrl/⌘ Z">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!undoStack.length || moving}
                      onClick={() => void undo()}
                      sx={{ color: "white" }}
                    >
                      <UndoRounded />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="다시 실행 · Ctrl/⌘ Shift Z">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!redoStack.length || moving}
                      onClick={() => void redo()}
                      sx={{ color: "white" }}
                    >
                      <RedoRounded />
                    </IconButton>
                  </span>
                </Tooltip>
                <Typography
                  variant="caption"
                  sx={{ px: 0.7, whiteSpace: "nowrap" }}
                >
                  {moving
                    ? "저장 중…"
                    : selectedIds.size
                      ? `${selectedIds.size}개 선택`
                      : "Shift로 다중 선택"}
                </Typography>
              </Box>
            )}
            <Box
              sx={{
                position: "absolute",
                top: 12,
                left: 12,
                zIndex: 2,
                display: "flex",
                gap: 0.5,
                p: 0.5,
                bgcolor: "rgba(255,255,255,.92)",
                borderRadius: 2,
                boxShadow: 2,
              }}
            >
              <Tooltip title="축소">
                <IconButton
                  size="small"
                  onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))}
                >
                  <ZoomOutRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title="맞춤">
                <IconButton size="small" onClick={() => setZoom(1)}>
                  <CenterFocusStrongRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title="확대">
                <IconButton
                  size="small"
                  onClick={() => setZoom((z) => Math.min(2.2, z + 0.2))}
                >
                  <ZoomInRounded />
                </IconButton>
              </Tooltip>
            </Box>
            <Box
              sx={{
                width: "100%",
                height: "100%",
                overflow: "auto",
                display: "grid",
                placeItems: "center",
                p: 2,
              }}
            >
              {currentMap.contentType === "application/pdf" ? (
                <Box
                  sx={{ width: "100%", height: "100%", position: "relative" }}
                >
                  <object
                    data={currentMap.contentUrl}
                    type="application/pdf"
                    width="100%"
                    height="100%"
                    aria-label="PDF 도면"
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      position: "absolute",
                      bottom: 8,
                      left: 8,
                      bgcolor: "white",
                      px: 1,
                    }}
                  >
                    PDF 도면의 좌석 오버레이는 이미지 변환 분석 후 표시됩니다.
                  </Typography>
                </Box>
              ) : (
                <svg
                  role="img"
                  aria-label={`${currentMap.floorName} 좌석 배치도`}
                  viewBox="0 0 1000 700"
                  onDoubleClick={mapDoubleClick}
                  onPointerMove={moveSeats}
                  onPointerUp={finishSeatMove}
                  onPointerCancel={finishSeatMove}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) {
                      setSelected(null);
                      setSelectedIds(new Set());
                    }
                  }}
                  style={{
                    width: `${zoom * 100}%`,
                    height: `${zoom * 100}%`,
                    minWidth: 720,
                    minHeight: 500,
                    background: "#fff",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(14,45,62,.1)",
                  }}
                >
                  <image
                    href={currentMap.contentUrl}
                    x="0"
                    y="0"
                    width="1000"
                    height="700"
                    preserveAspectRatio="xMidYMid meet"
                    opacity=".9"
                  />
                  {seats.map((seat) => (
                    <g
                      key={seat.id}
                      transform={`rotate(${seat.rotation} ${seat.x * 1000 + seat.width * 500} ${seat.y * 700 + seat.height * 350})`}
                      onPointerDown={(event) => beginSeatMove(event, seat)}
                      onClick={() => {
                        if (!editMode) setSelected(seat);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (manager && editMode) setEditor(seat);
                      }}
                      onDragOver={(e) => manager && e.preventDefault()}
                      onDrop={(e) => void drop(e, seat)}
                      style={{
                        cursor: editMode ? "move" : "pointer",
                        touchAction: editMode ? "none" : "auto",
                      }}
                    >
                      <rect
                        x={seat.x * 1000}
                        y={seat.y * 700}
                        width={seat.width * 1000}
                        height={seat.height * 700}
                        rx="6"
                        fill={seatColor(seat)}
                        stroke={
                          selectedIds.has(seat.id) || selected?.id === seat.id
                            ? "#FFB703"
                            : seat.confidence && seat.confidence < 0.95
                              ? "#E79418"
                              : "#263E4D"
                        }
                        strokeWidth={
                          selectedIds.has(seat.id) || selected?.id === seat.id
                            ? 5
                            : 2
                        }
                      />
                      <text
                        x={(seat.x + seat.width / 2) * 1000}
                        y={(seat.y + seat.height / 2) * 700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill={seat.employeeId ? "white" : "#203846"}
                        style={{ pointerEvents: "none" }}
                      >
                        {seat.employeeName || seat.seatNo}
                      </text>
                    </g>
                  ))}
                </svg>
              )}
            </Box>
            <Box
              sx={{
                position: "absolute",
                right: 12,
                bottom: 12,
                display: "flex",
                gap: 0.75,
                bgcolor: "rgba(255,255,255,.92)",
                borderRadius: 2,
                p: 1,
              }}
            >
              {[
                ["#087E8B", "배정"],
                ["#FFF", "빈 좌석"],
                ["#3478C8", "공용"],
                ["#8796A1", "사용불가"],
              ].map(([color, label]) => (
                <Stack
                  key={label}
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                >
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: 0.5,
                      bgcolor: color,
                      border: "1px solid #8796A1",
                    }}
                  />
                  <Typography variant="caption">{label}</Typography>
                </Stack>
              ))}
            </Box>
          </Paper>
          <Paper sx={{ p: 2.5, minHeight: { xs: 220, lg: 0 } }}>
            {editMode && selectedIds.size > 1 ? (
              <Stack spacing={2.2}>
                <Box>
                  <Chip size="small" color="primary" label="다중 선택" />
                  <Typography variant="h5" sx={{ mt: 1.5 }}>
                    좌석 {selectedIds.size}개
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    선택한 좌석을 한 번에 정렬하거나 회전할 수 있습니다.
                  </Typography>
                </Box>
                <Divider />
                <Button
                  variant="outlined"
                  startIcon={<AlignHorizontalLeftRounded />}
                  onClick={() => applyTransform("left")}
                >
                  왼쪽 맞춤
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<VerticalAlignTopRounded />}
                  onClick={() => applyTransform("top")}
                >
                  위쪽 맞춤
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<RotateRightRounded />}
                  onClick={() => applyTransform("rotate")}
                >
                  90° 회전
                </Button>
                <Alert severity="info" icon={<OpenWithRounded />}>
                  Shift+클릭으로 선택을 추가하고, 방향키로 5px씩 이동합니다.
                  Shift+방향키는 20px 이동입니다.
                </Alert>
                <Button
                  color="inherit"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setSelected(null);
                  }}
                >
                  선택 해제
                </Button>
              </Stack>
            ) : selected ? (
              <>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Chip
                    label={
                      selected.type === "shared"
                        ? "공용 좌석"
                        : selected.status === "unavailable"
                          ? "사용 불가"
                          : selected.employeeId
                            ? "배정됨"
                            : "빈 좌석"
                    }
                    size="small"
                    color={selected.employeeId ? "primary" : "default"}
                  />
                  {selected.confidence != null && (
                    <Typography
                      variant="caption"
                      color={
                        selected.confidence < 0.95
                          ? "warning.main"
                          : "text.secondary"
                      }
                    >
                      AI {Math.round(selected.confidence * 100)}%
                    </Typography>
                  )}
                </Stack>
                <Typography variant="h5" sx={{ mt: 2 }}>
                  {selected.seatNo}
                </Typography>
                <Divider sx={{ my: 2 }} />
                {manager && editMode && (
                  <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditRounded />}
                      onClick={() => setEditor(selected)}
                    >
                      편집
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteOutlineRounded />}
                      disabled={Boolean(selected.employeeId)}
                      onClick={() => void removeSeat()}
                    >
                      삭제
                    </Button>
                  </Stack>
                )}
                {selected.employeeId ? (
                  <Stack spacing={1.4}>
                    <Stack direction="row" spacing={1.2} alignItems="center">
                      <Avatar sx={{ bgcolor: "primary.main" }}>
                        {selected.employeeName?.slice(0, 1) ?? "?"}
                      </Avatar>
                      <Box>
                        <Typography fontWeight={750}>
                          {selected.employeeName}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {selected.employeeNo}
                        </Typography>
                      </Box>
                    </Stack>
                    <Info
                      label="조직"
                      value={
                        selected.organizationName ||
                        selectedEmployee?.organizationName ||
                        "정보 없음"
                      }
                    />
                    <Info
                      label="근무지"
                      value={
                        selectedEmployee?.workplace || currentMap.buildingName
                      }
                    />
                  </Stack>
                ) : (
                  <Stack alignItems="center" spacing={1.2} sx={{ pt: 2 }}>
                    <PersonPinCircleRounded
                      sx={{ fontSize: 42, color: "text.disabled" }}
                    />
                    <Typography color="text.secondary">
                      배정된 직원이 없습니다.
                    </Typography>
                    {manager && (
                      <Typography variant="caption" textAlign="center">
                        왼쪽 검색 결과의 직원을
                        <br />이 좌석으로 끌어 놓으세요.
                      </Typography>
                    )}
                  </Stack>
                )}
              </>
            ) : (
              <Stack
                sx={{ height: "100%" }}
                alignItems="center"
                justifyContent="center"
                spacing={1}
              >
                <CenterFocusStrongRounded
                  sx={{ fontSize: 40, color: "text.disabled" }}
                />
                <Typography color="text.secondary" textAlign="center">
                  좌석을 선택하면
                  <br />
                  상세 정보가 표시됩니다.
                </Typography>
              </Stack>
            )}
          </Paper>
        </Box>
      )}
      <SeatEditor
        value={editor}
        onChange={setEditor}
        onClose={() => setEditor(null)}
        onSave={() => void saveSeat()}
      />
    </Box>
  );
}
function SeatEditor({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: Partial<Seat> | null;
  onChange: (value: Partial<Seat> | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const number = (key: keyof Seat, raw: string) =>
    value && onChange({ ...value, [key]: Number(raw) });
  return (
    <Dialog open={Boolean(value)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{value?.id ? "좌석 보정" : "좌석 추가"}</DialogTitle>
      <DialogContent>
        {value && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                fullWidth
                label="좌석 번호"
                value={value.seatNo ?? ""}
                onChange={(event) =>
                  onChange({ ...value, seatNo: event.target.value })
                }
              />
              <FormControl fullWidth>
                <Select
                  value={value.type ?? "fixed"}
                  onChange={(event) =>
                    onChange({ ...value, type: event.target.value })
                  }
                >
                  <MenuItem value="fixed">고정 좌석</MenuItem>
                  <MenuItem value="shared">공용 좌석</MenuItem>
                  <MenuItem value="unavailable">사용 불가</MenuItem>
                  <MenuItem value="meeting_room">회의실</MenuItem>
                  <MenuItem value="executive">임원실</MenuItem>
                  <MenuItem value="utility">기타 공간</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <Alert severity="info">
              좌표와 크기는 도면 대비 0~1 비율입니다. 도면을 더블 클릭하면 해당
              위치로 새 좌석이 만들어집니다.
            </Alert>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              {(["x", "y", "width", "height"] as const).map((key) => (
                <TextField
                  key={key}
                  label={key}
                  type="number"
                  value={value[key] ?? 0}
                  onChange={(event) => number(key, event.target.value)}
                  slotProps={{ htmlInput: { min: 0, max: 1, step: 0.005 } }}
                />
              ))}
            </Stack>
            <TextField
              label="회전 각도"
              type="number"
              value={value.rotation ?? 0}
              onChange={(event) => number("rotation", event.target.value)}
              slotProps={{ htmlInput: { min: -360, max: 360, step: 5 } }}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button
          variant="contained"
          disabled={!value?.seatNo || !value.width || !value.height}
          onClick={onSave}
        >
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={650}>
        {value}
      </Typography>
    </Box>
  );
}
