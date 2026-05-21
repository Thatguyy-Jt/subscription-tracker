import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { REMINDER_KINDS } from "../config/upstash.js";

const reminderSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
    },
    dueAt: { type: Date, required: true },
    kind: {
      type: String,
      required: true,
      enum: REMINDER_KINDS,
    },
    processedAt: { type: Date },
    snoozedUntil: { type: Date },
  },
  { timestamps: true },
);

reminderSchema.index({ userId: 1, dueAt: -1 });
reminderSchema.index({ subscriptionId: 1, dueAt: 1, kind: 1 }, { unique: true });

export type ReminderDoc = InferSchemaType<typeof reminderSchema>;

export const Reminder =
  mongoose.models.Reminder ??
  mongoose.model<ReminderDoc>("Reminder", reminderSchema);
