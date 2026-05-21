import mongoose from "mongoose";
import { z } from "zod";
import {
  daysBeforeFromReminderKind,
  isUpcomingReminderKind,
  type ReminderKind,
  type ReminderWorkflowPayload,
} from "../config/upstash.js";
import { Reminder } from "../models/Reminder.js";
import { Subscription, deriveIsOverdue, type SubscriptionCurrency } from "../models/Subscription.js";
import { User } from "../models/User.js";
import {
  getNextUpcomingDaysBefore,
  isUpcomingReminderDue,
} from "./reminderScheduleService.js";
import { sendReminderEmail, type SendEmailResult } from "../utils/sendEmail.js";

const payloadSchema = z.object({
  subscriptionId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  renewalDate: z.coerce.date(),
});

const cyclePayloadSchema = z.object({
  subscriptionId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  renewalDate: z.coerce.date(),
});

export type ReminderWorkflowResult =
  | {
      ok: true;
      reminderId: string;
      subscriptionId: string;
      kind: ReminderKind;
      subscriptionName: string;
      notification: SendEmailResult;
    }
  | {
      ok: false;
      reason: string;
      status?: string;
    };

export type WorkflowCycleValidation =
  | { ok: true; renewalDate: Date }
  | { ok: false; reason: string };

function renewalDatesMatch(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: number }).code === 11000
  );
}

async function upsertProcessedReminder(params: {
  subscriptionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  dueAt: Date;
  kind: ReminderKind;
  processedAt: Date;
}) {
  const filter = {
    subscriptionId: params.subscriptionId,
    dueAt: params.dueAt,
    kind: params.kind,
  };

  try {
    return await Reminder.findOneAndUpdate(
      filter,
      {
        $set: {
          userId: params.userId,
          processedAt: params.processedAt,
        },
        $setOnInsert: filter,
      },
      { upsert: true, new: true },
    ).exec();
  } catch (err) {
    if (!isMongoDuplicateKeyError(err)) throw err;

    return Reminder.findOneAndUpdate(
      filter,
      { $set: { userId: params.userId, processedAt: params.processedAt } },
      { new: true },
    ).exec();
  }
}

/** Ensures the subscription is active and the workflow still targets the current renewal cycle. */
export async function validateSubscriptionReminderCycle(
  raw: ReminderWorkflowPayload,
): Promise<WorkflowCycleValidation> {
  const payload = cyclePayloadSchema.parse(raw);

  if (
    !mongoose.isValidObjectId(payload.subscriptionId) ||
    !mongoose.isValidObjectId(payload.userId)
  ) {
    return { ok: false, reason: "invalid_ids" };
  }

  const sub = await Subscription.findOne({
    _id: payload.subscriptionId,
    userId: payload.userId,
  }).exec();

  if (!sub) {
    return { ok: false, reason: "subscription_not_found" };
  }

  if (sub.status !== "active") {
    return { ok: false, reason: "subscription_not_active" };
  }

  if (!renewalDatesMatch(sub.renewalDate, payload.renewalDate)) {
    return { ok: false, reason: "renewal_cycle_superseded" };
  }

  return { ok: true, renewalDate: sub.renewalDate };
}

async function sendReminderNotification(params: {
  userId: string;
  subscriptionName: string;
  kind: ReminderKind;
  renewalDate: Date;
  price: number;
  currency: SubscriptionCurrency;
}): Promise<SendEmailResult> {
  const user = await User.findById(params.userId).select("email name").exec();

  if (!user?.email) {
    return {
      sent: false,
      channel: "email",
      error: "user_email_not_found",
    };
  }

  return sendReminderEmail(user.email, {
    userName: user.name ?? "",
    subscriptionName: params.subscriptionName,
    renewalDate: params.renewalDate,
    kind: params.kind,
    price: params.price,
    currency: params.currency,
  });
}

export async function processReminderWorkflow(
  raw: ReminderWorkflowPayload,
  kind: ReminderKind,
): Promise<ReminderWorkflowResult> {
  const payload = payloadSchema.parse(raw);

  if (
    !mongoose.isValidObjectId(payload.subscriptionId) ||
    !mongoose.isValidObjectId(payload.userId)
  ) {
    return { ok: false, reason: "invalid_ids" };
  }

  const sub = await Subscription.findOne({
    _id: payload.subscriptionId,
    userId: payload.userId,
  }).exec();

  if (!sub) {
    return { ok: false, reason: "subscription_not_found" };
  }

  if (sub.status !== "active") {
    return { ok: false, reason: "subscription_not_active", status: sub.status };
  }

  if (!renewalDatesMatch(sub.renewalDate, payload.renewalDate)) {
    return { ok: false, reason: "renewal_cycle_superseded" };
  }

  const now = new Date();

  if (isUpcomingReminderKind(kind)) {
    if (sub.renewalDate.getTime() <= now.getTime()) {
      return { ok: false, reason: "renewal_not_upcoming" };
    }

    const daysBefore = daysBeforeFromReminderKind(kind);
    if (daysBefore === undefined) {
      return { ok: false, reason: "invalid_upcoming_kind" };
    }

    const nextDaysBefore = getNextUpcomingDaysBefore(daysBefore);
    if (!isUpcomingReminderDue(sub.renewalDate, daysBefore, nextDaysBefore, now)) {
      return { ok: false, reason: "upcoming_not_due" };
    }
  } else if (!deriveIsOverdue(sub.renewalDate, sub.status, now)) {
    return { ok: false, reason: "not_overdue" };
  }

  if (kind === "overdue") {
    sub.isOverdue = true;
    await sub.save();
  }

  const dueAt = sub.renewalDate;
  const reminder = await upsertProcessedReminder({
    subscriptionId: sub._id,
    userId: sub.userId,
    dueAt,
    kind,
    processedAt: now,
  });

  if (!reminder) {
    return { ok: false, reason: "reminder_upsert_failed" };
  }

  const notification = await sendReminderNotification({
    userId: String(sub.userId),
    subscriptionName: sub.name,
    kind,
    renewalDate: sub.renewalDate,
    price: sub.price,
    currency: sub.currency,
  });

  return {
    ok: true,
    reminderId: reminder.id,
    subscriptionId: sub.id,
    kind,
    subscriptionName: sub.name,
    notification,
  };
}
