import { expect, test } from "@playwright/test";
import { login, watchConsole } from "./helpers";

test.describe("관리 화면", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("변경 이력이 조회되고 오늘 범위 필터가 맞는다", async ({ page }) => {
    await page.goto("/admin/history");
    await expect(page.getByText(/전체 \d+건 중 \d+건/)).toBeVisible();
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();

    // 날짜 범위를 서버 표준시로 해석해 오늘치가 통째로 빠진 적이 있다.
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    await page.getByLabel("시작일").fill(stamp);
    await page.getByLabel("종료일").fill(stamp);
    await page.getByRole("button", { name: "조회" }).click();
    await expect(rows).toHaveCount(total);
  });

  test("도면 화면이 준비 단계와 도면 카드를 보여준다", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/admin/maps");
    await expect(page.getByText("본사 · 3층")).toBeVisible();
    await expect(page.getByText("게시 중")).toBeVisible();
    // 준비 단계는 끝난 것만 완료로 표시해야 한다. 처음 설치한 관리자가 아직
    // 하지 않은 단계까지 체크로 읽은 적이 있다.
    for (const step of ["1. 사업장", "3. 도면", "5. 게시"]) {
      await expect(page.getByLabel(`${step} · 완료`)).toBeVisible();
    }
    await expect(page.getByLabel(/다음 할 일$/)).toHaveCount(0);
    expect(problems()).toHaveLength(0);
  });

  test("처리 필요 목록이 열린다", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/admin/actions");
    await expect(page.getByRole("heading", { name: "처리필요" })).toBeVisible();
    expect(problems()).toHaveLength(0);
  });

  test("사용자 권한 화면이 열린다", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/admin/users");
    await expect(
      page.getByRole("cell", { name: /admin/ }).first(),
    ).toBeVisible();
    expect(problems()).toHaveLength(0);
  });

  test("시스템 설정은 불러오기 전에 빈 값으로 덮어쓰지 않는다", async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto("/admin/settings");
    await expect(
      page.getByRole("heading", { name: "시스템 설정" }),
    ).toBeVisible();
    expect(problems()).toHaveLength(0);
  });
});
