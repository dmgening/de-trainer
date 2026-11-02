import { z } from 'zod';
import { AgentEventInput, BankSnapshot, ClientEvent, ContentPackage, RecommendationSet, SchedulerConfig } from '@de-trainer/core';

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

/**
 * JSON Schemas for Nomir, generated from the same Zod schemas the server validates with.
 * Cross-field rules (references, placeholders, revisions) are checked on publish and reported as issues.
 */
export const agentSchemas = {
  package: json(ContentPackage),
  recommendations: json(RecommendationSet),
  'scheduler-config': json(SchedulerConfig),
  'agent-events': json(z.object({ events: z.array(AgentEventInput) })),
  'client-events': json(z.object({ events: z.array(ClientEvent) })),
  snapshot: json(BankSnapshot),
};
