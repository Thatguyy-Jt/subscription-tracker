import mongoose from "mongoose";
import { Reminder } from "./models/Reminder.js";
import { User } from "./models/User.js";

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);

  await User.collection.updateMany(
    { role: { $exists: false } },
    { $set: { role: "user" } },
  );

  // Drop stale reminder indexes (e.g. unique on subscriptionId+dueAt without kind).
  await Reminder.syncIndexes();
}
