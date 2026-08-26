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
 * 좌석 목록을 API로 읽는다. 화면을 거치지 않으므로 검증 전후 상태를 확인하고
 * 되돌리는 데 쓴다.
 */
export const fetchSeats = async (page: Page) => {
  const maps = await (await page.request.get("/api/v1/floor-maps")).json();
  const mapId = maps.items[0].id;
  const seats = await (
    await page.request.get(`/api/v1/seats?floorMapId=${mapId}`)
  ).json();
  return seats.items as Array<{
    id: string;
    seatNo: string;
    x: number;
    y: number;
    employeeName?: string;
  }>;
};

/**
 * 좌석 위치를 원래대로 되돌린다. 배치 편집 검증은 서버 상태를 실제로 바꾸므로,
 * 되돌리지 않으면 반복 실행할수록 좌석이 밀려 다음 실행이 깨진다.
 */
export const restoreSeat = async (
  page: Page,
  id: string,
  at: { x: number; y: number },
) => {
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  await page.request.patch(`/api/v1/seats/${id}`, {
    headers: { "X-CSRF-Token": me.csrfToken },
    data: { x: at.x, y: at.y },
  });
};

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
