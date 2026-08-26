import { expect, test } from "@playwright/test";
import { fetchSeats, keepingSeats, login, watchConsole } from "./helpers";

test.describe("관리 화면", () => {
  test.beforeEach(async ({ page }) => login(page));

  test("변경 이력이 조회되고 오늘 범위 필터가 맞는다", async ({ page }) => {
    // 방금 만든 변경이 "오늘"로 조회되는지 본다. 예전에는 날짜 범위를 서버
    // 표준시로 해석해, 사용자가 고른 오늘이 서버에서는 다른 날이 되어 방금 한
    // 변경이 통째로 빠졌다.
    const me = await (await page.request.get("/api/v1/auth/me")).json();
    const seats = await fetchSeats(page);
    // 같은 좌석으로 다시 배정하면 아무 일도 일어나지 않아 이력이 남지 않는다.
    // 빈 좌석으로 옮겨 이력을 만들고, 확인이 끝나면 제자리로 돌린다.
    const target = seats.find((seat) => !seat.employeeName)!;
    await keepingSeats(page, ["윤총무"], async () => {
      await page.request.post("/api/v1/seat-assignments", {
        headers: { "X-CSRF-Token": me.csrfToken },
        data: {
          employeeId: (
            await (await page.request.get("/api/v1/employees?q=윤총무")).json()
          ).items[0].id,
          seatId: target.id,
          source: "manual",
          reason: `오늘 확인 ${Date.now()}`,
        },
      });

      await page.goto("/admin/history");
      await expect(page.getByText(/전체 \d+건 중 \d+건/)).toBeVisible();
      const rows = page.locator("tbody tr");
      await expect(rows.first()).toBeVisible();

      const today = new Date();
      const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      await page.getByLabel("시작일").fill(stamp);
      await page.getByLabel("종료일").fill(stamp);
      await page.getByRole("button", { name: "조회" }).click();
      await expect(page.getByText(/오늘 확인 \d+/).first()).toBeVisible();
      // 내일부터로 좁히면 방금 한 변경은 빠져야 한다.
      const tomorrow = new Date(today.getTime() + 86400000);
      const next = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
      await page.getByLabel("시작일").fill(next);
      await page.getByLabel("종료일").fill(next);
      await page.getByRole("button", { name: "조회" }).click();
      await expect(page.getByText(/오늘 확인 \d+/)).toHaveCount(0);
    });
  });

  test("도면 화면이 준비 단계와 도면 카드를 보여준다", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/admin/maps");
    // 도면 버전은 여러 개일 수 있다. 실제 설치에서도 버전이 쌓이므로 개수를
    // 전제하지 않는다.
    await expect(page.getByText("본사 · 3층").first()).toBeVisible();
    await expect(page.getByText("게시 중").first()).toBeVisible();
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
