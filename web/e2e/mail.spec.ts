import { expect, test, type Page } from "@playwright/test";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { login } from "./helpers";

/**
 * 메일 알림을 실제 SMTP 대화로 확인한다.
 *
 * 가짜 릴레이는 이 검증 프로세스 안에서 뜨는 인증 없는 25번 포트식 서버다.
 * 서버가 그곳에 닿을 주소는 E2E_COLLECTOR_HOST 로 준다 — CI 처럼
 * --network host 면 기본값 127.0.0.1 이고, Docker Desktop 의 브리지
 * 네트워크면 host.docker.internal 이다.
 */

type Envelope = { from: string; to: string[]; data: string };

const MAIL_KEYS = [
  "mail.enabled",
  "mail.smtp_host",
  "mail.smtp_port",
  "mail.security",
  "mail.from_address",
  "mail.from_name",
  "mail.username",
  "mail.base_url",
  "mail.timeout_seconds",
  "mail.notify_seat_assigned",
];

const putSettings = async (page: Page, settings: Record<string, string>) => {
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  return page.request.put("/api/v1/settings", {
    headers: { "X-CSRF-Token": me.csrfToken },
    data: { settings },
  });
};

const csrf = async (page: Page) =>
  (await (await page.request.get("/api/v1/auth/me")).json()).csrfToken;

// 가짜 릴레이: EHLO·MAIL·RCPT·DATA·QUIT 만 아는 최소 SMTP 서버.
const fakeRelay = () => {
  const envelopes: Envelope[] = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let envelope: Envelope = { from: "", to: [], data: "" };
    socket.write("220 relay.e2e ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            envelopes.push(envelope);
            envelope = { from: "", to: [], data: "" };
            socket.write("250 queued\r\n");
          } else {
            envelope.data += line.replace(/^\.\./, ".") + "\n";
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO")) socket.write("250-relay.e2e\r\n250 SIZE 1048576\r\n");
        else if (upper.startsWith("HELO")) socket.write("250 relay.e2e\r\n");
        else if (upper.startsWith("MAIL FROM:")) {
          envelope.from = line.slice(10).replace(/[<> ]/g, "");
          socket.write("250 OK\r\n");
        } else if (upper.startsWith("RCPT TO:")) {
          envelope.to.push(line.slice(8).replace(/[<> ]/g, ""));
          socket.write("250 OK\r\n");
        } else if (upper === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (upper === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("250 OK\r\n");
      }
    });
  });
  return { server, envelopes };
};

const decodeSubject = (data: string) => {
  const line = data.split("\n").find((l) => l.startsWith("Subject:")) ?? "";
  // =?utf-8?q?...?= 조각들을 풀어 한 줄로 만든다.
  return line
    .slice(8)
    .trim()
    .split(/\s+/)
    .map((part) => {
      const match = /^=\?utf-8\?q\?(.*)\?=$/i.exec(part);
      if (!match) return part;
      const bytes = match[1]
        .replace(/_/g, " ")
        .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
      return Buffer.from(bytes, "latin1").toString("utf8");
    })
    .join("");
};

test.describe("메일 알림", () => {
  const { server, envelopes } = fakeRelay();
  let relayHost = "";
  let relayPort = 0;
  let original: Record<string, string> = {};

  test.beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
    relayHost = process.env.E2E_COLLECTOR_HOST ?? "127.0.0.1";
    relayPort = (server.address() as AddressInfo).port;
  });
  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  test.beforeEach(async ({ page }) => {
    await login(page);
    const data = await (await page.request.get("/api/v1/settings")).json();
    original = Object.fromEntries(
      (data.items as { key: string; value: string }[])
        .filter((item) => MAIL_KEYS.includes(item.key))
        .map((item) => [item.key, item.value]),
    );
    envelopes.length = 0;
  });
  test.afterEach(async ({ page }) => {
    // 다른 검증은 메일이 꺼진 서버를 전제한다. 반드시 원래대로 돌린다.
    await putSettings(page, original);
  });

  test("기본은 꺼짐이고 비밀번호는 되읽히지 않는다", async ({ page }) => {
    expect(original["mail.enabled"]).toBe("false");
    expect(original["mail.smtp_port"]).toBe("25");
    expect(original["mail.security"]).toBe("auto");
    await putSettings(page, { "mail.password": "relay-secret-1234" });
    const data = await (await page.request.get("/api/v1/settings")).json();
    const password = (data.items as { key: string; value: string; secret: boolean; configured: boolean }[]).find(
      (item) => item.key === "mail.password",
    );
    expect(password?.secret).toBe(true);
    expect(password?.configured).toBe(true);
    expect(password?.value).toBe("********");
    expect(JSON.stringify(data)).not.toContain("relay-secret-1234");
    // 빈 값으로 저장하면 기존 비밀번호를 지우지 않는다.
    await putSettings(page, { "mail.password": "" });
    const again = await (await page.request.get("/api/v1/settings")).json();
    expect(
      (again.items as { key: string; configured: boolean }[]).find((i) => i.key === "mail.password")?.configured,
    ).toBe(true);
  });

  test("화면에서 저장 후 시험 발송하면 릴레이에 도착하고 기록에 남는다", async ({
    page,
  }) => {
    await page.goto("/admin/settings");
    await page.getByRole("tab", { name: "메일 알림" }).click();
    await expect(page.getByText("아직 보낸 메일이 없습니다.").or(page.getByLabel("메일 발송 기록"))).toBeVisible();
    await page.getByLabel("메일 알림 사용").check();
    await page.getByLabel("SMTP 릴레이 주소").fill(relayHost);
    await page.getByLabel("포트").fill(String(relayPort));
    await page.getByLabel("보내는 주소").fill("seaton@e2e.test");
    await page.getByLabel("보내는 이름").fill("SeatOn 검증");
    await page.getByLabel("메일 속 링크 주소").fill("https://seaton.e2e.test");
    await page.getByLabel("받는 사람").fill("kim@e2e.test");
    await page.getByRole("button", { name: "저장 후 시험 발송" }).click();
    await expect(
      page.getByText("kim@e2e.test 로 시험 메일을 보냈습니다"),
    ).toBeVisible();
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].from).toBe("seaton@e2e.test");
    expect(envelopes[0].to).toEqual(["kim@e2e.test"]);
    expect(decodeSubject(envelopes[0].data)).toBe("[SeatOn] SMTP 발송 시험");
    expect(envelopes[0].data).toContain("X-SeatOn-Notification: 1");
    // 발송 기록 표에 보냄으로 남는다.
    const table = page.getByLabel("메일 발송 기록");
    await expect(table).toBeVisible();
    const row = table.getByRole("row").filter({ hasText: "kim@e2e.test" });
    await expect(row.first()).toContainText("시험 발송");
    await expect(row.first()).toContainText("보냄");
    await expect(page.getByText("메일 알림 활성")).toBeVisible();
  });

  test("릴레이가 죽어 있으면 시험 발송은 실패를 말하고, 좌석 배정은 평소처럼 끝난다", async ({
    page,
  }) => {
    // 아무도 듣지 않는 포트.
    const closed = net.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "0.0.0.0", resolve));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await putSettings(page, {
      "mail.enabled": "true",
      "mail.smtp_host": relayHost,
      "mail.smtp_port": String(deadPort),
      "mail.from_address": "seaton@e2e.test",
      "mail.timeout_seconds": "2",
    });
    const token = await csrf(page);
    const test1 = await page.request.post("/api/v1/settings/mail/test", {
      headers: { "X-CSRF-Token": token },
      data: { recipient: "kim@e2e.test" },
    });
    expect(test1.status()).toBe(502);
    expect((await test1.json()).error.code).toBe("mail_send_failed");

    // 주소가 있는 직원을 빈 좌석에 배정한다. 릴레이가 죽어 있어도 204 다.
    const employee = await (
      await page.request.post("/api/v1/employees", {
        headers: { "X-CSRF-Token": token },
        data: { employeeNo: "E-MAIL-1", name: "메일검증", email: "mail-e2e@e2e.test" },
      })
    ).json();
    const seats = (await (await page.request.get("/api/v1/seats")).json()).items as {
      id: string;
      employeeId?: string;
      type: string;
    }[];
    const free = seats.find((s) => !s.employeeId && s.type === "fixed");
    expect(free).toBeTruthy();
    const started = Date.now();
    const assign = await page.request.post("/api/v1/seat-assignments", {
      headers: { "X-CSRF-Token": token },
      data: { employeeId: employee.id, seatId: free!.id, reason: "검증" },
    });
    expect(assign.status()).toBe(204);
    expect(Date.now() - started).toBeLessThan(2000);
    try {
      // 배경 발송이 두 번 시도한 뒤 실패로 기록된다.
      await expect
        .poll(
          async () => {
            const page1 = await (
              await page.request.get("/api/v1/settings/mail/deliveries?status=failed")
            ).json();
            return (page1.items as { event: string; recipient: string; attempts: number }[]).find(
              (d) => d.event === "seat.assigned" && d.recipient === "mail-e2e@e2e.test",
            )?.attempts;
          },
          { timeout: 20_000 },
        )
        .toBe(2);
      const log = await (await page.request.get("/api/v1/settings/mail/deliveries")).json();
      // 기록에는 본문이 없다.
      expect(JSON.stringify(log)).not.toContain("바로 열기");
    } finally {
      await page.request.delete(`/api/v1/seat-assignments/${free!.id}`, {
        headers: { "X-CSRF-Token": token },
      });
      await page.request.post("/api/v1/employees", {
        headers: { "X-CSRF-Token": token },
        data: { employeeNo: "E-MAIL-1", name: "메일검증", email: "", status: "retired" },
      });
    }
  });

  test("이벤트 스위치를 끄면 그 종류만 멎고, 켜면 직원에게 자리 메일이 간다", async ({
    page,
  }) => {
    await putSettings(page, {
      "mail.enabled": "true",
      "mail.smtp_host": relayHost,
      "mail.smtp_port": String(relayPort),
      "mail.from_address": "seaton@e2e.test",
      "mail.base_url": "https://seaton.e2e.test",
      "mail.notify_seat_assigned": "false",
    });
    const token = await csrf(page);
    const employee = await (
      await page.request.post("/api/v1/employees", {
        headers: { "X-CSRF-Token": token },
        data: { employeeNo: "E-MAIL-2", name: "박알림", email: "park@e2e.test" },
      })
    ).json();
    const seats = (await (await page.request.get("/api/v1/seats")).json()).items as {
      id: string;
      seatNo: string;
      employeeId?: string;
      type: string;
    }[];
    const free = seats.filter((s) => !s.employeeId && s.type === "fixed");
    expect(free.length).toBeGreaterThanOrEqual(2);
    try {
      const assign = async (seatId: string) =>
        page.request.post("/api/v1/seat-assignments", {
          headers: { "X-CSRF-Token": token },
          data: { employeeId: employee.id, seatId, reason: "검증 배정" },
        });
      expect((await assign(free[0].id)).status()).toBe(204);
      // 꺼진 종류는 나가지 않지만 시험 발송은 나간다.
      const probe = await page.request.post("/api/v1/settings/mail/test", {
        headers: { "X-CSRF-Token": token },
        data: { recipient: "probe@e2e.test" },
      });
      expect(probe.status()).toBe(200);
      expect(envelopes.map((e) => e.to[0])).toEqual(["probe@e2e.test"]);

      await putSettings(page, { "mail.notify_seat_assigned": "true" });
      expect((await assign(free[1].id)).status()).toBe(204);
      await expect
        .poll(() => envelopes.find((e) => e.to[0] === "park@e2e.test"), {
          timeout: 15_000,
        })
        .toBeTruthy();
      const mail = envelopes.find((e) => e.to[0] === "park@e2e.test")!;
      expect(decodeSubject(mail.data)).toContain("자리가 정해졌습니다");
      expect(decodeSubject(mail.data)).toContain(free[1].seatNo);
      expect(mail.data).toContain("박알림");
      expect(mail.data).toContain(`${free[0].seatNo}에서`);
      expect(mail.data).toContain("바로 열기: https://seaton.e2e.test/");
      expect(mail.data).toContain("Auto-Submitted: auto-generated");
      // 같은 자리에 다시 배정하면 바뀐 게 없으므로 다시 보내지 않는다.
      expect((await assign(free[1].id)).status()).toBe(204);
      await page.waitForTimeout(1500);
      expect(envelopes.filter((e) => e.to[0] === "park@e2e.test")).toHaveLength(1);
      // 기록에도 보냄으로 남고, 관리자 화면 표에 보인다.
      await page.goto("/admin/settings");
      await page.getByRole("tab", { name: "메일 알림" }).click();
      const row = page
        .getByLabel("메일 발송 기록")
        .getByRole("row")
        .filter({ hasText: "park@e2e.test" });
      await expect(row.first()).toContainText("자리 배정");
      await expect(row.first()).toContainText("보냄");
    } finally {
      await page.request.delete(`/api/v1/seat-assignments/${free[1].id}`, {
        headers: { "X-CSRF-Token": token },
      });
      await page.request.post("/api/v1/employees", {
        headers: { "X-CSRF-Token": token },
        data: { employeeNo: "E-MAIL-2", name: "박알림", email: "", status: "retired" },
      });
    }
  });
});
