import { expect, test } from "@playwright/test";
import { login, watchConsole } from "./helpers";

test.describe("도면 업로드와 AI 분석", () => {
  test("고를 것이 하나뿐인 목록은 미리 골라 둔다", async ({ page }) => {
    await login(page);
    await page.goto("/admin/maps");
    // 사업장이 하나뿐인데 목록을 펼쳐 고르게 하면, 저장이 왜 꺼져 있는지만
    // 헷갈린다.
    await page.getByRole("button", { name: "층", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox")).toHaveText(/본사/);
    await dialog.getByRole("button", { name: "취소" }).click();

    await page.getByRole("button", { name: /도면 업로드/ }).click();
    await expect(page.getByRole("dialog").getByRole("combobox")).toHaveText(
      /본사 · 3층/,
    );
  });

  // 도면 버전은 지울 수 있는 API가 없어 실행할 때마다 하나씩 쌓인다. 게시하지는
  // 않으므로 좌석맵이 보는 도면은 그대로고, 다른 검증에 영향을 주지 않는다.
  test("도면을 올리고 AI 분석까지 화면에서 끝낼 수 있다", async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await login(page);
    await page.goto("/admin/maps");
    await page.getByRole("button", { name: /도면 업로드/ }).click();

    const dialog = page.getByRole("dialog");
    const version = `t${Date.now().toString().slice(-6)}`;
    await dialog.getByLabel("도면 버전").fill(version);
    await dialog
      .locator("input[type=file]")
      .setInputFiles("e2e/fixtures/plan.png");
    await dialog.getByRole("button", { name: "업로드" }).click();

    // 카드 안쪽 요소도 같은 글을 담으므로, 분석 단추를 가진 것 중 가장 깊은
    // 것을 고른다.
    const card = page
      .locator("div")
      .filter({ hasText: new RegExp(`Version ${version}\\b`) })
      .filter({ has: page.getByRole("button", { name: "AI 분석" }) })
      .last();
    await expect(card).toContainText("분석 전", { timeout: 30_000 });

    // 분석은 비동기 작업이다. 요청 즉시 끝나지 않으므로 화면이 진행 상태를
    // 보여주고, 끝나면 인식된 좌석 수가 카드에 나타나야 한다.
    await card.getByRole("button", { name: "AI 분석" }).click();
    await expect(card).not.toContainText("분석 전", { timeout: 150_000 });
    await expect(card).toContainText(/[1-9]\d*석/);
    expect(problems()).toHaveLength(0);
  });
});
