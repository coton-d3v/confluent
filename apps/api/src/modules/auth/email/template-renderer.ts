import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locale } from './email-transport'

const TEMPLATES_DIR = join(__dirname, 'templates')

export type TemplateName =
  | 'magic-link'
  | 'share-invite'
  | 'workspace-invite'
  | 'company-transfer-invite'
  | 'participation-accepted'
  | 'committee-changed'

export interface TemplateDynamicVars {
  'magic-link': { magicLinkUrl: string }
  'share-invite': { dossierName: string; shareUrl: string }
  'workspace-invite': { workspaceName: string; roleLabel: string; signInUrl: string }
  'company-transfer-invite': {
    companyName: string
    workspaceName: string
    fromLabel: string
    expiresOn: string
    accountLine: string
    invitationsUrl: string
  }
  'participation-accepted': {
    workspaceName: string
    sessions: string
    accountLine: string
    signInUrl: string
  }
  'committee-changed': {
    title: string
    body: string
    workspaceName: string
    committeeName: string
    when: string
    audienceLine: string
    signInUrl: string
  }
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const htmlCache = new Map<TemplateName, string>()
const txtCache = new Map<TemplateName, string>()
const i18nCache = new Map<Locale, Record<string, Record<string, string>>>()

function loadHtml(name: TemplateName): string {
  let raw = htmlCache.get(name)
  if (raw === undefined) {
    raw = readFileSync(join(TEMPLATES_DIR, `${name}.html`), 'utf8')
    htmlCache.set(name, raw)
  }
  return raw
}

function loadTxt(name: TemplateName): string {
  let raw = txtCache.get(name)
  if (raw === undefined) {
    raw = readFileSync(join(TEMPLATES_DIR, `${name}.txt`), 'utf8')
    txtCache.set(name, raw)
  }
  return raw
}

function loadI18n(locale: Locale): Record<string, Record<string, string>> {
  let dict = i18nCache.get(locale)
  if (dict === undefined) {
    const raw = readFileSync(join(TEMPLATES_DIR, 'i18n', `${locale}.json`), 'utf8')
    dict = JSON.parse(raw) as Record<string, Record<string, string>>
    i18nCache.set(locale, dict)
  }
  return dict
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return c
    }
  })
}

function substitute(raw: string, vars: Record<string, string>, htmlEscape: boolean): string {
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Missing email template variable: {{${key}}}`)
    }
    const value = vars[key]!
    return htmlEscape ? escapeHtml(value) : value
  })
}

export function render<T extends TemplateName>(
  name: T,
  locale: Locale,
  dynamicVars: TemplateDynamicVars[T],
): RenderedEmail {
  const strings = loadI18n(locale)[name]
  if (!strings) {
    throw new Error(`Missing i18n block for template "${name}" in locale "${locale}"`)
  }
  const subject = strings.subject
  if (!subject) {
    throw new Error(`Missing "subject" in i18n[${locale}][${name}]`)
  }
  const allVars: Record<string, string> = {
    ...strings,
    ...(dynamicVars as Record<string, string>),
  }
  const html = substitute(loadHtml(name), allVars, true)
  const text = substitute(loadTxt(name), allVars, false)
  return { subject, html, text }
}

// One string of a template's i18n block, for a sentence chosen by the sender.
export function templateString(name: TemplateName, locale: Locale, key: string): string {
  const value = loadI18n(locale)[name]?.[key]
  if (value === undefined) throw new Error(`Missing "${key}" in i18n[${locale}][${name}]`)
  return value
}

export function clearCacheForTesting(): void {
  htmlCache.clear()
  txtCache.clear()
  i18nCache.clear()
}
