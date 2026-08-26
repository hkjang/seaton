import { expect, test } from "@playwright/test";
import { login, watchConsole } from "./helpers";

test.describe("도면 버전 삭제", () => {
  test("잘못 올린 버전을 지울 수 있다", async ({ page }) => {
    const problems = watchConsole(page);
    await login(page);
    await page.goto("/admin/maps");
    await page.getByRole("button", { name: /도면 업로드/ }).click();

    const dialog = page.getByRole("dialog");
    const version = `x${Date.now().toString().slice(-6)}`;
    await dialog.getByLabel("도면 버전").fill(version);
    await dialog
      .locator("input[type=file]")
      .setInputFiles("e2e/fixtures/plan.png");
    await dialog.getByRole("button", { name: "업로드" }).click();

    const card = page
      .locator("div")
      .filter({ hasText: new RegExp(`Version ${version}\\b`) })
      .filter({ has: page.getByRole("button", { name: "삭제" }) })
      .last();
    await expect(card).toBeVisible({ timeout: 30_000 });

    await card.getByRole("button", { name: "삭제" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText(version);
    await confirm.getByRole("button", { name: "삭제" }).click();

    await expect(page.getByText(`Version ${version}`)).toHaveCount(0);
    expect(problems()).toHaveLength(0);
  });

  test("게시 중인 도면은 지울 수 없다", async ({ page }) => {
    await login(page);
    await page.goto("/admin/maps");
    // 서비스 중인 도면을 실수로 지우면 좌석맵이 통째로 비어 버린다. 화면에는
    // 삭제 단추 자체가 없어야 하고, 서버도 거절해야 한다.
    const published = page
      .locator("div")
      .filter({ hasText: "게시 중" })
      .filter({ has: page.getByRole("button", { name: "AI 분석" }) })
      .last();
    await expect(published.getByRole("button", { name: "삭제" })).toHaveCount(
      0,
    );

    const maps = await (await page.request.get("/api/v1/floor-maps")).json();
    const active = maps.items.find((m: { active?: boolean }) => m.active);
    const me = await (await page.request.get("/api/v1/auth/me")).json();
    const response = await page.request.delete(
      `/api/v1/floor-maps/${active.id}`,
      { headers: { "X-CSRF-Token": me.csrfToken } },
    );
    expect(response.status()).toBe(409);
    expect(await response.text()).toContain("게시 중인 도면");
  });
});
