import {
  assertWorkflowUrlReachableByQStash,
  getReminderUpcomingDays,
  getReminderWorkflowUrl,
  getWorkflowClient,
  isUpstashConfigured,
  type ReminderWorkflowPayload,
} from "../config/upstash.js";
type SchedulableSubscription = {
  _id: unknown;
  userId: unknown;
  renewalDate: Date;
  status: string;
};

export function reminderWorkflowRunId(subscriptionId: string): string {
  return `reminder-${subscriptionId}`;
}

/** Milliseconds before `renewalDate` to send the upcoming reminder. */
export function computeUpcomingReminderAt(renewalDate: Date, daysBefore: number): Date {
  const at = new Date(renewalDate.getTime());
  at.setUTCDate(at.getUTCDate() - daysBefore);
  return at;
}

/** Next smaller threshold in the configured schedule (e.g. 7 → 5), if any. */
export function getNextUpcomingDaysBefore(
  daysBefore: number,
  upcomingDays = getReminderUpcomingDays(),
): number | undefined {
  const idx = upcomingDays.indexOf(daysBefore);
  if (idx === -1 || idx >= upcomingDays.length - 1) return undefined;
  return upcomingDays[idx + 1];
}

/** True when `now` falls in this reminder's send window (inclusive start, exclusive end). */
export function isUpcomingReminderDue(
  renewalDate: Date,
  daysBefore: number,
  nextDaysBefore: number | undefined,
  now: Date = new Date(),
): boolean {
  const windowStart = computeUpcomingReminderAt(renewalDate, daysBefore);
  const windowEnd =
    nextDaysBefore !== undefined
      ? computeUpcomingReminderAt(renewalDate, nextDaysBefore)
      : renewalDate;

  const t = now.getTime();
  return windowStart.getTime() <= t && t < windowEnd.getTime();
}

export async function cancelSubscriptionReminders(subscriptionId: string): Promise<void> {
  if (!isUpstashConfigured()) return;

  try {
    await getWorkflowClient().cancel({ ids: reminderWorkflowRunId(subscriptionId) });
  } catch (err) {
    console.warn(`[Reminder schedule] cancel failed for ${subscriptionId}:`, err);
  }
}

export async function scheduleSubscriptionReminders(
  sub: SchedulableSubscription,
): Promise<{ scheduled: boolean; workflowRunId?: string }> {
  if (!isUpstashConfigured()) {
    return { scheduled: false };
  }

  const subscriptionId = String(sub._id);

  if (sub.status !== "active") {
    await cancelSubscriptionReminders(subscriptionId);
    return { scheduled: false };
  }

  const body: ReminderWorkflowPayload = {
    subscriptionId,
    userId: String(sub.userId),
    renewalDate: sub.renewalDate.toISOString(),
  };

  await cancelSubscriptionReminders(subscriptionId);
  assertWorkflowUrlReachableByQStash();

  const { workflowRunId } = await getWorkflowClient().trigger({
    url: getReminderWorkflowUrl(),
    body,
    workflowRunId: reminderWorkflowRunId(subscriptionId),
    label: reminderWorkflowRunId(subscriptionId),
  });

  return { scheduled: true, workflowRunId };
}

/** Fire-and-forget scheduling (does not fail the HTTP handler). */
export function enqueueSubscriptionReminders(sub: SchedulableSubscription): void {
  void scheduleSubscriptionReminders(sub).catch((err) => {
    console.error(`[Reminder schedule] failed for subscription ${sub._id}:`, err);
  });
}

export function enqueueCancelSubscriptionReminders(subscriptionId: string): void {
  void cancelSubscriptionReminders(subscriptionId).catch((err) => {
    console.error(`[Reminder schedule] cancel failed for ${subscriptionId}:`, err);
  });
}
