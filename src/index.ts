import "./loadEnv.js";
import cookieParser from "cookie-parser";
import express from "express";
import type { ErrorRequestHandler } from "express";
import {
  getReminderWorkflowUrl,
  isLocalQStashDev,
  isLoopbackWorkflowUrl,
  isUpstashConfigured,
  REMINDER_WORKFLOW_PATH,
  WORKFLOW_TUNNEL_SETUP_HINT,
} from "./config/upstash.js";
import { connectDb } from "./db.js";
import { arcjetRateLimit } from "./middleware/arcjetRateLimit.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import subscriptionRoutes from "./routes/subscriptions.js";
import { reminderWorkflowRouter } from "./workflows/reminderWorkflow.js";

const app = express();
app.use(cookieParser());
app.use(express.json());

if (isUpstashConfigured()) {
  app.use(REMINDER_WORKFLOW_PATH, reminderWorkflowRouter);
  const workflowUrl = getReminderWorkflowUrl();
  console.info(`[Upstash] Reminder workflow mounted at POST ${REMINDER_WORKFLOW_PATH}`);
  console.info(`[Upstash] Workflow callback URL: ${workflowUrl}`);
  if (isLoopbackWorkflowUrl(workflowUrl) && !isLocalQStashDev()) {
    console.warn(`[Upstash] ${WORKFLOW_TUNNEL_SETUP_HINT}`);
  } else if (isLocalQStashDev()) {
    console.info("[Upstash] Using local QStash dev server — localhost workflow URL is OK");
  }
} else {
  console.warn("[Upstash] QSTASH_TOKEN not set — reminder workflow route disabled");
}

app.use(arcjetRateLimit);

app.get("/", (_req, res) => {
  res.send("Welcome to the Subscription Tracker API");
});

app.use("/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

const port = Number(process.env.PORT) || 3000;

async function main() {
  await connectDb();
  app.listen(port, () => {
    console.log(`Server listening on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
