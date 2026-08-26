import { expect, test } from "@playwright/test";

test.describe("로그인 화면", () => {
  test("서버에 닿지 못하면 설정 문제로 안내하지 않고 다시 시도를 준다", async ({
    page,
  }) => {
    // 연결 실패를 "로그인 방식이 없다"로 안내하면, 관리자는 고칠 수 없는 설정
    // 화면을 들여다보게 되고 로그인 입력란까지 사라진다.
    await page.route("**/api/v1/**", (route) => route.abort("failed"));
    await page.goto("/login");
    await expect(page.getByText(/서버에 연결하지 못했습니다/)).toBeVisible();
    await expect(
      page.getByText(/사용 가능한 로그인 방식이 없습니다/),
    ).toHaveCount(0);

    await page.unroute("**/api/v1/**");
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(page.getByText(/서버에 연결하지 못했습니다/)).toHaveCount(0);
  });

  test("로그인 방식이 모두 꺼져 있으면 설정을 안내한다", async ({ page }) => {
    await page.route("**/api/v1/auth/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          localEnabled: false,
          oidcEnabled: false,
          version: { name: "SeatOn", version: "test" },
        }),
      }),
    );
    await page.goto("/login");
    await expect(
      page.getByText(/사용 가능한 로그인 방식이 없습니다/),
    ).toBeVisible();
  });
});
