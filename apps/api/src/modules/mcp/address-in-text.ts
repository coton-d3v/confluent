// Characters an address may continue with: before it, those of a local part (or another `@`);
// after it, those of a domain — a letter, a digit, a hyphen, or a dot followed by one of them.
const BEFORE = /[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.@-]/u
const AFTER = /^(?:[\p{L}\p{N}-]|\.[\p{L}\p{N}-])/u

// Whether `text` names `email` as a whole address, case aside: `eve@fonds.fr` is named by « avec
// EVE@fonds.fr. » or « <eve@fonds.fr> », not by `steve@fonds.fr` nor `eve@fonds.fr.example.com`
// (code review R64: a substring test let an address hidden in another one through).
export function namesAddress(text: string, email: string): boolean {
  const haystack = text.toLowerCase()
  const needle = email.trim().toLowerCase()
  if (needle === '') return false
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack.slice(Math.max(0, at - 2), at)
    const after = haystack.slice(at + needle.length)
    if (!BEFORE.test(before.at(-1) ?? '') && !AFTER.test(after)) return true
  }
  return false
}
