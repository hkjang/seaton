import { chromium } from "playwright";
const OUT = process.env.OUT,
  BASE = "http://127.0.0.1:18781";
const b = await chromium.launch();
const p = await b.newPage({
  viewport: { width: 1440, height: 900 },
  locale: "ko-KR",
});
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(BASE + "/login");
await p.fill('input[autocomplete="username"]', "admin");
await p.fill('input[autocomplete="current-password"]', "e2e-verify-pass-123");
await p.click('button[type="submit"]');
await p.waitForURL((u) => !u.pathname.startsWith("/login"));
await p.goto(BASE + "/admin/maps");
await p.waitForTimeout(1000);

// 층 추가
await p.getByRole("button", { name: "층", exact: true }).click();
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/up-1-floor.png` });
const dialog = p.getByRole("dialog");
await dialog.getByRole("combobox").click();
await p.getByRole("option", { name: /본사/ }).click();
await dialog.getByLabel("층 이름").fill("4층");
await dialog.getByLabel("층 코드").fill("4F");
await dialog.getByRole("button", { name: /추가|저장|등록/ }).click();
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/up-2-added.png` });

// 도면 업로드
await p.getByRole("button", { name: /도면 업로드/ }).click();
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/up-3-dialog.png` });
await p.locator("input[type=file]").setInputFiles("e2e/fixtures/plan.png");
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/up-4-picked.png` });
console.log(
  "오류:",
  [...new Set(errs)].filter((e) => !e.includes("401")),
);
await b.close();
