import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_QUERY_LIMIT,
  employeeQuery,
  readEmployeeParams,
  writeEmployeeParams,
} from "./employeeQuery";

const query = (next: Parameters<typeof employeeQuery>[0] = {}): string =>
  employeeQuery(next).toString();

describe("employeeQuery", () => {
  it("아무 조건도 없으면 limit 만 붙는다", () => {
    expect(query()).toBe("limit=500");
  });

  it("빈 문자열은 키를 아예 넣지 않는다", () => {
    expect(
      query({ q: "", status: "", assignment: "", organizationId: "" }),
    ).toBe("limit=500");
  });

  it("공백만 있는 값도 없는 것과 같다", () => {
    expect(query({ q: "   ", organizationId: "  " })).toBe("limit=500");
  });

  it("조직을 고르면 organizationId 키로 실린다", () => {
    expect(query({ organizationId: "org-1" })).toBe(
      "limit=500&organizationId=org-1",
    );
  });

  it("네 조건이 모두 있으면 모두 실린다", () => {
    const params = employeeQuery({
      q: "김개발",
      status: "active",
      assignment: "assigned",
      organizationId: "org-1",
    });
    expect(params.get("q")).toBe("김개발");
    expect(params.get("status")).toBe("active");
    expect(params.get("assignment")).toBe("assigned");
    expect(params.get("organizationId")).toBe("org-1");
    expect(params.get("limit")).toBe("500");
  });

  it("검색어의 공백은 떼고 싣는다", () => {
    expect(employeeQuery({ q: "  김개발  " }).get("q")).toBe("김개발");
  });

  it("limit 은 조건과 무관하게 언제나 500 이다", () => {
    expect(employeeQuery({}).get("limit")).toBe("500");
    expect(employeeQuery({ organizationId: "org-1" }).get("limit")).toBe("500");
    expect(EMPLOYEE_QUERY_LIMIT).toBe("500");
  });

  it("호출자가 준 값을 담은 새 객체를 돌려준다 — 부르는 쪽끼리 섞이지 않는다", () => {
    const first = employeeQuery({ organizationId: "org-1" });
    const second = employeeQuery({});
    expect(first.get("organizationId")).toBe("org-1");
    expect(second.get("organizationId")).toBeNull();
  });
});

describe("필터 정규화", () => {
  it("알 수 없는 enum은 API에 보내지 않는다", () => {
    expect(query({ status: "unknown", assignment: "all" })).toBe("limit=500");
  });
});

describe("직원 필터 URL", () => {
  it("빈 주소는 네 빈 문자열로 읽는다", () => {
    expect(readEmployeeParams(new URLSearchParams())).toEqual({
      q: "",
      organizationId: "",
      status: "",
      assignment: "",
    });
  });

  it.each(["active", "leave", "retired"])(
    "%s와 배정 조건이 URL/API를 왕복한다",
    (status) => {
      for (const assignment of ["assigned", "unassigned"]) {
        const filters = {
          q: "  김 & 개발 +  ",
          organizationId: " org-1 ",
          status,
          assignment,
        };
        const url = writeEmployeeParams(
          new URLSearchParams("other=keep&limit=1"),
          filters,
        );
        const read = readEmployeeParams(url);
        expect(read).toEqual({
          ...filters,
          q: "김 & 개발 +",
          organizationId: "org-1",
        });
        expect(employeeQuery(read)).toEqual(employeeQuery(filters));
        expect(employeeQuery(read).get("limit")).toBe("500");
        expect(employeeQuery(read).has("other")).toBe(false);
        expect(url.get("other")).toBe("keep");
      }
    },
  );

  it("읽기는 공백을 제거하고 모르는 enum을 전체로 처리한다", () => {
    const params = new URLSearchParams(
      "q=+++&organizationId=+org-1+&status=ACTIVE&assignment=all",
    );
    const before = params.toString();
    expect(readEmployeeParams(params)).toEqual({
      q: "",
      organizationId: "org-1",
      status: "",
      assignment: "",
    });
    expect(params.toString()).toBe(before);
  });

  it("쓰기의 빈 값과 알 수 없는 enum은 해당 키를 지운다", () => {
    const original = new URLSearchParams(
      "q=old&organizationId=org-1&status=active&assignment=assigned&other=a&other=b",
    );
    const before = original.toString();
    const next = writeEmployeeParams(original, {
      q: "  ",
      organizationId: "",
      status: "unknown",
      assignment: "all",
    });
    expect(next.toString()).toBe("other=a&other=b");
    expect(original.toString()).toBe(before);
  });

  it("undefined는 기존 조건을 보존하고 새 URLSearchParams를 반환한다", () => {
    const original = new URLSearchParams(
      "q=old&organizationId=org-1&status=active&assignment=assigned&other=keep",
    );
    const next = writeEmployeeParams(original, {
      q: " new ",
      status: undefined,
    });
    expect(readEmployeeParams(next)).toEqual({
      q: "new",
      organizationId: "org-1",
      status: "active",
      assignment: "assigned",
    });
    expect(next.get("other")).toBe("keep");
    expect(original.get("q")).toBe("old");
    expect(writeEmployeeParams(original, {})).not.toBe(original);
  });

  it("enum도 공백을 제거한 뒤 검사한다", () => {
    const filters = { status: " active ", assignment: " assigned " };
    expect(
      readEmployeeParams(writeEmployeeParams(new URLSearchParams(), filters)),
    ).toEqual({
      q: "",
      organizationId: "",
      status: "active",
      assignment: "assigned",
    });
    expect(employeeQuery(filters).toString()).toBe(
      "limit=500&status=active&assignment=assigned",
    );
  });
});
