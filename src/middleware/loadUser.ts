import type { RequestHandler } from "express";
import { User } from "../models/User.js";

export const loadAuthenticatedUser: RequestHandler = async (req, res, next) => {
  if (!req.user?.id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = await User.findById(req.user.id);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  req.currentUser = user;
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.currentUser?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
};
