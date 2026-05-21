import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const SUBSCRIPTION_CURRENCIES = ["NGN", "USD", "GBP"] as const;
export type SubscriptionCurrency = (typeof SUBSCRIPTION_CURRENCIES)[number];

export const SUBSCRIPTION_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;
export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];

export const SUBSCRIPTION_CATEGORIES = [
  "sport",
  "news",
  "finance",
  "entertainment",
  "others",
] as const;
export type SubscriptionCategory = (typeof SUBSCRIPTION_CATEGORIES)[number];

export const SUBSCRIPTION_STATUSES = ["active", "cancelled", "paused"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const subscriptionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    price: { type: Number, required: true, min: 0 },
    currency: {
      type: String,
      required: true,
      enum: SUBSCRIPTION_CURRENCIES,
    },
    frequency: {
      type: String,
      required: true,
      enum: SUBSCRIPTION_FREQUENCIES,
    },
    category: {
      type: String,
      required: true,
      enum: SUBSCRIPTION_CATEGORIES,
    },
    paymentMethod: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    status: {
      type: String,
      required: true,
      enum: SUBSCRIPTION_STATUSES,
      default: "active",
    },
    startDate: { type: Date, required: true },
    renewalDate: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 2000 },
    /** True when renewal has passed while the subscription is still tracked as billable (active). */
    isOverdue: { type: Boolean, default: false },
  },
  { timestamps: true },
);

subscriptionSchema.index({ userId: 1, renewalDate: 1 });
subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ userId: 1, category: 1 });

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;

export const Subscription =
  mongoose.models.Subscription ??
  mongoose.model<SubscriptionDoc>("Subscription", subscriptionSchema);

/** Advance `from` by one billing period (for projections or bumping renewal after a successful charge). */
export function addBillingPeriod(
  from: Date,
  frequency: SubscriptionFrequency,
): Date {
  const d = new Date(from.getTime());
  switch (frequency) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "yearly":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d;
}

/** Full calendar periods from start until `until` (exclusive of the last boundary), e.g. plan length in months. */
export function countBillingPeriodsBetween(
  start: Date,
  until: Date,
  frequency: SubscriptionFrequency,
): number {
  if (until.getTime() <= start.getTime()) return 0;
  let n = 0;
  let cursor = new Date(start.getTime());
  while (addBillingPeriod(cursor, frequency).getTime() <= until.getTime()) {
    cursor = addBillingPeriod(cursor, frequency);
    n += 1;
    if (n > 10_000) break;
  }
  return n;
}

export function isRenewalInPast(renewalDate: Date, now: Date = new Date()): boolean {
  return renewalDate.getTime() < now.getTime();
}

/**
 * Overdue only when the subscription is expected to renew (active) and the renewal date has passed.
 * Cancelled/paused subs are not treated as overdue for reminder workflows.
 */
export function deriveIsOverdue(renewalDate: Date, status: SubscriptionStatus, now?: Date): boolean {
  return status === "active" && isRenewalInPast(renewalDate, now);
}
