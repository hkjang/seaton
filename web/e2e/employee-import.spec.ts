import { expect, test, type Page } from "@playwright/test";
import { csrfToken, login } from "./helpers";

/**
 * 직원 가져오기 — 양식 그대로의 파일이 실제로 반영되는지.
 *
 * 두 가지를 본다.
 *
 * ① 머리글. 이 서비스가 내려주는 직원 양식(`EmployeesPage.downloadTemplate`)과
 *    Excel이 저장하는 UTF-8 CSV는 BOM으로 시작한다. `readSpreadsheet`가 BOM을
 *    떼지 않으면 첫 칸이 "BOM+사번"이 되어 머리글로 열을 찾는
 *    `importEmployees`가 사번 열을 못 찾고 모든 행을 "사번/이름 누락"으로
 *    되돌린다. 좌석 일괄 배정은 열 위치로 읽어 같은 파일이 멀쩡히 돌기 때문에
 *    같은 파일을 두 가져오기가 다르게 읽는다.
 *
 * ② 조직코드. 직원 양식과 USER_GUIDE 3.4 절은 조직을 바꿀 때 `조직코드`
 *    (organizations.external_id)가 있는 파일을 쓰라고 안내하는데,
 *    `saveEmployee`는 `조직명`이 함께 있을 때만 조직을 찾아 코드만 적은 행이
 *    소속 없이 저장된다 — 가져오기는 "반영"이라 보고하면서 소속을 지운다.
 *
 * 실제 서버·실제 화면으로 본다. 시드 직원 한 명의 정보를 실제로 바꾸므로
 * `keepingEmployee`가 원래 값을 그대로 돌려놓는다 — 되돌리지 않으면 "인사팀 2명"을
 * 전제로 하는 다른 검증이 엉뚱한 이유로 깨진다.
 */

/** 시드가 만드는 직원. 앞줄 5석(개발팀 구역) 밖이라 구역 불일치 검증과 겹치지 않는다. */
const TARGET = "E007";

type EmployeeRecord = {
  employeeNo: string;
  name: string;
  email?: string;
  organizationId?: string;
  organizationName?: string;
  title?: string;
  position?: string;
  workplace?: string;
  status: string;
};

/** 검증용 CSV를 임시 파일 없이 올린다(bulk-assign.spec.ts와 같은 방식). */
const csv = (rows: string[]) => ({
  name: "employees.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("﻿" + rows.join("\n") + "\n", "utf8"),
});

/** 머리글에 있는 파일 입력 중 둘째가 '직원 가져오기'다(첫째는 좌석 일괄 배정). */
const EMPLOYEE_INPUT = "input[type=file] >> nth=1";

const fetchEmployee = async (page: Page, employeeNo: string) => {
  const found = await (
    await page.request.get(`/api/v1/employees?q=${employeeNo}`)
  ).json();
  const item = (found.items as EmployeeRecord[]).find(
    (employee) => employee.employeeNo === employeeNo,
  );
  if (!item) throw new Error(`${employeeNo} 직원이 없습니다`);
  return item;
};

/**
 * 직원 한 명의 정보를 건드리는 검증을 감싼다. 끝나면 가져오기가 쓰는 것과 같은
 * 경로(POST /employees)로 모든 열을 원래 값으로 되돌린다 — 일부만 되돌리면
 * 되돌리기가 그 자체로 다른 열을 지운다.
 */
const keepingEmployee = async (
  page: Page,
  employeeNo: string,
  body: (before: EmployeeRecord) => Promise<void>,
) => {
  const before = await fetchEmployee(page, employeeNo);
  try {
    await body(before);
  } finally {
    await page.request.post("/api/v1/employees", {
      headers: { "X-CSRF-Token": await csrfToken(page) },
      data: {
        employeeNo: before.employeeNo,
        name: before.name,
        email: before.email ?? "",
        organizationId: before.organizationId ?? null,
        title: before.title ?? "",
        position: before.position ?? "",
        workplace: before.workplace ?? "",
        status: before.status,
      },
    });
  }
};

/** 표에서 한 직원의 행을 집어 '조직' 칸을 읽는다(열 순서: 직원·사번·조직·…). */
const organizationCell = async (page: Page, employeeNo: string) => {
  await page.fill(
    'input[placeholder="이름, 사번, 이메일, 조직 검색"]',
    employeeNo,
  );
  await page.getByRole("button", { name: "검색", exact: true }).click();
  const row = page.locator("table tbody tr", { hasText: employeeNo });
  await expect(row).toHaveCount(1);
  return row.locator("td").nth(2);
};

test.describe("직원 가져오기", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("BOM으로 시작하는 양식 파일의 사번·이름 열을 읽는다", async ({
    page,
  }) => {
    await keepingEmployee(page, TARGET, async (before) => {
      await page.goto("/admin/employees");
      await page.setInputFiles(
        EMPLOYEE_INPUT,
        // 양식(downloadTemplate)과 같은 열 이름을 쓴다. 조직 열은 넣지 않는다 —
        // 여기서 보는 것은 머리글이 읽히는지 하나다.
        csv(["사번,이름,근무지", `${TARGET},${before.name},본사 7층`]),
      );
      await expect(page.getByText(/1명 반영, 0건 확인 필요/)).toBeVisible();

      const after = await fetchEmployee(page, TARGET);
      expect(after.workplace, "근무지 열이 반영되어야 한다").toBe("본사 7층");
    });
  });

  test("조직명 없이 조직코드만 적은 행도 그 조직으로 옮긴다", async ({
    page,
  }) => {
    await keepingEmployee(page, TARGET, async (before) => {
      expect(before.organizationName, "시드 소속").toBe("인사팀");

      await page.goto("/admin/employees");
      await page.setInputFiles(
        EMPLOYEE_INPUT,
        csv(["사번,이름,조직코드", `${TARGET},${before.name},SALES`]),
      );
      await expect(page.getByText(/1명 반영, 0건 확인 필요/)).toBeVisible();

      // 화면과 서버가 같은 값을 보여야 한다.
      await expect(await organizationCell(page, TARGET)).toHaveText("영업팀");
      const after = await fetchEmployee(page, TARGET);
      expect(after.organizationName).toBe("영업팀");
      expect(after.organizationId).toBeTruthy();
    });
  });

  test("없는 조직코드는 사유와 함께 남고 소속을 지우지 않는다", async ({
    page,
  }) => {
    await keepingEmployee(page, TARGET, async (before) => {
      await page.goto("/admin/employees");
      await page.setInputFiles(
        EMPLOYEE_INPUT,
        csv(["사번,이름,조직코드", `${TARGET},${before.name},NOSUCHCODE`]),
      );
      await expect(page.getByText(/0명 반영, 1건 확인 필요/)).toBeVisible();
      // 왜 걸렸는지 보여 주지 않으면 관리자가 파일을 고칠 수 없다.
      await expect(page.getByText(/반영되지 않은 1행/)).toBeVisible();
      await expect(page.getByText(/NOSUCHCODE/)).toBeVisible();

      // 반영되지 않은 행은 기존 소속을 그대로 두어야 한다.
      await expect(await organizationCell(page, TARGET)).toHaveText("인사팀");
      const after = await fetchEmployee(page, TARGET);
      expect(after.organizationName).toBe("인사팀");
    });
  });
});
