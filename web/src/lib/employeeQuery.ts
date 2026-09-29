/**
 * 직원 목록 조회 쿼리를 짓는 규칙.
 *
 * 화면의 필터(검색어·재직상태·배정상태·조직)는 여러 자리에서 조회를 부른다 —
 * 첫 로드, 검색 제출, Select 세 개, 가져오기 뒤 새로고침. 그 자리마다
 * `new URLSearchParams` 을 손으로 조립하면 한쪽만 키 이름을 틀리거나 빈 값을
 * `?status=` 로 흘려 서버가 다르게 읽는다 — 이 저장소에서 반복된 어긋남이다.
 * 그래서 키 이름과 빈 값 규칙을 여기 한 곳에 두고 부르는 쪽이 모두 이것을 쓴다.
 * `seatMapLink.ts`·`silentSso.ts`·`employeeExport.ts` 가 같은 꼴의 짝이다.
 *
 * 키 이름은 마음대로 짓지 않는다. 서버 `listEmployees`
 * (`internal/app/employees.go:59-63`)가 읽는 `q`·`organizationId`·`status`·
 * `assignment` 를 그대로 쓴다.
 */

/**
 * 한 번에 받아 오는 최대 인원.
 *
 * 서버는 `limit` 을 500 까지만 받고(`employees.go:65-67`) 전체 건수는 돌려주지
 * 않는다. 그래서 화면은 언제나 상한으로 받고 "최대 500명 표시" 를 안내한다 —
 * 조건에 상관없이 같은 값이어야 표에 보이는 것과 CSV 가 어긋나지 않는다.
 */
export const EMPLOYEE_QUERY_LIMIT = "500";

export interface EmployeeFilters {
  /** 이름·사번·이메일·조직명을 함께 훑는 자유 검색어. */
  q?: string;
  /** 재직상태 코드(active|leave|retired). 빈 값은 전체. */
  status?: string;
  /** 배정상태(assigned|unassigned). 빈 값은 전체. */
  assignment?: string;
  /** 조직 id. 빈 값은 전체 조직. 조직명이 아니라 id 다. */
  organizationId?: string;
}

const filterKeys = ["q", "organizationId", "status", "assignment"] as const;

function normalize(filters: EmployeeFilters): Required<EmployeeFilters> {
  const status = filters.status?.trim() ?? "";
  const assignment = filters.assignment?.trim() ?? "";
  return {
    q: filters.q?.trim() ?? "",
    organizationId: filters.organizationId?.trim() ?? "",
    status: ["active", "leave", "retired"].includes(status) ? status : "",
    assignment: ["assigned", "unassigned"].includes(assignment)
      ? assignment
      : "",
  };
}

/** 주소의 네 필터를 읽는다. 모르는 enum은 전체로 취급한다. */
export function readEmployeeParams(
  params: URLSearchParams,
): Required<EmployeeFilters> {
  return normalize(
    Object.fromEntries(filterKeys.map((key) => [key, params.get(key) ?? ""])),
  );
}

/** 원본과 모르는 키를 보존한다. undefined는 유지, 빈 값은 해당 키 삭제. */
export function writeEmployeeParams(
  params: URLSearchParams,
  filters: EmployeeFilters,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const normalized = normalize(filters);
  for (const key of filterKeys) {
    if (filters[key] === undefined) continue;
    if (normalized[key]) next.set(key, normalized[key]);
    else next.delete(key);
  }
  return next;
}

/** API는 같은 정규화 규칙을 쓰되 주소의 limit이나 모르는 키를 받지 않는다. */
export function employeeQuery(filters: EmployeeFilters): URLSearchParams {
  return writeEmployeeParams(
    new URLSearchParams({ limit: EMPLOYEE_QUERY_LIMIT }),
    filters,
  );
}
