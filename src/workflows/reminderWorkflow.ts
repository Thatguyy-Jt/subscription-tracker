import { serve } from "@upstash/workflow/express";
import type { WorkflowContext } from "@upstash/workflow";
import { z } from "zod";
import {
  getReminderUpcomingDays,
  getReminderWorkflowServeOptions,
  upcomingKindForDays,
  type ReminderWorkflowPayload,
} from "../config/upstash.js";
import { computeUpcomingReminderAt } from "../services/reminderScheduleService.js";
import {
  processReminderWorkflow,
  validateSubscriptionReminderCycle,
} from "../services/reminderWorkflowService.js";

const payloadSchema = z.object({
  subscriptionId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  renewalDate: z.coerce.date(),
});

function parsePayload(raw: ReminderWorkflowPayload): z.infer<typeof payloadSchema> {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "Invalid reminder workflow payload: subscriptionId, userId, and renewalDate (ISO) are required.",
    );
  }
  return parsed.data;
}

async function sleepUntilIfFuture(
  context: WorkflowContext<ReminderWorkflowPayload>,
  stepName: string,
  at: Date,
): Promise<void> {
  if (at.getTime() > Date.now()) {
    await context.sleepUntil(stepName, at);
  }
}

export const reminderWorkflowRouter = serve<ReminderWorkflowPayload>(
  async (context) => {
    const payload = parsePayload(context.requestPayload);
    const renewalDate = payload.renewalDate;

    const cycle = await context.run("validate-cycle", async () =>
      validateSubscriptionReminderCycle({
        subscriptionId: payload.subscriptionId,
        userId: payload.userId,
        renewalDate: renewalDate.toISOString(),
      }),
    );

    if (!cycle.ok) {
      return { phase: "validate-cycle", ...cycle };
    }

    const upcomingDays = await context.run("config-upcoming-days", async () =>
      getReminderUpcomingDays(),
    );

    const upcomingResults: Array<
      Awaited<ReturnType<typeof processReminderWorkflow>> & { daysBefore: number }
    > = [];

    for (const daysBefore of upcomingDays) {
      const upcomingAt = computeUpcomingReminderAt(renewalDate, daysBefore);
      await sleepUntilIfFuture(context, `wait-upcoming-${daysBefore}`, upcomingAt);

      const result = await context.run(`process-upcoming-${daysBefore}`, async () =>
        processReminderWorkflow(
          {
            subscriptionId: payload.subscriptionId,
            userId: payload.userId,
            renewalDate: renewalDate.toISOString(),
          },
          upcomingKindForDays(daysBefore),
        ),
      );

      upcomingResults.push({ daysBefore, ...result });

      if (!result.ok && result.reason === "renewal_cycle_superseded") {
        return { phase: `process-upcoming-${daysBefore}`, ...result };
      }
    }

    await sleepUntilIfFuture(context, "wait-renewal", renewalDate);

    const overdue = await context.run("process-overdue", async () =>
      processReminderWorkflow(
        {
          subscriptionId: payload.subscriptionId,
          userId: payload.userId,
          renewalDate: renewalDate.toISOString(),
        },
        "overdue",
      ),
    );

    return {
      phase: "complete",
      upcoming: upcomingResults,
      overdue,
    };
  },
  getReminderWorkflowServeOptions(),
);
