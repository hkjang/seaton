import { chromium } from "playwright";
const OUT = process.env.OUT, BASE = "http://127.0.0.1:18781";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });

// 1) 로그인 화면을 키보드만으로
await p.goto(BASE + "/login");
const trail = [];
for (let i = 0; i < 6; i++) {
  await p.keyboard.press("Tab");
  trail.push(await p.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "없음";
    const style = getComputedStyle(el);
    return `${el.tagName.toLowerCase()}[${el.getAttribute("autocomplete") ?? el.getAttribute("type") ?? ""}] "${(el.textContent ?? "").trim().slice(0, 14)}" outline=${style.outlineWidth}/${style.outlineStyle}`;
  }));
}
console.log("로그인 탭 순서:");
trail.forEach((t, i) => console.log(` ${i + 1}. ${t}`));

await p.fill('input[autocomplete="username"]', "admin");
await p.fill('input[autocomplete="current-password"]', "e2e-verify-pass-123");
await p.keyboard.press("Enter");
await p.waitForURL((u) => !u.pathname.startsWith("/login"));
await p.waitForSelector("svg[aria-label*='좌석 배치도']");
console.log("Enter로 로그인: 됨");

// 2) 좌석맵에서 Tab이 좌석/조작에 닿는가
await p.keyboard.press("Tab");
const first = [];
for (let i = 0; i < 12; i++) {
  first.push(await p.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 16)}` : "없음";
  }));
  await p.keyboard.press("Tab");
}
console.log("\n좌석맵 탭 순서:");
first.forEach((t, i) => console.log(` ${i + 1}. ${t}`));

// 3) 포커스 표시가 보이는가
await p.screenshot({ path: `${OUT}/a11y-focus.png` });

// 4) 이미지/아이콘 버튼에 이름이 있는가
const unnamed = await p.evaluate(() =>
  Array.from(document.querySelectorAll("button, [role=button]"))
    .filter((el) => !(el.getAttribute("aria-label") || el.textContent?.trim() || el.getAttribute("title")))
    .map((el) => el.outerHTML.slice(0, 90)));
console.log("\n이름 없는 버튼:", unnamed.length, unnamed.slice(0, 4));
await b.close();
