import { expect, type Page } from "@playwright/test";

const USERNAME = process.env.E2E_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-verify-pass-123";

export const login = async (page: Page) => {
  await page.goto("/login");
  await page.fill('input[autocomplete="username"]', USERNAME);
  await page.fill('input[autocomplete="current-password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
};

export const mapCanvas = (page: Page) =>
  page.locator("svg[aria-label*='좌석 배치도']");

export const seatLabels = async (page: Page) =>
  mapCanvas(page).locator("text").allTextContents();

/**
 * 브라우저 콘솔 오류를 모은다. 타입 검사와 단위 테스트로는 드러나지 않는
 * 런타임 오류를 화면마다 붙잡는 용도다.
 */
export const watchConsole = (page: Page) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  return () => problems.filter((p) => !p.includes("401"));
};

export const expectNoConsoleErrors = async (page: Page, path: string) => {
  const problems = watchConsole(page);
  await page.goto(path);
  await expect(page.locator("main, [role=main]").first()).toBeVisible();
  expect(problems()).toHaveLength(0);
};
