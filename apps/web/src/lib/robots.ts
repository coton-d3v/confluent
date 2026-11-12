import { useLayoutEffect } from 'react'
import { ROBOTS_CLOSED, type RobotsDirective } from '@confluent/shared'

// ROADMAP E09.06: the document's one `<meta name="robots">`. index.html holds it closed for every page
// before any script runs. The HTML served at a workspace's public page address (`public-page.html`,
// nginx.conf) has none — a search engine that reads `noindex` there would never run the page — so
// this module decides there: closed as soon as the application starts (main.tsx), opened only by a
// public page allowed to be indexed (@confluent/shared `publicPageRobots`), closed again when left.
function robotsMeta(): HTMLMetaElement {
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'robots'
    document.head.prepend(meta)
  }
  return meta
}

export function setRobots(directive: RobotsDirective): void {
  robotsMeta().content = directive
}

// What the page being shown tells search engines, closed again once it is left.
export function useRobots(directive: RobotsDirective): void {
  useLayoutEffect(() => {
    setRobots(directive)
    return () => setRobots(ROBOTS_CLOSED)
  }, [directive])
}
