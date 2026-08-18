import { z } from "zod";

import { isoTimestampSchema, SCHEMA_VERSION } from "../project-store/schemas.ts";
import {
  renderAndCompareInputSchema,
  renderAndCompareOutputSchema,
} from "../tools/contracts.ts";
import { VALIDATION_BASELINE } from "./baseline.ts";

export const runIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/);

export const validationRecordSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: runIdSchema,
    projectId: z.string().min(1).max(64),
    designBundleRevision: z.number().int().positive(),
    uiSpecRevision: z.number().int().positive(),
    createdAt: isoTimestampSchema,
    input: renderAndCompareInputSchema,
    runtime: z
      .object({
        policyVersion: z.literal(
          VALIDATION_BASELINE.policyVersion,
        ),
        chromiumVersion: z.string().min(1).max(256),
        maxComparePixels: z.literal(
          VALIDATION_BASELINE.maxComparePixels,
        ),
        maxChannelDelta: z.literal(
          VALIDATION_BASELINE.maxChannelDelta,
        ),
        colorScheme: z.literal(
          VALIDATION_BASELINE.colorScheme,
        ),
        reducedMotion: z.literal(
          VALIDATION_BASELINE.reducedMotion,
        ),
        locale: z.literal(VALIDATION_BASELINE.locale),
        timezoneId: z.literal(
          VALIDATION_BASELINE.timezoneId,
        ),
        serviceWorkers: z.literal(
          VALIDATION_BASELINE.serviceWorkers,
        ),
        fontFamily: z.literal(
          VALIDATION_BASELINE.fontFamily,
        ),
        animationsDisabled: z.literal(true),
        diffAlgorithm: z.literal(
          VALIDATION_BASELINE.diffAlgorithm,
        ),
      })
      .strict(),
    output: renderAndCompareOutputSchema,
  })
  .strict();

export type ValidationRecord = z.infer<
  typeof validationRecordSchema
>;
