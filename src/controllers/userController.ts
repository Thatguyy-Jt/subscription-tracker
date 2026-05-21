import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import mongoose, { type HydratedDocument } from "mongoose";
import { z } from "zod";
import type { UserDoc } from "../models/User.js";
import { User } from "../models/User.js";

function publicUser(doc: HydratedDocument<UserDoc> | null | undefined) {
  if (!doc) return null;
  return {
    id: doc.id,
    name: doc.name,
    email: doc.email,
    role: doc.role,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const createBody = z.object({
  name: z.string().trim().min(2).max(50),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  role: z.enum(["user", "admin"]).optional(),
});

const updateBody = z
  .object({
    name: z.string().trim().min(2).max(50).optional(),
    email: z.string().email().max(254).optional(),
    password: z.string().min(8).max(128).optional(),
    role: z.enum(["user", "admin"]).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.email !== undefined ||
      v.password !== undefined ||
      v.role !== undefined,
    {
      message: "At least one of name, email, password, or role must be provided",
    },
  );

export function getMe(req: Request, res: Response): void {
  const json = publicUser(req.currentUser);
  if (!json) {
    res.status(404).json({
      error: "User not found",
      message: "Your account record could not be loaded from the database.",
    });
    return;
  }
  res.json({
    message: "Current user profile retrieved successfully.",
    ...json,
  });
}

export async function listUsers(_req: Request, res: Response): Promise<void> {
  const users = await User.find().sort({ createdAt: -1 }).exec();
  res.json({
    message: "User list retrieved successfully.",
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    })),
  });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      message:
        "Invalid user payload. Name must be 2–50 characters; email must be valid (max 254); password must be 8–128; optional role: user or admin.",
      details: parsed.error.flatten(),
    });
    return;
  }
  const { name, email, password, role } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await User.create({
      name,
      email,
      passwordHash,
      ...(role ? { role } : {}),
    });
    res.status(201).json({
      message: "User created successfully.",
      user: publicUser(user)!,
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
        message: "Another user already uses this email address.",
      });
      return;
    }
    throw err;
  }
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({
      error: "Invalid user id",
      message: "The user id in the URL is not a valid MongoDB ObjectId.",
    });
    return;
  }
  const admin = req.currentUser!.role === "admin";
  if (!admin && id !== req.user!.id) {
    res.status(403).json({
      error: "Forbidden",
      message: "You can only view your own profile unless you are an admin.",
    });
    return;
  }
  const user = await User.findById(id);
  if (!user) {
    res.status(404).json({
      error: "User not found",
      message: "No user exists with this id.",
    });
    return;
  }
  res.json({
    message: "User retrieved successfully.",
    user: publicUser(user)!,
  });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({
      error: "Invalid user id",
      message: "The user id in the URL is not a valid MongoDB ObjectId.",
    });
    return;
  }
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Validation failed",
      message:
        "Update failed: provide at least one of name, email, password, or role (admins only may set role). Fields must meet format rules when present.",
      details: parsed.error.flatten(),
    });
    return;
  }
  const admin = req.currentUser!.role === "admin";
  if (!admin && id !== req.user!.id) {
    res.status(403).json({
      error: "Forbidden",
      message: "You can only update your own profile unless you are an admin.",
    });
    return;
  }
  if (!admin && parsed.data.role !== undefined) {
    res.status(403).json({
      error: "Cannot change role",
      message: "Only administrators can change user roles.",
    });
    return;
  }

  let { name, email, password, role } = parsed.data;
  if (!admin) {
    role = undefined;
  }

  if (name === undefined && email === undefined && password === undefined && role === undefined) {
    res.status(400).json({
      error: "No permitted fields to update",
      message:
        "After permission checks, nothing remains to update. Try including name, email, password, or role (admin).",
    });
    return;
  }

  const existing = await User.findById(id);
  if (!existing) {
    res.status(404).json({
      error: "User not found",
      message: "No user exists with this id.",
    });
    return;
  }

  if (name !== undefined) {
    existing.name = name;
  }
  if (email !== undefined && email !== existing.email) {
    existing.email = email;
  }
  if (password !== undefined) {
    existing.passwordHash = await bcrypt.hash(password, 12);
  }
  if (role !== undefined && admin) {
    existing.role = role;
  }

  try {
    await existing.save();
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: number }).code === 11000
    ) {
      res.status(409).json({
        error: "Email already in use",
        message: "Another account already uses this email address.",
      });
      return;
    }
    throw err;
  }

  res.json({
    message: "User updated successfully.",
    user: publicUser(existing)!,
  });
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({
      error: "Invalid user id",
      message: "The user id in the URL is not a valid MongoDB ObjectId.",
    });
    return;
  }
  const admin = req.currentUser!.role === "admin";
  if (!admin && id !== req.user!.id) {
    res.status(403).json({
      error: "Forbidden",
      message: "You can only delete your own account unless you are an admin.",
    });
    return;
  }
  const deleted = await User.findByIdAndDelete(id);
  if (!deleted) {
    res.status(404).json({
      error: "User not found",
      message: "No user exists with this id.",
    });
    return;
  }
  res.status(200).json({ message: "User deleted successfully." });
}
