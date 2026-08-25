/**
 * 좌석 판정과 격자 추론.
 *
 * 좌석맵 화면에서 쓰는 순수 규칙을 모아 둔다. 화면 없이 검증할 수 있어야
 * "타입은 통과하는데 동작은 틀린" 상태를 막을 수 있다.
 */
import type { Seat, SeatGrid } from "../types";

/** 좌석 색상 기준. 조직 모드는 어느 팀이 어디에 앉는지 한눈에 보여준다. */
export type ColorMode = "status" | "organization";
/** 화면에서 강조할 좌석 갈래. 비어 있으면 전체를 동일하게 보여준다. */
export type SeatFilter = "assigned" | "available" | "review" | "mismatch";

export const SEAT_FILTERS: { key: SeatFilter; label: string }[] = [
  { key: "assigned", label: "배정" },
  { key: "available", label: "빈 좌석" },
  { key: "review", label: "검토 필요" },
  { key: "mismatch", label: "구역 불일치" },
];

/** 사용할 수 없는 좌석. type과 status 어느 쪽으로도 지정될 수 있다. */
export const seatUnavailable = (seat: Seat) =>
  seat.type === "unavailable" || seat.status === "unavailable";

export const seatColor = (seat: Seat) =>
  seatUnavailable(seat)
    ? "#8796A1"
    : seat.employeeId
      ? "#087E8B"
      : seat.type === "shared"
        ? "#3478C8"
        : "#FFFFFF";

/** 자동 승인선 아래라 사람이 확인해야 하는 좌석. */
export const needsReviewSeat = (seat: Seat) =>
  Boolean(seat.confidence && seat.confidence < 0.95);

/** 좌석에 지정된 구역과 실제로 앉은 직원의 소속이 다른 경우다. */
export const zoneMismatched = (seat: Seat) =>
  Boolean(
    seat.organizationId &&
    seat.employeeOrganizationId &&
    seat.organizationId !== seat.employeeOrganizationId,
  );

/** 좌석을 대표하는 조직: 앉은 직원의 소속이 우선이고, 없으면 좌석에 지정된 구역. */
export const seatOrgId = (seat: Seat) =>
  seat.employeeOrganizationId ?? seat.organizationId ?? null;

/**
 * 강조 대상인지 판정한다. 빈 좌석 판정은 seatUnavailable 과 같은 기준을 써야
 * 회색으로 그려진 좌석이 "빈 좌석"으로 강조되는 어긋남이 생기지 않는다.
 */
export const matchesFilter = (seat: Seat, filters: Set<SeatFilter>) => {
  if (!filters.size) return true;
  if (filters.has("assigned") && seat.employeeId) return true;
  if (filters.has("available") && !seat.employeeId && !seatUnavailable(seat))
    return true;
  if (filters.has("review") && needsReviewSeat(seat)) return true;
  if (filters.has("mismatch") && zoneMismatched(seat)) return true;
  return false;
};

/** 좌석이 강조되어야 하는지. 필터와 조직 강조를 함께 본다. */
export const seatHighlighted = (
  seat: Seat,
  filters: Set<SeatFilter>,
  activeOrg: string | null,
) =>
  matchesFilter(seat, filters) &&
  (activeOrg === null || seatOrgId(seat) === activeOrg);

export const MIN_GRID_PITCH = 0.004;

/**
 * 선택된 좌석들의 좌표에서 반복 간격을 읽어 격자 보정값을 만든다.
 * 관리자가 대표 좌석 몇 개만 골라주면 도면 전체 격자가 정해진다.
 */
export const deriveGrid = (selection: Seat[]): SeatGrid | null => {
  if (selection.length < 2) return null;
  // 같은 값끼리 뭉친 뒤 이웃 간 최소 간격을 주기로 본다.
  const spacing = (values: number[], fallbackSize: number) => {
    const unique = [...new Set(values.map((v) => Math.round(v * 10000)))]
      .map((v) => v / 10000)
      .sort((a, b) => a - b);
    const gaps = unique
      .slice(1)
      .map((v, i) => v - unique[i])
      .filter((gap) => gap >= MIN_GRID_PITCH);
    if (!gaps.length) return fallbackSize >= MIN_GRID_PITCH ? fallbackSize : 0;
    return Math.min(...gaps);
  };
  const widths = selection.map((s) => s.width);
  const heights = selection.map((s) => s.height);
  const pitchX = spacing(
    selection.map((s) => s.x),
    Math.max(...widths),
  );
  const pitchY = spacing(
    selection.map((s) => s.y),
    Math.max(...heights),
  );
  if (pitchX < MIN_GRID_PITCH || pitchY < MIN_GRID_PITCH) return null;
  const originX = Math.min(...selection.map((s) => s.x));
  const originY = Math.min(...selection.map((s) => s.y));
  return {
    originX: originX % pitchX,
    originY: originY % pitchY,
    pitchX: Math.min(0.5, pitchX),
    pitchY: Math.min(0.5, pitchY),
  };
};
