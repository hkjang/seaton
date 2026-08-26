import { expect, test } from "@playwright/test";
import { login, mapCanvas } from "./helpers";

test.describe("키보드 조작", () => {
  test("로그인 화면을 키보드만으로 지날 수 있다", async ({ page }) => {
    await page.goto("/login");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const focused = () =>
      page.evaluate(
        () =>
          document.activeElement?.getAttribute("autocomplete") ??
          document.activeElement?.getAttribute("type") ??
          "",
      );
    const stops: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      stops.push(await focused());
    }
    expect(stops).toContain("username");
    expect(stops).toContain("current-password");
    expect(stops).toContain("submit");
  });

  test("검색 결과를 키보드로 골라 좌석을 볼 수 있다", async ({ page }) => {
    await login(page);
    await mapCanvas(page).waitFor();
    // 좌석은 도면 위 그림이라 탭으로 닿지 않는다. 키보드 사용자가 좌석을 고르는
    // 길은 이 검색 목록뿐이므로 목록이 초점을 받고 Enter로 열려야 한다.
    await page.fill('input[placeholder*="이름"]', "개발팀");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/\d+명 검색됨/)).toBeVisible();

    const row = page.getByRole("button", {
      name: /이코딩 · 개발팀 .* 좌석 보기/,
    });
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /HQ-3F-/ })).toBeVisible();
    // 상세가 열리며 해당 좌석으로 확대된다.
    await expect(page.getByText(/^\d+%$/)).not.toHaveText("100%");
  });

  test("아이콘만 있는 조작에도 이름이 붙어 있다", async ({ page }) => {
    await login(page);
    await mapCanvas(page).waitFor();
    const unnamed = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("button, [role=button]")).filter(
          (el) =>
            !(
              el.getAttribute("aria-label") ||
              el.textContent?.trim() ||
              el.getAttribute("title")
            ),
        ).length,
    );
    expect(unnamed).toBe(0);
  });
});
