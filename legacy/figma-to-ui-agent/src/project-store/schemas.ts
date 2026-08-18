import { posix } from "node:path";

import { z } from "zod";

import { projectIdSchema } from "./project-id.ts";

export const SCHEMA_VERSION = "1" as const;
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const isoTimestampSchema = z.string().datetime({ offset: true });

export const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes("\\"), "路径不能包含反斜杠")
  .refine((value) => !posix.isAbsolute(value), "路径不能是绝对路径")
  .refine(
    (value) =>
      value.split("/").every((segment) => segment !== "." && segment !== ".."),
    "路径不能包含点目录",
  )
  .refine(
    (value) => posix.normalize(value) === value,
    "路径必须已经规范化",
  );

export const projectMetadataSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    createdAt: isoTimestampSchema,
  })
  .strict();

export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;
