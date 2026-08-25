import { describe, expect, it } from "vitest";
import type { Seat } from "../types";
import {
  deriveGrid,
  matchesFilter,
  needsReviewSeat,
  seatColor,
  seatHighlighted,
  seatOrgId,
  seatUnavailable,
  zoneMismatched,
  type SeatFilter,
} from "./seats";

const seat = (over: Partial<Seat> = {}): Seat => ({
  id: over.id ?? "s1",
  floorMapId: "m1",
  seatNo: "A-01",
  type: "fixed",
  status: "available",
  x: 0.1,
  y: 0.1,
  width: 0.04,
  height: 0.05,
  rotation: 0,
  ...over,
});
const set = (...f: SeatFilter[]) => new Set<SeatFilter>(f);

describe("seatUnavailable", () => {
  it("type과 status 어느 쪽으로 지정해도 사용 불가로 본다", () => {
    expect(seatUnavailable(seat({ type: "unavailable" }))).toBe(true);
    expect(seatUnavailable(seat({ status: "unavailable" }))).toBe(true);
    expect(seatUnavailable(seat())).toBe(false);
  });
});

describe("seatColor", () => {
  it("사용 불가는 회색이 우선한다", () => {
    expect(seatColor(seat({ status: "unavailable", employeeId: "e1" }))).toBe(
      "#8796A1",
    );
  });
  it("배정·공용·빈 좌석을 구분한다", () => {
    expect(seatColor(seat({ employeeId: "e1" }))).toBe("#087E8B");
    expect(seatColor(seat({ type: "shared" }))).toBe("#3478C8");
    expect(seatColor(seat())).toBe("#FFFFFF");
  });
});

describe("matchesFilter", () => {
  it("필터가 없으면 전부 통과시킨다", () => {
    expect(matchesFilter(seat(), set())).toBe(true);
  });
  it("빈 좌석 필터는 색상 판정과 같은 기준을 쓴다", () => {
    // 회귀 방지: status로만 사용 불가인 좌석이 빈 좌석으로 강조되면 안 된다.
    const grey = seat({ status: "unavailable" });
    expect(seatColor(grey)).toBe("#8796A1");
    expect(matchesFilter(grey, set("available"))).toBe(false);
    expect(matchesFilter(seat({ type: "unavailable" }), set("available"))).toBe(
      false,
    );
    expect(matchesFilter(seat(), set("available"))).toBe(true);
  });
  it("배정 필터는 착석자가 있는 좌석만 고른다", () => {
    expect(matchesFilter(seat({ employeeId: "e1" }), set("assigned"))).toBe(
      true,
    );
    expect(matchesFilter(seat(), set("assigned"))).toBe(false);
  });
  it("검토 필요는 자동 승인선 아래만 고른다", () => {
    expect(matchesFilter(seat({ confidence: 0.9 }), set("review"))).toBe(true);
    expect(matchesFilter(seat({ confidence: 0.96 }), set("review"))).toBe(
      false,
    );
    expect(needsReviewSeat(seat())).toBe(false);
  });
  it("여러 필터는 합집합으로 동작한다", () => {
    const filters = set("assigned", "review");
    expect(matchesFilter(seat({ confidence: 0.8 }), filters)).toBe(true);
    expect(matchesFilter(seat({ employeeId: "e1" }), filters)).toBe(true);
    expect(matchesFilter(seat(), filters)).toBe(false);
  });
});

describe("zoneMismatched / seatOrgId", () => {
  it("지정 구역과 착석자 소속이 다를 때만 불일치다", () => {
    expect(
      zoneMismatched(
        seat({ organizationId: "A", employeeOrganizationId: "B" }),
      ),
    ).toBe(true);
    expect(
      zoneMismatched(
        seat({ organizationId: "A", employeeOrganizationId: "A" }),
      ),
    ).toBe(false);
    // 한쪽이 비면 비교할 수 없으므로 불일치로 보지 않는다.
    expect(zoneMismatched(seat({ organizationId: "A" }))).toBe(false);
    expect(zoneMismatched(seat({ employeeOrganizationId: "B" }))).toBe(false);
  });
  it("대표 조직은 착석자 소속이 우선이다", () => {
    expect(
      seatOrgId(seat({ organizationId: "A", employeeOrganizationId: "B" })),
    ).toBe("B");
    expect(seatOrgId(seat({ organizationId: "A" }))).toBe("A");
    expect(seatOrgId(seat())).toBeNull();
  });
});

describe("seatHighlighted", () => {
  it("필터와 조직 강조를 모두 만족해야 한다", () => {
    const s = seat({ employeeId: "e1", employeeOrganizationId: "DEV" });
    expect(seatHighlighted(s, set("assigned"), "DEV")).toBe(true);
    expect(seatHighlighted(s, set("assigned"), "SALES")).toBe(false);
    expect(seatHighlighted(s, set("available"), "DEV")).toBe(false);
    expect(seatHighlighted(s, set(), null)).toBe(true);
  });
});

describe("deriveGrid", () => {
  it("좌석이 하나면 간격을 알 수 없어 실패한다", () => {
    expect(deriveGrid([seat()])).toBeNull();
  });
  it("가로·세로로 떨어진 좌석에서 간격을 읽는다", () => {
    const grid = deriveGrid([
      seat({ id: "a", x: 0.1, y: 0.2 }),
      seat({ id: "b", x: 0.25, y: 0.2 }),
      seat({ id: "c", x: 0.1, y: 0.32 }),
    ]);
    expect(grid).not.toBeNull();
    expect(grid!.pitchX).toBeCloseTo(0.15, 6);
    expect(grid!.pitchY).toBeCloseTo(0.12, 6);
  });
  it("가장 좁은 간격을 주기로 삼는다", () => {
    const grid = deriveGrid([
      seat({ id: "a", x: 0.1, y: 0.1 }),
      seat({ id: "b", x: 0.2, y: 0.1 }),
      seat({ id: "c", x: 0.5, y: 0.1 }),
      seat({ id: "d", x: 0.1, y: 0.3 }),
    ]);
    expect(grid!.pitchX).toBeCloseTo(0.1, 6);
  });
  it("원점은 주기 안으로 접힌다", () => {
    const grid = deriveGrid([
      seat({ id: "a", x: 0.35, y: 0.5 }),
      seat({ id: "b", x: 0.45, y: 0.5 }),
      seat({ id: "c", x: 0.35, y: 0.7 }),
    ]);
    // 0.35 를 주기 0.1 로 접으면 0.05 근처가 된다.
    expect(grid!.originX).toBeGreaterThanOrEqual(0);
    expect(grid!.originX).toBeLessThan(grid!.pitchX);
    expect(grid!.originY).toBeLessThan(grid!.pitchY);
  });
  it("한 축으로만 늘어선 좌석은 좌석 크기를 주기로 되돌린다", () => {
    const grid = deriveGrid([
      seat({ id: "a", x: 0.1, y: 0.2, width: 0.05, height: 0.06 }),
      seat({ id: "b", x: 0.3, y: 0.2, width: 0.05, height: 0.06 }),
    ]);
    expect(grid!.pitchX).toBeCloseTo(0.2, 6);
    expect(grid!.pitchY).toBeCloseTo(0.06, 6);
  });
  it("간격이 최소 주기보다 좁으면 격자를 만들지 않는다", () => {
    expect(
      deriveGrid([
        seat({ id: "a", x: 0.1, y: 0.1, width: 0.001, height: 0.001 }),
        seat({ id: "b", x: 0.1005, y: 0.1, width: 0.001, height: 0.001 }),
      ]),
    ).toBeNull();
  });
});
