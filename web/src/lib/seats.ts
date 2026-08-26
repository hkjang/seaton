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

/**
 * 같은 도면 좌석들이 공통으로 가진 앞부분. "HQ-3F-001", "HQ-3F-002"라면 "HQ-3F-"다.
 * 도면 위에서는 건물과 층이 이미 화면 맥락으로 정해져 있으므로, 이 접두사를 떼야
 * 좁은 좌석 안에 구분되는 뒷자리가 남는다.
 */
export const commonSeatPrefix = (seatNos: string[]): string => {
  const values = seatNos.filter(Boolean);
  if (values.length < 2) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  // 토큰 중간에서 자르면 "HQ-3F-0"처럼 뜻 없는 조각이 남는다. 구분자까지 물러난다.
  const cut = Math.max(
    prefix.lastIndexOf("-"),
    prefix.lastIndexOf("_"),
    prefix.lastIndexOf("."),
    prefix.lastIndexOf(" "),
    prefix.lastIndexOf("/"),
  );
  if (cut < 0) return "";
  prefix = prefix.slice(0, cut + 1);
  // 접두사를 떼서 빈 이름이 되는 좌석이 하나라도 있으면 떼지 않는다.
  return values.every((value) => value.length > prefix.length) ? prefix : "";
};

/** 접두사를 뗀 좌석 번호. 뗄 수 없으면 원래 번호를 그대로 쓴다. */
export const shortSeatNo = (seatNo: string, prefix: string): string =>
  prefix && seatNo.startsWith(prefix) && seatNo.length > prefix.length
    ? seatNo.slice(prefix.length)
    : seatNo;

/**
 * 확대 배율을 2의 거듭제곱 단계로 뭉친다. 글자 크기를 배율에 그대로 반비례시키면
 * 휠을 굴릴 때마다 좌석 500개를 다시 그려야 하므로, 단계가 바뀔 때만 다시 그린다.
 */
export const zoomTier = (zoom: number): number => {
  if (!Number.isFinite(zoom) || zoom <= 1) return 1;
  return Math.min(8, 2 ** Math.round(Math.log2(zoom)));
};

export type SeatLabelLayout = { show: boolean; fontSize: number; text: string };

/**
 * 좌석 안에 들어갈 라벨의 크기와 잘림.
 *
 * 글자 크기를 확대 단계로 나눠 두면 확대해도 화면상 크기가 거의 유지되어, 좌석
 * 하나를 가득 채운 거대한 글자가 생기지 않는다. 다만 완전히 고정하면 크게 확대한
 * 좌석 안에서 라벨이 파묻히므로, 단계보다 느리게 키워 조금씩 커지게 한다.
 */
export const seatLabelLayout = (
  label: string,
  width: number,
  height: number,
  tier: number,
): SeatLabelLayout => {
  const steps = Math.max(1, tier);
  const fontSize =
    Math.min(13, Math.max(7.5, height * 0.34, width * 0.16)) / steps ** 0.75;
  const maxChars = Math.floor(width / (fontSize * 0.62));
  const show = width * steps >= 20 && height * steps >= 11 && maxChars >= 2;
  const text =
    label.length > maxChars
      ? `${label.slice(0, Math.max(1, maxChars - 1))}…`
      : label;
  return { show, fontSize, text };
};
