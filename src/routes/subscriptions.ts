import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createSubscription,
  deleteSubscription,
  getSubscriptionById,
  listSubscriptions,
  updateSubscription,
} from "../controllers/subscriptionController.js";

const router = Router();
router.use(requireAuth);

router.get("/", listSubscriptions);
router.post("/", createSubscription);
router.get("/:id", getSubscriptionById);
router.patch("/:id", updateSubscription);
router.delete("/:id", deleteSubscription);

export default router;
