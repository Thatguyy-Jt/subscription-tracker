import "dotenv/config";

import type { RequestHandler } from "express";

import arcjet, { createRemoteClient, slidingWindow } from "@arcjet/node";

function arcjetApiKey(): string {
  const key = process.env.ARCJET_KEY;
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("ARCJET_KEY is required for rate limiting middleware");
  }
  return key.trim();
}

/** Max requests per client IP per window (Arcjet sliding window). Override via ARCJET_RATE_LIMIT_MAX */
const slidingMax = (): number => {
  const raw = process.env.ARCJET_RATE_LIMIT_MAX;
  if (!raw?.trim()) return 200;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 200;
  return Math.min(Math.floor(n), 4_294_967_295);
};

const decideTimeoutMs = (): number => {
  const raw = process.env.ARCJET_TIMEOUT_MS;
  if (!raw?.trim()) return 3000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 500) return 3000;
  return Math.min(Math.floor(n), 60_000);
};

/**
 * Sliding-window rate limit by client IP (`ip.src`).
 * Instantiate once — Arcjet expects a reused client across requests.
 */
const arcjetEffectiveMax = slidingMax();

const aj = arcjet({
  key: arcjetApiKey(),
  client: createRemoteClient({ timeout: decideTimeoutMs() }),
  characteristics: ["ip.src"],
  rules: [
    slidingWindow({
      mode: "LIVE",
      interval: "1m",
      max: arcjetEffectiveMax,
    }),
  ],
});

const arcjetTrace = process.env.ARCJET_TRACE === "1" || process.env.ARCJET_TRACE === "true";

console.info(
  `[Arcjet] Sliding rate limit on: max ${arcjetEffectiveMax} requests per client IP per 1m window. ` +
    "The next request after the budget is exhausted returns 429 (with max=5, send ~8+ quick hits). " +
    "Prefer http://127.0.0.1 — `localhost` can mix ::1 and 127.0.0.1 as separate buckets. " +
    "Set ARCJET_TRACE=1 to log every decision.",
);

function isArcjetRateLimitDeny(decision: Awaited<ReturnType<(typeof aj)["protect"]>>): boolean {
  if (decision.isDenied() && decision.reason.isRateLimit()) {
    return true;
  }
  return decision.results.some(
    (r) => r.isDenied() && typeof r.reason?.isRateLimit === "function" && r.reason.isRateLimit(),
  );
}

function attachArcjetRateLimitHeaders(
  res: Parameters<RequestHandler>[1],
  decision: Awaited<ReturnType<(typeof aj)["protect"]>>,
): void {
  const reason = decision.reason;
  if (
    typeof reason === "object" &&
    reason !== null &&
    typeof reason.isRateLimit === "function" &&
    reason.isRateLimit() &&
    "max" in reason &&
    typeof (reason as { max?: unknown }).max === "number" &&
    "remaining" in reason &&
    typeof (reason as { remaining?: unknown }).remaining === "number"
  ) {
    const rl = reason as { max: number; remaining: number; reset?: number };
    res.setHeader("X-RateLimit-Limit", String(rl.max));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    if (typeof rl.reset === "number") {
      res.setHeader("X-RateLimit-Reset", String(rl.reset));
    }
  }
}

function decisionTraceLine(
  req: Parameters<RequestHandler>[0],
  decision: Awaited<ReturnType<(typeof aj)["protect"]>>,
): string {
  const path = req.originalUrl ?? req.url ?? "";
  const sock = req.socket?.remoteAddress ?? "?";
  const conclusion = "conclusion" in decision ? String((decision as { conclusion: string }).conclusion) : "?";
  const rem =
    typeof decision.reason === "object" &&
    decision.reason !== null &&
    "remaining" in decision.reason &&
    typeof (decision.reason as { remaining?: unknown }).remaining === "number"
      ? (decision.reason as { remaining: number }).remaining
      : "—";
  return `${req.method} ${path} conclusion=${conclusion} denied=${decision.isDenied()} error=${decision.isErrored()} remaining=${rem} socket=${sock}`;
}

/** Run Arcjet once per incoming request before route handlers */
export const arcjetRateLimit: RequestHandler = async (req, res, next) => {
  const decision = await aj.protect(req);

  if (!decision.isErrored()) {
    attachArcjetRateLimitHeaders(res, decision);
  }

  if (arcjetTrace) {
    console.info("[Arcjet trace]", decisionTraceLine(req, decision));
  }

  if (decision.isErrored()) {
    console.error("[Arcjet] rate limit check errored:", decision.reason.message);
    next();
    return;
  }

  if (isArcjetRateLimitDeny(decision)) {
    const resetSec =
      typeof decision.reason === "object" &&
      decision.reason !== null &&
      "reset" in decision.reason &&
      typeof (decision.reason as { reset?: unknown }).reset === "number"
        ? (decision.reason as { reset: number }).reset
        : undefined;
    if (typeof resetSec === "number" && resetSec > 0 && Number.isFinite(resetSec)) {
      res.setHeader("Retry-After", String(Math.ceil(resetSec)));
    }
    console.warn("[Arcjet] 429", decisionTraceLine(req, decision));
    res.status(429).json({
      error: "Too many requests",
      message: "You have exceeded the request rate limit. Try again shortly.",
    });
    return;
  }

  if (decision.isDenied()) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  next();
};
