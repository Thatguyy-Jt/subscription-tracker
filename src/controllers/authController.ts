import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  accessAuthCookieClearOpts,
  accessAuthCookieOpts,
} from "../accessAuthCookie.js";
import { User } from "../models/User.js";

const registerBody = z.object({
  name: z.string().trim().min(2).max(50),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
}

function signToken(userId: string): string {
  const expiresIn = (process.env.JWT_EXPIRES_IN ?? "7d") as NonNullable<
    SignOptions["expiresIn"]
  >;
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn });
}

function attachAccessCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, token, accessAuthCookieOpts());
}

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      message:
        "Registration payload is invalid. Name (display username) must be 2–50 characters; email must be valid (max 254); password must be 8–128 characters.",
      details: parsed.error.flatten(),
    });
    return;
  }
  const { name, email, password } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await User.create({ name, email, passwordHash });
    const token = signToken(user.id);
    attachAccessCookie(res, token);
    res.status(201).json({
      message: "Account registered successfully.",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      res.status(409).json({
        error: "Email already registered",
        message: "An account with this email already exists. Try logging in instead.",
      });
      return;
    }
    throw err;
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      message: "Login payload is invalid. Provide a valid email and password.",
      details: parsed.error.flatten(),
    });
    return;
  }
  const { email, password } = parsed.data;

  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user?.passwordHash) {
    res.status(401).json({
      error: "Invalid email or password",
      message: "No matching account found or credentials are incorrect.",
    });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({
      error: "Invalid email or password",
      message: "No matching account found or credentials are incorrect.",
    });
    return;
  }
  const token = signToken(user.id);
  attachAccessCookie(res, token);
  res.json({
    message: "Signed in successfully.",
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}

/**
 * Clears the JWT HTTP-only cookie. Clients that store `token` from JSON responses should drop it locally too.
 */
export function logout(_req: Request, res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, accessAuthCookieClearOpts());
  res.status(200).json({
    message:
      "Logged out successfully. Session cookie cleared—also discard any Bearer token your client saved from login/register.",
  });
}
