import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { ACCESS_TOKEN_COOKIE_NAME } from "../accessAuthCookie.js";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required");
  }
  return secret;
}

function getJwtFromRequest(req: Parameters<RequestHandler>[0]): string | undefined {
  const header = req.headers.authorization;
  const bearer =
    header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (bearer.length > 0) return bearer;
  const fromCookie = req.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  return typeof fromCookie === "string" && fromCookie.length > 0 ? fromCookie : undefined;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  try {
    const token = getJwtFromRequest(req);
    if (!token) {
      res.status(401).json({
        error: "Missing bearer token or access cookie",
      });
      return;
    }
    const payload = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    const id =
      typeof payload.sub === "string"
        ? payload.sub
        : typeof payload.userId === "string"
          ? payload.userId
          : undefined;
    if (!id) {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }
    req.user = { id };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};
