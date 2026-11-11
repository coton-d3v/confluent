import type { SupportProgress } from '@confluent/shared'

// ROADMAP E06.07: the progress of a candidature in its support path, in words.
// « 1 étape validée sur 3 · étape en cours : Business plan »; nothing to count without a path.
export function progressText(progress: SupportProgress): string | null {
  if (progress.phase === 'no_path') return null
  const { validatedSteps: n, totalSteps: total } = progress
  const counted = `${n} étape${n > 1 ? 's' : ''} validée${n > 1 ? 's' : ''} sur ${total}`
  return progress.currentStep
    ? `${counted} · étape en cours : ${progress.currentStep.label}`
    : counted
}
