import { Client } from "@upstash/workflow";
import type { WorkflowServeOptions } from "@upstash/workflow";

/** HTTP path where the reminder Upstash Workflow endpoint is mounted. */
export const REMINDER_WORKFLOW_PATH =
  process.env.REMINDER_WORKFLOW_PATH?.trim() || "/api/workflows/reminders";

/** Default days-before-renewal schedule for upcoming reminder emails. */
export const REMINDER_UPCOMING_DAYS_DEFAULT = [7, 5, 2, 1] as const;

export const REMINDER_KINDS = [
  "upcoming-7",
  "upcoming-5",
  "upcoming-2",
  "upcoming-1",
  "overdue",
] as const;

export type ReminderKind = (typeof REMINDER_KINDS)[number];

export function isUpcomingReminderKind(
  kind: ReminderKind,
): kind is Extract<ReminderKind, `upcoming-${number}`> {
  return kind.startsWith("upcoming-");
}

export function upcomingKindForDays(daysBefore: number): ReminderKind {
  return `upcoming-${daysBefore}` as ReminderKind;
}

export function daysBeforeFromReminderKind(kind: ReminderKind): number | undefined {
  const match = kind.match(/^upcoming-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Payload for a subscription reminder workflow run (one billing cycle).
 * The workflow sleeps until upcoming/overdue times, then processes each phase.
 */
export type ReminderWorkflowPayload = {
  subscriptionId: string;
  userId: string;
  /** ISO 8601 renewal date for this billing cycle (must match the subscription). */
  renewalDate: string;
};

export type UpstashEnv = {
  qstashUrl: string;
  qstashToken: string;
  currentSigningKey?: string;
  nextSigningKey?: string;
  /** Public base URL of this API (tunnel URL in local dev). */
  workflowBaseUrl?: string;
};

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Read and validate Upstash/QStash env vars (throws if `QSTASH_TOKEN` is missing). */
export function getUpstashEnv(): UpstashEnv {
  const qstashToken = optionalTrimmed(process.env.QSTASH_TOKEN);
  if (!qstashToken) {
    throw new Error("QSTASH_TOKEN is required for Upstash Workflow");
  }

  return {
    qstashUrl: optionalTrimmed(process.env.QSTASH_URL) ?? "https://qstash.upstash.io",
    qstashToken,
    currentSigningKey: optionalTrimmed(process.env.QSTASH_CURRENT_SIGNING_KEY),
    nextSigningKey: optionalTrimmed(process.env.QSTASH_NEXT_SIGNING_KEY),
    workflowBaseUrl: optionalTrimmed(process.env.UPSTASH_WORKFLOW_URL),
  };
}

/** True when the minimum QStash token is present (does not validate signing keys). */
export function isUpstashConfigured(): boolean {
  return Boolean(optionalTrimmed(process.env.QSTASH_TOKEN));
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

/** True when QStash cannot reach the URL (local-only addresses). */
export function isLoopbackWorkflowUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return LOOPBACK_HOSTS.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const WORKFLOW_TUNNEL_SETUP_HINT =
  "Cloud QStash cannot call localhost. Use `npx @upstash/qstash-cli dev` and put its QSTASH_* values in .env.local, or set UPSTASH_WORKFLOW_URL to a public https tunnel URL.";

/** True when QSTASH_URL points at the local qstash-cli dev server. */
export function isLocalQStashDev(): boolean {
  const qstashUrl = optionalTrimmed(process.env.QSTASH_URL);
  if (!qstashUrl) return false;

  try {
    const { hostname } = new URL(qstashUrl);
    return LOOPBACK_HOSTS.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Base URL QStash uses to call workflow endpoints (`UPSTASH_WORKFLOW_URL` or local default). */
export function getWorkflowBaseUrl(): string {
  const { workflowBaseUrl } = getUpstashEnv();
  if (workflowBaseUrl) {
    return workflowBaseUrl.replace(/\/$/, "");
  }
  const port = Number(process.env.PORT) || 3000;
  return `http://127.0.0.1:${port}`;
}

/** Throws when cloud QStash would reject the workflow URL (localhost without a tunnel). */
export function assertWorkflowUrlReachableByQStash(): void {
  if (isLocalQStashDev()) return;

  const url = getReminderWorkflowUrl();
  if (isLoopbackWorkflowUrl(url)) {
    throw new Error(
      `Reminder workflow URL resolves to localhost (${url}). ${WORKFLOW_TUNNEL_SETUP_HINT}`,
    );
  }
}

/** Full URL for the reminder workflow endpoint (for `client.trigger`). */
export function getReminderWorkflowUrl(): string {
  const path = REMINDER_WORKFLOW_PATH.startsWith("/")
    ? REMINDER_WORKFLOW_PATH
    : `/${REMINDER_WORKFLOW_PATH}`;
  return `${getWorkflowBaseUrl()}${path}`;
}

/**
 * Days before renewal to fire upcoming reminder emails.
 * Override with comma-separated `REMINDER_UPCOMING_DAYS_BEFORE`, e.g. `7,5,2,1`.
 */
export function getReminderUpcomingDays(): number[] {
  const raw = process.env.REMINDER_UPCOMING_DAYS_BEFORE;
  if (!raw?.trim()) return [...REMINDER_UPCOMING_DAYS_DEFAULT];

  const parsed = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.floor(n));

  if (parsed.length === 0) return [...REMINDER_UPCOMING_DAYS_DEFAULT];

  return [...new Set(parsed)].sort((a, b) => b - a);
}

/** Options passed to `@upstash/qstash` / workflow `Client`. */
export function getQstashClientConfig(): { baseUrl: string; token: string } {
  const { qstashUrl, qstashToken } = getUpstashEnv();
  return { baseUrl: qstashUrl, token: qstashToken };
}

let workflowClient: Client | undefined;

/** Singleton workflow client for triggering and managing reminder runs. */
export function getWorkflowClient(): Client {
  workflowClient ??= new Client(getQstashClientConfig());
  return workflowClient;
}

/**
 * Options for `serve()` from `@upstash/workflow/express` on the reminder route.
 * QStash client and receiver are inferred from `QSTASH_*` env vars when omitted.
 */
export function getReminderWorkflowServeOptions(): Pick<
  WorkflowServeOptions,
  "baseUrl" | "retries"
> {
  return {
    baseUrl: getWorkflowBaseUrl(),
    retries: 3,
  };
}
