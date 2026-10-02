import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * 직원 목록 조회의 수명 — 실패가 남긴 배너와, 늦게 도착한 이전 응답.
 *
 * `EmployeesPage.load` 는 조회를 시작할 때 낡은 오류를 지우지 않고 응답에 순번도
 * 매기지 않는다. 같은 저장소의 `HistoryPage.load` 는 둘 다 한다(`setError("")` 와
 * `requestRef`). 그래서 직원 화면에서는 ① 한 번 실패한 뒤 다음 조회가 성공해도
 * 오류 배너가 그대로 남고 ② 먼저 보낸 조회가 늦게 도착하면 이미 화면에 올라온
 * 최신 조건의 결과를 덮어쓴다.
 *
 * 둘 다 실제 서버·실제 화면으로 본다. 네트워크만 Playwright 로 막거나 붙잡아 두고
 * (login.spec.ts·employee-filter.spec.ts 와 같은 방식) 서버 상태는 바꾸지 않으므로
 * 되돌릴 것이 없다. 시드는 조직 3개와 직원 10명(개발 6·영업 2·인사 2)을 만든다.
 */

/** 직원 목록 조회. `employeeQuery` 가 limit 을 항상 붙이므로 쿼리가 비지 않는다. */
const LIST = "**/api/v1/employees?*";
const isList = (url: string) => new URL(url).pathname === "/api/v1/employees";
const filtersOrg = (url: string) =>
  isList(url) && Boolean(new URL(url).searchParams.get("organizationId"));
const rows = (page: Page) => page.locator("table tbody tr");
const submit = (page: Page) =>
  page.getByRole("button", { name: "검색", exact: true }).click();
const chooseOrganization = async (page: Page, name: string) => {
  await page.getByRole("combobox", { name: "조직 필터" }).click();
  await page.getByRole("option", { name, exact: true }).click();
};

test.describe("직원 목록 재조회", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("조회가 실패한 뒤 다시 성공하면 오류 배너가 사라진다", async ({
    page,
  }) => {
    await page.goto("/admin/employees");
    await expect(rows(page)).toHaveCount(10);

    // 문구는 서버 계약(error.message)대로 내려 브라우저별 fetch 오류 문구에
    // 기대지 않는다.
    await page.route(LIST, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "unavailable", message: "조회 중단(검증용)" },
        }),
      }),
    );
    await submit(page);
    const banner = page.getByText("조회 중단(검증용)");
    await expect(banner).toBeVisible();

    await page.unroute(LIST);
    const response = page.waitForResponse((res) => isList(res.url()));
    await submit(page);
    expect((await response).ok()).toBe(true);
    await expect(rows(page)).toHaveCount(10);
    // 성공한 조회가 낡은 실패를 지워야 한다.
    await expect(banner).toBeHidden();
  });

  test("늦게 도착한 이전 조회가 최신 목록을 덮어쓰지 않는다", async ({
    page,
  }) => {
    await page.goto("/admin/employees");
    await expect(rows(page)).toHaveCount(10);

    // 조직을 지정한 조회만 붙잡아 둔다. 뒤이은 '전체 조직' 조회는 그대로 통과해
    // 먼저 도착한다.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(LIST, async (route) => {
      if (filtersOrg(route.request().url())) await gate;
      await route.continue();
    });

    const held = page.waitForRequest((req) => filtersOrg(req.url()));
    await chooseOrganization(page, "영업팀");
    // 두 조회의 순서를 고정한다. 영업팀 조회가 먼저 나간 뒤에 조건을 되돌린다.
    await held;
    await chooseOrganization(page, "전체 조직");
    await expect(rows(page)).toHaveCount(10);

    const stale = page.waitForResponse((res) => filtersOrg(res.url()));
    release();
    expect((await stale).ok()).toBe(true);
    // 낡은 응답이 도착해 화면에 반영될 틈을 준 뒤에도 최신 조건의 결과여야 한다.
    await page.waitForTimeout(500);
    await expect(rows(page)).toHaveCount(10);
    expect(new URL(page.url()).searchParams.get("organizationId")).toBeNull();
  });
});
