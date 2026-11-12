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

// E06.09, E08.07: what a structure's entry keeps of a request made through MCP — the channel, the
// application and its authorization, never the person's words: those of a conseiller or a manager
// stay in the call's own entry (`mcp_tool_called`, attached to the workspace), so that an entry of a
// request's journal never holds the structure's words, nor one about a participation request a
// name or an address the person may have typed.
export function channelMetadata(origin: ActionOrigin): Record<string, string> {
  if (origin.channel === 'site') return { channel: 'site' }
  const { channel, clientId, clientName, grantId } = origin
  return { channel, clientId, clientName, grantId }
}
