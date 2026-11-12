import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

// What a page focuses on its own (a field to fill in, a heading it moves to): kept as it is.
const OWN_FOCUS = 'input, textarea, select, h1, h2, [tabindex="-1"], [contenteditable="true"]'

// ROADMAP E10.07: after a change of page inside the shell, the keyboard and the screen reader start
// from the new page's heading (else its main region) instead of the link left behind, which is
// usually gone. Not on the first load (the browser starts at the top), not when only the query
// changes (a tab), never over a field or heading the page focused itself.
export function useRouteFocus(mainId: string) {
  const { pathname } = useLocation()
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    // After the page's own effects and its first paint.
    const frame = requestAnimationFrame(() => {
      const main = document.getElementById(mainId)
      if (!main) return
      const active = document.activeElement
      if (active && active !== main && main.contains(active) && active.matches(OWN_FOCUS)) return
      const heading = main.querySelector<HTMLElement>('h1')
      const target = heading ?? main
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: false })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname, mainId])
}
