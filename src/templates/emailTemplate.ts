import type { ReminderKind } from "../config/upstash.js";
import type { SubscriptionCurrency } from "../models/Subscription.js";

export type ReminderEmailContext = {
  userName: string;
  subscriptionName: string;
  renewalDate: Date;
  kind: ReminderKind;
  price?: number;
  currency?: SubscriptionCurrency;
};

type ReminderCopy = {
  subject: string;
  headline: string;
  body: string;
  urgency: "info" | "warning" | "critical";
};

function formatRenewalDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatPrice(price: number, currency: SubscriptionCurrency): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function daysBeforeFromKind(kind: ReminderKind): number | undefined {
  const match = kind.match(/^upcoming-(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function getReminderCopy(ctx: ReminderEmailContext): ReminderCopy {
  const renewalLabel = formatRenewalDate(ctx.renewalDate);
  const daysBefore = daysBeforeFromKind(ctx.kind);

  if (ctx.kind === "overdue") {
    return {
      subject: `Overdue: ${ctx.subscriptionName} renewal`,
      headline: "Your subscription renewal is overdue",
      body: `${ctx.subscriptionName} was due to renew on ${renewalLabel}. If you still intend to keep this subscription, review your payment method or update the renewal date in your tracker.`,
      urgency: "critical",
    };
  }

  const dayWord =
    daysBefore === 1 ? "day" : "days";

  switch (daysBefore) {
    case 7:
      return {
        subject: `${ctx.subscriptionName} renews in 7 days`,
        headline: "One week until renewal",
        body: `Your ${ctx.subscriptionName} subscription renews in 7 days on ${renewalLabel}. This is a good time to confirm your budget and payment details.`,
        urgency: "info",
      };
    case 5:
      return {
        subject: `${ctx.subscriptionName} renews in 5 days`,
        headline: "Renewal coming up soon",
        body: `${ctx.subscriptionName} will renew in 5 days on ${renewalLabel}. Make sure your card or payment method is ready.`,
        urgency: "info",
      };
    case 2:
      return {
        subject: `${ctx.subscriptionName} renews in 2 days`,
        headline: "Renewal is almost here",
        body: `Only 2 ${dayWord} left before ${ctx.subscriptionName} renews on ${renewalLabel}. Cancel or adjust the subscription now if you no longer need it.`,
        urgency: "warning",
      };
    case 1:
      return {
        subject: `Final reminder: ${ctx.subscriptionName} renews tomorrow`,
        headline: "Renewal is tomorrow",
        body: `${ctx.subscriptionName} renews tomorrow on ${renewalLabel}. This is your last reminder before the charge.`,
        urgency: "warning",
      };
    default:
      return {
        subject: `${ctx.subscriptionName} renewal reminder`,
        headline: "Subscription renewal reminder",
        body: `${ctx.subscriptionName} renews on ${renewalLabel}.`,
        urgency: "info",
      };
  }
}

const urgencyColors: Record<ReminderCopy["urgency"], string> = {
  info: "#2563eb",
  warning: "#d97706",
  critical: "#dc2626",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReminderEmail(ctx: ReminderEmailContext): {
  subject: string;
  text: string;
  html: string;
} {
  const copy = getReminderCopy(ctx);
  const greeting = ctx.userName.trim() ? `Hi ${ctx.userName},` : "Hi,";
  const priceLine =
    ctx.price != null && ctx.currency
      ? `\nAmount: ${formatPrice(ctx.price, ctx.currency)}`
      : "";
  const priceHtml =
    ctx.price != null && ctx.currency
      ? `<p style="margin:0 0 16px;color:#374151;"><strong>Amount:</strong> ${escapeHtml(formatPrice(ctx.price, ctx.currency))}</p>`
      : "";

  const text = [
    greeting,
    "",
    copy.headline,
    "",
    copy.body,
    priceLine,
    "",
    `Renewal date: ${formatRenewalDate(ctx.renewalDate)}`,
    "",
    "— Subscription Tracker",
  ]
    .filter(Boolean)
    .join("\n");

  const accent = urgencyColors[copy.urgency];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:${accent};height:6px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;">
              <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Subscription Tracker</p>
              <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#111827;">${escapeHtml(copy.headline)}</h1>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151;">${escapeHtml(greeting)}</p>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151;">${escapeHtml(copy.body)}</p>
              ${priceHtml}
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;"><strong>Renewal date:</strong> ${escapeHtml(formatRenewalDate(ctx.renewalDate))}</p>
              <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">Manage your subscriptions in Subscription Tracker.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">You received this email because you track ${escapeHtml(ctx.subscriptionName)} in Subscription Tracker.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: copy.subject, text, html };
}
