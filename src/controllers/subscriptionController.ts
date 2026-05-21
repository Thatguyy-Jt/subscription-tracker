import type { Request, Response } from "express";
import mongoose, { type HydratedDocument } from "mongoose";
import { z } from "zod";
import type { SubscriptionDoc } from "../models/Subscription.js";
import {
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_CURRENCIES,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_STATUSES,
  Subscription,
  addBillingPeriod,
  deriveIsOverdue,
} from "../models/Subscription.js";
import {
  enqueueCancelSubscriptionReminders,
  enqueueSubscriptionReminders,
} from "../services/reminderScheduleService.js";

const currencyEnum = z.enum(SUBSCRIPTION_CURRENCIES);
const frequencyEnum = z.enum(SUBSCRIPTION_FREQUENCIES);
const categoryEnum = z.enum(SUBSCRIPTION_CATEGORIES);
const statusEnum = z.enum(SUBSCRIPTION_STATUSES);

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  price: z.number().nonnegative(),
  currency: currencyEnum,
  frequency: frequencyEnum,
  category: categoryEnum,
  paymentMethod: z.string().trim().min(1).max(120),
  status: statusEnum.optional(),
  startDate: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
});

const updateBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    price: z.number().nonnegative().optional(),
    currency: currencyEnum.optional(),
    frequency: frequencyEnum.optional(),
    category: categoryEnum.optional(),
    paymentMethod: z.string().trim().min(1).max(120).optional(),
    status: statusEnum.optional(),
    startDate: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

const listQuery = z.object({
  status: statusEnum.optional(),
  category: categoryEnum.optional(),
});

function toPublicSubscription(doc: HydratedDocument<SubscriptionDoc>) {
  return {
    id: doc.id,
    userId: String(doc.userId),
    name: doc.name,
    price: doc.price,
    currency: doc.currency,
    frequency: doc.frequency,
    category: doc.category,
    paymentMethod: doc.paymentMethod,
    status: doc.status,
    startDate: doc.startDate,
    renewalDate: doc.renewalDate,
    notes: doc.notes,
    isOverdue: doc.isOverdue,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listSubscriptions(req: Request, res: Response): Promise<void> {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      message:
        "Invalid query parameters. Optional filters: status (active|cancelled|paused), category (sport|news|finance|entertainment|others).",
      details: parsed.error.flatten(),
    });
    return;
  }
  const { status, category } = parsed.data;
  const filter: Record<string, unknown> = { userId: req.user!.id };
  if (status) filter.status = status;
  if (category) filter.category = category;

  const items = await Subscription.find(filter).sort({ renewalDate: 1 }).exec();
  res.json({
    message: "Subscriptions retrieved successfully.",
    subscriptions: items.map(toPublicSubscription),
  });
}

export async function createSubscription(req: Request, res: Response): Promise<void> {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      message:
        "Subscription body is invalid. Required: name, price (≥0), currency (NGN|USD|GBP), frequency (daily|weekly|monthly|yearly), category, paymentMethod, startDate; optional: status, notes. renewalDate is computed from startDate and frequency.",
      details: parsed.error.flatten(),
    });
    return;
  }
  const body = parsed.data;
  const status = body.status ?? "active";
  const renewalDate = addBillingPeriod(body.startDate, body.frequency);
  const isOverdue = deriveIsOverdue(renewalDate, status);

  const sub = await Subscription.create({
    userId: req.user!.id,
    name: body.name,
    price: body.price,
    currency: body.currency,
    frequency: body.frequency,
    category: body.category,
    paymentMethod: body.paymentMethod,
    status,
    startDate: body.startDate,
    renewalDate,
    notes: body.notes,
    isOverdue,
  });

  enqueueSubscriptionReminders(sub);

  res.status(201).json({
    message: "Subscription created successfully.",
    subscription: toPublicSubscription(sub),
  });
}

export async function getSubscriptionById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({
      error: "Invalid subscription id",
      message: "The subscription id in the URL is not a valid MongoDB ObjectId.",
    });
    return;
  }
  const sub = await Subscription.findOne({ _id: id, userId: req.user!.id }).exec();
  if (!sub) {
    res.status(404).json({
      error: "Subscription not found",
      message: "No subscription with this id exists for your account.",
    });
    return;
  }
  res.json({
    message: "Subscription retrieved successfully.",
    subscription: toPublicSubscription(sub),
  });
}

export async function updateSubscription(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({
      error: "Invalid subscription id",
      message: "The subscription id in the URL is not a valid MongoDB ObjectId.",
    });
    return;
  }
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      message:
        "Update body is invalid or empty. Send at least one allowed field (name, price, currency, frequency, category, paymentMethod, status, startDate, notes). renewalDate is recomputed when startDate or frequency changes.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const sub = await Subscription.findOne({ _id: id, userId: req.user!.id }).exec();
  if (!sub) {
    res.status(404).json({
      error: "Subscription not found",
      message: "No subscription with this id exists for your account.",
    });
    return;
  }

  const patch = parsed.data;
  if (patch.name !== undefined) sub.name = patch.name;
  if (patch.price !== undefined) sub.price = patch.price;
  if (patch.currency !== undefined) sub.currency = patch.currency;
  if (patch.frequency !== undefined) sub.frequency = patch.frequency;
  if (patch.category !== undefined) sub.category = patch.category;
  if (patch.paymentMethod !== undefined) sub.paymentMethod = patch.paymentMethod;
  if (patch.status !== undefined) sub.status = patch.status;
  if (patch.startDate !== undefined) sub.startDate = patch.startDate;
  if (patch.notes !== undefined) sub.notes = patch.notes;

  if (patch.startDate !== undefined || patch.frequency !== undefined) {
    sub.renewalDate = addBillingPeriod(sub.startDate, sub.frequency);
  }

  sub.isOverdue = deriveIsOverdue(sub.renewalDate, sub.status);
  await sub.save();

  if (sub.status === "active") {
    enqueueSubscriptionReminders(sub);
  } else {
    enqueueCancelSubscriptionReminders(sub.id);
  }

  res.json({
    message: "Subscription updated successfully.",
    subscription: toPublicSubscription(sub),
  });
}

export async function deleteSubscription(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({
      error: "Invalid subscription id",
      message: "The subscription id in the URL is not a valid MongoDB ObjectId.",
    });
    return;
  }
  const deleted = await Subscription.findOneAndDelete({ _id: id, userId: req.user!.id }).exec();
  if (!deleted) {
    res.status(404).json({
      error: "Subscription not found",
      message: "No subscription with this id exists for your account.",
    });
    return;
  }

  enqueueCancelSubscriptionReminders(deleted.id);

  res.status(200).json({ message: "Subscription deleted successfully." });
}
