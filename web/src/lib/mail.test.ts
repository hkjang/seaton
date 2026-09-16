import { describe, expect, it } from "vitest";
import {
  MAIL_EVENTS,
  MAIL_FIELDS,
  eventLabel,
  mailActive,
  mailMissing,
  validRecipient,
} from "./mail";

describe("MAIL_FIELDS", () => {
  it("표준의 키 이름을 그대로 쓰고 비밀번호만 비밀값이다", () => {
    expect(MAIL_FIELDS.map((f) => f.key)).toEqual([
      "mail.smtp_host",
      "mail.smtp_port",
      "mail.from_address",
      "mail.from_name",
      "mail.username",
      "mail.password",
      "mail.base_url",
      "mail.timeout_seconds",
    ]);
    expect(MAIL_FIELDS.filter((f) => f.secret).map((f) => f.key)).toEqual([
      "mail.password",
    ]);
  });
  it("이벤트 스위치는 서버의 EventSettings 와 같은 넷이다", () => {
    expect(MAIL_EVENTS.map((e) => e.key)).toEqual([
      "mail.notify_seat_assigned",
      "mail.notify_analysis",
      "mail.notify_hr_sync",
      "mail.notify_api_key_expiring",
    ]);
  });
});

describe("mailActive / mailMissing", () => {
  it("꺼져 있으면 무엇이 있어도 비활성이고 이유도 없다", () => {
    expect(mailActive({ "mail.smtp_host": "relay.intra" })).toBe(false);
    expect(mailMissing({ "mail.smtp_host": "relay.intra" })).toBe("");
  });
  it("켰지만 주소가 없으면 이유를 말한다", () => {
    const values = { "mail.enabled": "true", "mail.smtp_host": "  " };
    expect(mailActive(values)).toBe(false);
    expect(mailMissing(values)).toContain("릴레이 주소");
  });
  it("포트가 범위를 벗어나면 이유를 말한다", () => {
    expect(
      mailMissing({
        "mail.enabled": "true",
        "mail.smtp_host": "relay.intra",
        "mail.smtp_port": "70000",
      }),
    ).toContain("포트");
  });
  it("주소가 있으면 활성이며 포트를 비워도 기본값이 있다", () => {
    const values = { "mail.enabled": "true", "mail.smtp_host": "relay.intra" };
    expect(mailActive(values)).toBe(true);
    expect(mailMissing(values)).toBe("");
  });
});

describe("validRecipient", () => {
  it("주소 하나만 받는다", () => {
    expect(validRecipient(" kim@example.test ")).toBe(true);
    expect(validRecipient("kim")).toBe(false);
    expect(validRecipient("@example.test")).toBe(false);
    expect(validRecipient("kim@")).toBe(false);
    expect(validRecipient("a@b.test, c@d.test")).toBe(false);
    expect(validRecipient("Kim <kim@example.test>")).toBe(false);
  });
});

describe("eventLabel", () => {
  it("아는 이벤트는 우리말, 모르는 것은 그대로", () => {
    expect(eventLabel("seat.assigned")).toBe("자리 배정");
    expect(eventLabel("test")).toBe("시험 발송");
    expect(eventLabel("future.event")).toBe("future.event");
  });
});
