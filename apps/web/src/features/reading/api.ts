import type { ReadingHeartbeatResult } from '@confluent/shared'
import { apiRequest } from '@/lib/api-client'

// ROADMAP E07.08: the active time of a reading since the previous heartbeat — never a total; the API
// credits at most the time elapsed. `keepalive`: sent while the page closes.
export function sendReadingHeartbeat(
  sessionId: string,
  activeMs: number,
  keepalive = false,
): Promise<ReadingHeartbeatResult> {
  return apiRequest<ReadingHeartbeatResult>(
    `/v1/reading-sessions/${encodeURIComponent(sessionId)}/heartbeat`,
    { method: 'POST', body: JSON.stringify({ activeMs }), keepalive },
  )
}
