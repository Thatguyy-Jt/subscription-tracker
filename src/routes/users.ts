import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  loadAuthenticatedUser,
  requireAdmin,
} from "../middleware/loadUser.js";
import {
  createUser,
  deleteUser,
  getMe,
  getUserById,
  listUsers,
  updateUser,
} from "../controllers/userController.js";

const router = Router();
router.use(requireAuth);
router.use(loadAuthenticatedUser);

router.get("/me", getMe);
router.get("/", requireAdmin, listUsers);
router.post("/", requireAdmin, createUser);
router.get("/:id", getUserById);
router.patch("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
