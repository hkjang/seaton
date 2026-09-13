import { expect, test, type Page } from "@playwright/test";

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

test.describe("조용한 SSO(prompt=none)", () => {
  // 서버의 auth/config 만 바꿔 auto_login 을 켠 것처럼 만들고, Keycloak 대신
  // 시작 경로를 가로채 "세션 없음"(login_required) 을 받은 콜백처럼
  // /login?sso=none 으로 돌려보낸다. 이 검증의 전부는 그 뒤에 다시 시도하지
  // 않는 것이다 — 다시 시도하면 브라우저가 제공자와 앱 사이를 끝없이 오간다.
  const autoLoginConfig = (page: Page, autoLogin: boolean) =>
    page.route("**/api/v1/auth/config", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          localEnabled: true,
          oidcEnabled: true,
          oidcAutoLogin: autoLogin,
          version: { name: "SeatOn", version: "test" },
        }),
      }),
    );
  const refuseSilently = async (page: Page) => {
    const starts: string[] = [];
    await page.route("**/api/v1/auth/oidc/start*", (route) => {
      starts.push(route.request().url());
      return route.fulfill({
        status: 302,
        headers: { location: "/login?sso=none" },
      });
    });
    return starts;
  };

  test("세션이 없으면 한 번만 시도하고 거절 뒤에는 새로고침해도 다시 가지 않는다", async ({
    page,
  }) => {
    await autoLoginConfig(page, true);
    const starts = await refuseSilently(page);
    await page.goto("/admin/maps?floor=3");
    await page.waitForURL(/\/login\?sso=none$/);
    expect(starts).toHaveLength(1);
    const start = new URL(starts[0]);
    expect(start.searchParams.get("prompt")).toBe("none");
    // 깊은 링크로 들어온 자리를 들고 간다.
    expect(start.searchParams.get("returnTo")).toBe("/admin/maps?floor=3");
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();

    // 거절당한 뒤 새로고침 — 주소의 표시가 막는다.
    await page.reload();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    expect(starts).toHaveLength(1);

    // 같은 탭에서 표시 없는 주소로 다시 들어와도 sessionStorage 가 막는다.
    await page.goto("/");
    await page.waitForURL(/\/login$/);
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    expect(starts).toHaveLength(1);
  });

  test("새 탭(새 세션 저장소)에서는 다시 한 번 시도한다", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await autoLoginConfig(page, true);
    const starts = await refuseSilently(page);
    await page.goto("/");
    await page.waitForURL(/\/login\?sso=none$/);
    expect(starts).toHaveLength(1);
    await context.close();
  });

  test("auto_login 이 꺼져 있으면 아무것도 달라지지 않는다", async ({ page }) => {
    await autoLoginConfig(page, false);
    const starts = await refuseSilently(page);
    await page.goto("/");
    await page.waitForURL(/\/login$/);
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    expect(starts).toHaveLength(0);
  });

  test("로그인 화면 자체에서는 시도하지 않는다", async ({ page }) => {
    await autoLoginConfig(page, true);
    const starts = await refuseSilently(page);
    await page.goto("/login");
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    expect(starts).toHaveLength(0);
  });
});
