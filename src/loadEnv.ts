import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const envPath = path.join(projectRoot, ".env");
const localEnvPath = path.join(projectRoot, ".env.local");

dotenv.config({ path: envPath });

if (existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: true });
  console.info("[Env] Loaded .env.local (overrides .env)");
}
