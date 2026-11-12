// ROADMAP E07.08: how measured times and consultation dates read in French.

// « 42 s », « 4 min 05 s », « 1 h 07 min »; « — » when nothing is measured.
export function formatActiveTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${(s % 60).toString().padStart(2, '0')} s`
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, '0')} min`
}

// « 12 nov. 2026 à 14:02 ».
export function formatConsultedAt(iso: string): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${day} à ${time}`
}
