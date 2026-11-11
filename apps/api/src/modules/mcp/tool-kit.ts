import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// A refusal or a problem worded for the assistant, passed on as is (in French).
export class ToolError extends Error {}

// The dossier, form or document a tool call is about, journaled with the call (E01.07).
export interface ToolTrace {
  dossierId: string | null
  documentId?: string
  formId?: string
}

// Runs a tool body: its result as JSON, a ToolError as its message, and one journal entry per call.
export type ToolRunner = (
  tool: string,
  target: string | null,
  fn: (trace: ToolTrace) => Promise<Record<string, unknown>>,
) => Promise<CallToolResult>

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Same name whatever the case and accents (« biosensio » = « Biosensio »).
export function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'fr', { sensitivity: 'base' }) === 0
}
