import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

export type SmtpEnv = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** Read SMTP settings from env (throws if required vars are missing). */
export function getSmtpEnv(): SmtpEnv {
  const host = optionalTrimmed(process.env.SMTP_HOST);
  const user = optionalTrimmed(process.env.SMTP_USER);
  const pass = optionalTrimmed(process.env.SMTP_PASS);
  const from = optionalTrimmed(process.env.EMAIL_FROM);

  if (!host || !user || !pass || !from) {
    throw new Error(
      "SMTP_HOST, SMTP_USER, SMTP_PASS, and EMAIL_FROM are required for email delivery",
    );
  }

  const portRaw = optionalTrimmed(process.env.SMTP_PORT) ?? "587";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a positive number");
  }

  const secure =
    optionalTrimmed(process.env.SMTP_SECURE)?.toLowerCase() === "true" ||
    port === 465;

  return { host, port, secure, user, pass, from };
}

/** True when the minimum SMTP env vars are present. */
export function isEmailConfigured(): boolean {
  try {
    getSmtpEnv();
    return true;
  } catch {
    return false;
  }
}

let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | undefined;

/** Singleton Nodemailer transporter for the app. */
export function getMailTransporter(): nodemailer.Transporter<SMTPTransport.SentMessageInfo> {
  if (!transporter) {
    const { host, port, secure, user, pass } = getSmtpEnv();
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }
  return transporter;
}

/** Default `From` header for outbound mail. */
export function getEmailFromAddress(): string {
  return getSmtpEnv().from;
}
