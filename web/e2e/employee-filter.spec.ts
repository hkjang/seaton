import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { login } from "./helpers";

/**
 * 직원 화면의 조직 필터.
 *
 * 서버 `listEmployees` 는 `organizationId` 를 이미 걸러 주지만(employees.go:62,69)
 * 화면에 그것을 고를 자리가 없었다. 여기서 보는 것은 화면의 Select 가 정말 그
 * 쿼리를 실어 보내는지(표가 그 조직만 남는지)와, 걸러진 목록이 그대로 CSV 로
 * 내려오는지다. 쿼리 조립 규칙 자체는 vitest(`src/lib/employeeQuery.test.ts`)가
 * 증명한다.
 *
 * 이 검증은 서버 상태를 바꾸지 않는다 — 화면의 필터만 만지므로 되돌릴 것이 없다.
 * 시드는 조직 3개와 직원 10명(개발팀 6·영업팀 2·인사팀 2)을 만든다(seed.mjs).
 */

/** 표의 '조직' 칸. 머리글 순서는 직원·사번·조직·직책/직급·좌석·상태·작업. */
const ORG_COLUMN = 2;

const chooseOrganization = async (
  page: import("@playwright/test").Page,
  name: string,
) => {
  await page.getByRole("combobox", { name: "조직 필터" }).click();
  await page.getByRole("option", { name, exact: true }).click();
};

test.describe("직원 조직 필터", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("조직을 고르면 그 조직의 직원만 표에 남는다", async ({ page }) => {
    await page.goto("/admin/employees");
    const rows = page.locator("table tbody tr");
    // 거르기 전에는 시드 직원 10명이 모두 보인다.
    await expect(rows).toHaveCount(10);

    await chooseOrganization(page, "영업팀");

    await expect(rows).toHaveCount(2);
    const orgs = await rows
      .locator(`td:nth-child(${ORG_COLUMN + 1})`)
      .allTextContents();
    expect(orgs).toEqual(["영업팀", "영업팀"]);
  });

  test("조직 필터는 검색어를 지우지 않는다", async ({ page }) => {
    await page.goto("/admin/employees");
    const search = page.getByPlaceholder("이름, 사번, 이메일, 조직 검색");
    // 개발팀에만 있는 이름. 영업팀으로 거르면 두 조건이 겹쳐 아무도 남지 않는다.
    await search.fill("김개발");
    // exact 가 없으면 AppShell 의 "직원 빠른 검색" 단추까지 잡혀 strict 위반이 된다.
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(1);

    await chooseOrganization(page, "영업팀");

    await expect(search).toHaveValue("김개발");
    await expect(page.getByText("조건에 맞는 직원이 없습니다.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "CSV 내보내기" }),
    ).toBeDisabled();
  });

  test("걸러진 목록만 CSV 로 내려온다", async ({ page }) => {
    await page.goto("/admin/employees");
    await chooseOrganization(page, "영업팀");
    await expect(page.locator("table tbody tr")).toHaveCount(2);

    const button = page.getByRole("button", { name: "CSV 내보내기" });
    await expect(button).toBeEnabled();
    // 내려받기는 클릭과 거의 동시에 일어나므로 기다림을 클릭 전에 걸어야 한다.
    const wait = page.waitForEvent("download");
    await button.click();
    const download = await wait;

    const text = readFileSync((await download.path())!, "utf8");
    const lines = text.split("\r\n");
    // 머리글 한 줄 + 영업팀 2명. 거르기 전 10명이 담기면 안 된다.
    expect(lines.length - 1).toBe(2);
    expect(text).not.toContain("개발팀");
    expect(text).toContain("영업팀");
  });
});

// 주소/컨트롤/API/표를 함께 검증한다. 응답은 실제 서버와 DB에서 받는다.
test.describe("직원 필터 URL", () => {
  test.beforeEach(async ({ page }) => login(page));

  const organizations = async (page: import("@playwright/test").Page) => {
    const response = await page.request.get("/api/v1/organizations");
    expect(response.ok()).toBe(true);
    return (await response.json()).items as Array<{ id: string; name: string }>;
  };
  const isList = (url: string) => new URL(url).pathname === "/api/v1/employees";
  const choose = async (
    page: import("@playwright/test").Page,
    label: string,
    name: string,
  ) => {
    await page.getByRole("combobox", { name: label }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };

  test("직접 진입과 새로고침이 네 필터·실제 조회·CSV를 복원한다", async ({
    page,
  }) => {
    const orgs = await organizations(page);
    const sales = orgs.find((org) => org.name === "영업팀")!.id;
    const params = new URLSearchParams({
      q: " 영업팀 ",
      organizationId: sales,
      status: "active",
      assignment: "assigned",
      other: "keep",
      limit: "1",
    });
    const requests: URL[] = [];
    page.on("request", (request) => {
      if (isList(request.url())) requests.push(new URL(request.url()));
    });
    await page.goto(`/admin/employees?${params}`);
    for (let visit = 0; visit < 2; visit++) {
      if (visit) await page.reload();
      await expect(
        page.getByPlaceholder("이름, 사번, 이메일, 조직 검색"),
      ).toHaveValue("영업팀");
      await expect(
        page.getByRole("combobox", { name: "조직 필터" }),
      ).toHaveText("영업팀");
      await expect(
        page.getByRole("combobox", { name: "재직상태 필터" }),
      ).toHaveText("재직");
      await expect(
        page.getByRole("combobox", { name: "배정상태 필터" }),
      ).toHaveText("배정");
      await expect(page.locator("table tbody tr")).toHaveCount(2);
      expect(
        await page.locator("table tbody tr td:nth-child(3)").allTextContents(),
      ).toEqual(["영업팀", "영업팀"]);
      expect(requests).toHaveLength(visit + 1);
      expect(Object.fromEntries(requests.at(-1)!.searchParams)).toEqual({
        limit: "500",
        q: "영업팀",
        organizationId: sales,
        status: "active",
        assignment: "assigned",
      });
    }
    const wait = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV 내보내기" }).click();
    const csv = readFileSync((await (await wait).path())!, "utf8");
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("영업팀");
    expect(csv).not.toContain("개발팀");
  });

  test("제출·Select는 replace로 조건을 보존하고 빈 값은 지우며 같은 검색도 다시 조회한다", async ({
    page,
  }) => {
    const dev = (await organizations(page)).find(
      (org) => org.name === "개발팀",
    )!.id;
    await page.goto("/admin/employees?other=keep");
    await expect(page.locator("table tbody tr")).toHaveCount(10);
    const historyLength = await page.evaluate(() => history.length);
    const requests: string[] = [];
    page.on("request", (request) => {
      if (isList(request.url())) requests.push(request.url());
    });
    const search = page.getByPlaceholder("이름, 사번, 이메일, 조직 검색");
    await search.fill("  김개발  ");
    // 네트워크가 조용한 관찰 구간: 타이핑만으로 조회/주소 변경이 없어야 한다.
    await page.waitForTimeout(300);
    expect(requests).toHaveLength(0);
    expect(new URL(page.url()).search).toBe("?other=keep");
    // 제출 전 입력도 Select 변경 시 함께 적용한다.
    await chooseOrganization(page, "개발팀");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await choose(page, "재직상태 필터", "재직");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await choose(page, "배정상태 필터", "배정");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    const expected = {
      other: "keep",
      q: "김개발",
      organizationId: dev,
      status: "active",
      assignment: "assigned",
    };
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(
      expected,
    );
    await expect(search).toHaveValue("김개발");
    expect(requests).toHaveLength(3);
    for (let repeat = 0; repeat < 2; repeat++) {
      const response = page.waitForResponse((res) => isList(res.url()));
      await page.getByRole("button", { name: "검색", exact: true }).click();
      expect((await response).ok()).toBe(true);
      await expect(page.locator("table tbody tr")).toHaveCount(1);
      expect(requests).toHaveLength(4 + repeat);
    }
    await page.reload();
    await expect(search).toHaveValue("김개발");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual(
      expected,
    );
    await search.fill("  ");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(6);
    await chooseOrganization(page, "전체 조직");
    await expect(page.locator("table tbody tr")).toHaveCount(10);
    await choose(page, "재직상태 필터", "전체 재직상태");
    await expect(page.locator("table tbody tr")).toHaveCount(10);
    await choose(page, "배정상태 필터", "전체 배정상태");
    await expect(page.locator("table tbody tr")).toHaveCount(10);
    expect(new URL(page.url()).search).toBe("?other=keep");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });

  test("뒤로·앞으로 이동도 주소의 조건과 목록을 다시 읽는다", async ({
    page,
  }) => {
    await page.goto("/admin/employees?q=김개발");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    // 브라우저의 실제 history 항목 사이를 이동해 같은 페이지의 POP 복원을 확인한다.
    await page.evaluate(() =>
      history.pushState(null, "", "/admin/employees?q=영업팀"),
    );
    await page.goBack();
    await expect(
      page.getByPlaceholder("이름, 사번, 이메일, 조직 검색"),
    ).toHaveValue("김개발");
    await page.goForward();
    await expect(
      page.getByPlaceholder("이름, 사번, 이메일, 조직 검색"),
    ).toHaveValue("영업팀");
    await expect(page.locator("table tbody tr")).toHaveCount(2);
  });

  test("가져오기 두 경로도 확정 필터로 재조회하고 미제출 입력은 적용하지 않는다", async ({
    page,
  }) => {
    await page.goto(
      "/admin/employees?q=김개발&status=active&assignment=assigned",
    );
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await page.getByPlaceholder("이름, 사번, 이메일, 조직 검색").fill("영업팀");
    for (const [label, csv] of [
      ["직원 가져오기", "사번,이름\n,검증누락\n"],
      ["좌석 일괄 배정", "사번,좌석번호\n,검증누락\n"],
    ]) {
      // 유효한 CSV의 실패 행만 보내므로 실제 가져오기를 거치되 시드 데이터는 바꾸지 않는다.
      const response = page.waitForResponse((res) => isList(res.url()));
      await page
        .getByText(label, { exact: true })
        .locator('input[type="file"]')
        .setInputFiles({
          name: "empty.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv),
        });
      const res = await response;
      expect(res.ok()).toBe(true);
      expect(new URL(res.url()).searchParams.get("q")).toBe("김개발");
      await expect(page.locator("table tbody tr")).toHaveCount(1);
      expect(new URL(page.url()).searchParams.get("q")).toBe("김개발");
    }
  });

  test("조직 응답이 늦거나 실패해도 URL의 조직 조건을 보존한다", async ({
    page,
  }) => {
    const sales = (await organizations(page)).find(
      (org) => org.name === "영업팀",
    )!.id;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/organizations", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(
      `/admin/employees?organizationId=${sales}&status=unknown&assignment=all`,
    );
    try {
      await expect(page.locator("table tbody tr")).toHaveCount(2);
      await expect(
        page.getByRole("combobox", { name: "조직 필터" }),
      ).toHaveText(sales);
      await page.getByRole("button", { name: "검색", exact: true }).click();
      await expect(page.locator("table tbody tr")).toHaveCount(2);
      expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
        organizationId: sales,
      });
    } finally {
      release();
    }
    await expect(page.getByRole("combobox", { name: "조직 필터" })).toHaveText(
      "영업팀",
    );
    await page.unroute("**/api/v1/organizations");
    await page.route("**/api/v1/organizations", (route) =>
      route.abort("failed"),
    );
    await page.reload();
    await expect(page.locator("table tbody tr")).toHaveCount(2);
    await expect(page.getByRole("combobox", { name: "조직 필터" })).toHaveText(
      sales,
    );
    expect(new URL(page.url()).searchParams.get("organizationId")).toBe(sales);
  });
});
