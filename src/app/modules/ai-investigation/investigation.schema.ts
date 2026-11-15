import { z } from 'zod';

// ── Request body ──────────────────────────────────────────────────────────────

export const investigateRequestSchema = z.object({
  /**
   * The question the operations user wants answered about this shipment.
   * Capped at 500 characters to bound token usage and prevent prompt injection
   * via excessively long user input.
   *
   * Example: "Why is this shipment considered high risk?"
   */
  question: z
    .string()
    .min(3, 'Question must be at least 3 characters.')
    .max(500, 'Question must be 500 characters or fewer.')
    .trim(),
});

export type InvestigateRequest = z.infer<typeof investigateRequestSchema>;

// ── Structured AI output schema ────────────────────────────────────────────────
//
// This schema is passed to zodResponseFormat() — the OpenAI SDK converts it to
// a strict JSON Schema and enforces it at decode time (constrained generation).
// The model CANNOT produce a response that does not match this schema.
//
// IMPORTANT Zod v4 + OpenAI structured outputs constraints:
//  - Root must be an object (no root unions).
//  - Optional fields are expressed as .nullable() on required fields.
//  - Arrays of objects must have all properties required or nullable.

const EvidenceItemSchema = z.object({
  fact:   z.string().describe('A single verified fact drawn directly from the shipment data.'),
  source: z.string().describe('Where this fact comes from, e.g. "Tracking event at 2026-11-10T08:00Z" or "DeliveryAttempt #2".'),
});

const FindingSchema = z.object({
  title:    z.string().describe('Short title for this finding, e.g. "Extended inactivity at origin hub".'),
  detail:   z.string().describe('Full explanation of the finding based solely on supplied evidence.'),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).describe('Operational severity of this finding.'),
  evidence: z.array(EvidenceItemSchema).describe('The specific data points that support this finding.'),
});

const TrackingEventSummarySchema = z.object({
  timestamp:   z.string().describe('ISO 8601 timestamp of the event.'),
  status:      z.string().describe('Shipment status at this event.'),
  description: z.string().describe('Event description from the tracking log.'),
  significance: z.string().describe('Why this event is relevant to the investigation.'),
});

const RecommendedActionSchema = z.object({
  action:   z.string().describe('Specific, actionable step for the operations team.'),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Priority of this action.'),
  rationale: z.string().describe('Why this action is recommended based on the evidence.'),
});

export const InvestigationResponseSchema = z.object({
  /**
   * One or two sentence direct answer to the user's question.
   * Must be based only on the supplied shipment data.
   */
  answer: z.string().describe('Direct answer to the user\'s investigation question, grounded in the supplied data.'),

  /**
   * Overall operational assessment of the shipment's current situation.
   */
  overallAssessment: z.string().describe('Overall assessment of the shipment\'s operational state.'),

  /**
   * The official risk score from the Day-1 deterministic engine.
   * The AI must NEVER change this value — it is supplied in the context
   * and must be reproduced exactly.
   */
  officialRiskScore: z.number().int().min(0).max(100)
    .describe('The official risk score from the deterministic risk engine. Must match the supplied value exactly.'),

  officialRiskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH'])
    .describe('The official risk level. Must match the supplied value exactly.'),

  /**
   * Key findings derived from analysis of the shipment data.
   * Maximum 5 findings to keep the report concise.
   */
  findings: z.array(FindingSchema).max(5)
    .describe('Key findings from the investigation, each backed by specific evidence.'),

  /**
   * The most operationally relevant tracking events that explain the situation.
   * Subset of the full history — only events that matter for this investigation.
   */
  relevantTrackingEvents: z.array(TrackingEventSummarySchema).max(8)
    .describe('Tracking events most relevant to this investigation.'),

  /**
   * Concrete, prioritised actions for the operations team.
   */
  recommendedActions: z.array(RecommendedActionSchema).max(5)
    .describe('Prioritised action recommendations for the operations team.'),

  /**
   * Honest statement of what data was missing or insufficient.
   * Empty string if all needed data was available.
   */
  dataLimitations: z.string()
    .describe('Description of any missing or insufficient data that limited the investigation. Empty string if none.'),
});

export type InvestigationResponse = z.infer<typeof InvestigationResponseSchema>;

// Role type for this module — same set as risk module
export type InvestigationRole = 'OPERATIONS_MANAGER' | 'ADMIN' | 'HUB_MANAGER';
