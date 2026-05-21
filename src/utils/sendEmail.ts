import {
  getEmailFromAddress,
  getMailTransporter,
  isEmailConfigured,
} from "../config/nodemailer.js";
import {
  buildReminderEmail,
  type ReminderEmailContext,
} from "../templates/emailTemplate.js";

export type SendEmailOptions = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendEmailResult =
  | { sent: true; channel: "email"; messageId: string }
  | { sent: false; channel: "email"; error: string };

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    return {
      sent: false,
      channel: "email",
      error: "email_not_configured",
    };
  }

  try {
    const info = await getMailTransporter().sendMail({
      from: getEmailFromAddress(),
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    return {
      sent: true,
      channel: "email",
      messageId: info.messageId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_send_error";
    console.error("[Email] send failed:", message);
    return {
      sent: false,
      channel: "email",
      error: message,
    };
  }
}

export async function sendReminderEmail(
  to: string,
  context: ReminderEmailContext,
): Promise<SendEmailResult> {
  const { subject, text, html } = buildReminderEmail(context);
  return sendEmail({ to, subject, text, html });
}
