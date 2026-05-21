import type { HydratedDocument } from "mongoose";
import type { UserDoc } from "../models/User.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string };
      currentUser?: HydratedDocument<UserDoc>;
    }
  }
}
export {};
