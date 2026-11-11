import { z } from 'zod'

// E04.10: reusable conversation guides for an AI assistant connected to Confluent (MCP). The same
// text is served as an MCP prompt, by the get_conversation_guide tool (clients without prompts) and
// to the site, to be copied into any assistant. Each account sees only the guides it can follow.
export const CONVERSATION_GUIDE_IDS = ['fill_dossier', 'design_form'] as const

export const conversationGuideIdSchema = z.enum(CONVERSATION_GUIDE_IDS)

export type ConversationGuideId = z.infer<typeof conversationGuideIdSchema>

export const conversationGuideSchema = z.object({
  // Also the MCP prompt's name.
  id: conversationGuideIdSchema,
  title: z.string(),
  description: z.string(),
  // What to ask an assistant whose client does not offer MCP prompts.
  request: z.string(),
  // The guide itself, without a target dossier or form.
  text: z.string(),
})

export type ConversationGuide = z.infer<typeof conversationGuideSchema>
