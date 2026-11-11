// Through which channel a person asked for a consequential action — submitting a dossier,
// publishing a form (E04.08) — journaled with the action itself. In the site, the person clicked;
// through MCP, an AI application acted on the instruction the person gave it in the conversation,
// as the application reports it: Confluent cannot verify a conversation, it records what was
// declared, by which application and under which authorization.
export type ActionOrigin =
  | { channel: 'site' }
  | {
      channel: 'mcp'
      clientId: string
      clientName: string
      grantId: string
      instruction: string
    }

export const SITE_ORIGIN: ActionOrigin = { channel: 'site' }

export function originMetadata(origin: ActionOrigin): Record<string, string> {
  if (origin.channel === 'site') return { channel: 'site' }
  const { channel, clientId, clientName, grantId, instruction } = origin
  return { channel, clientId, clientName, grantId, instruction }
}
