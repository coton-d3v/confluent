// The id of a dossier section's heading, the target of its link in the table of contents (E10.07).
export function sectionAnchor(sectionId: string): string {
  return `section-${sectionId}`
}
