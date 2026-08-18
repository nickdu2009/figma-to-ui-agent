import { z } from "zod";

export const PROJECT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";

export const projectIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(new RegExp(PROJECT_ID_PATTERN));

export function parseProjectId(value: unknown): string {
  return projectIdSchema.parse(value);
}
