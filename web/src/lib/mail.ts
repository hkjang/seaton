/**
 * 메일 알림 설정 화면의 규칙. 서버의 internal/mail 과 같은 키 이름을 쓴다.
 * 화면은 비밀번호를 되읽지 못하므로 "설정됨" 표시만 받는다.
 */

export type MailField = {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  type?: string;
};

export const MAIL_SECURITY_OPTIONS = [
  { value: "auto", label: "자동 · 서버가 알리는 대로 (권장)" },
  { value: "none", label: "없음 · 평문 (사내 릴레이 25번 포트)" },
  { value: "starttls", label: "STARTTLS 필수" },
  { value: "tls", label: "TLS 로 바로 연결 (465번 포트)" },
] as const;

export const MAIL_FIELDS: MailField[] = [
  {
    key: "mail.smtp_host",
    label: "SMTP 릴레이 주소",
    help: "예: mail.intra 또는 postra.intra · 사내 릴레이만",
  },
  {
    key: "mail.smtp_port",
    label: "포트",
    type: "number",
    help: "사내 릴레이는 대개 25",
  },
  {
    key: "mail.from_address",
    label: "보내는 주소",
    help: "예: seaton@company.intra · 비우면 seaton@<릴레이 주소>",
  },
  { key: "mail.from_name", label: "보내는 이름" },
  {
    key: "mail.username",
    label: "SMTP 사용자 이름",
    help: "인증 없는 릴레이면 비워 둡니다",
  },
  { key: "mail.password", label: "SMTP 비밀번호", secret: true },
  {
    key: "mail.base_url",
    label: "메일 속 링크 주소",
    help: "예: https://seaton.company.intra · 비우면 링크를 넣지 않습니다",
  },
  {
    key: "mail.timeout_seconds",
    label: "연결 제한 (초)",
    type: "number",
    help: "기본 10",
  },
];

/** 이벤트 종류별 스위치. 순서대로 화면에 놓인다. */
export const MAIL_EVENTS = [
  {
    key: "mail.notify_seat_assigned",
    label: "자리가 정해짐 → 그 직원",
    help: "배정·이동·일괄 등록 때 직원 명부의 메일 주소로. 자기 자리를 자기가 배정하면 보내지 않음",
  },
  {
    key: "mail.notify_analysis",
    label: "도면 분석 완료·실패 → 요청한 관리자",
    help: "비전 모델 판독처럼 오래 걸리는 분석이 끝났을 때",
  },
  {
    key: "mail.notify_hr_sync",
    label: "예약 인사 연동 실패 → 시스템 관리자 전원",
    help: "화면에서 직접 누른 동기화는 결과가 그 자리에 보이므로 보내지 않음",
  },
  {
    key: "mail.notify_api_key_expiring",
    label: "API 키 만료 7일 전 → 키 소유자",
    help: "사람마다 한 통에 묶어서. 같은 키에 두 번 보내지 않음",
  },
] as const;

/** 켜져 있고 릴레이 주소가 있어야 실제로 나간다. */
export const mailActive = (values: Record<string, string>) =>
  values["mail.enabled"] === "true" &&
  (values["mail.smtp_host"] ?? "").trim() !== "";

/** 켰지만 아직 보낼 수 없는 이유. 없으면 빈 문자열. */
export const mailMissing = (values: Record<string, string>) => {
  if (values["mail.enabled"] !== "true") return "";
  if ((values["mail.smtp_host"] ?? "").trim() === "")
    return "SMTP 릴레이 주소가 비어 있어 아직 보내지 않습니다.";
  const port = Number(values["mail.smtp_port"] ?? "25");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return "포트는 1~65535 사이여야 합니다.";
  return "";
};

export type DeliveryStatus = "queued" | "sent" | "failed";

export const DELIVERY_STATUS: Record<
  DeliveryStatus,
  { label: string; color: "default" | "success" | "error" }
> = {
  queued: { label: "대기", color: "default" },
  sent: { label: "보냄", color: "success" },
  failed: { label: "실패", color: "error" },
};

export const EVENT_LABELS: Record<string, string> = {
  "seat.assigned": "자리 배정",
  "analysis.finished": "도면 분석",
  "hr_sync.failed": "인사 연동 실패",
  "api_key.expiring": "API 키 만료 임박",
  test: "시험 발송",
};

export const eventLabel = (event: string) => EVENT_LABELS[event] ?? event;

/** 받는 사람 칸의 최소 검사. 서버가 다시 검사한다. */
export const validRecipient = (value: string) => {
  const trimmed = value.trim();
  return (
    trimmed.includes("@") &&
    !/[\s<>,]/.test(trimmed) &&
    trimmed.indexOf("@") > 0 &&
    trimmed.indexOf("@") < trimmed.length - 1
  );
};
