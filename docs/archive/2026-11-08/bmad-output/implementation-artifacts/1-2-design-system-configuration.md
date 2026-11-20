# Story 1.2: Design System Configuration

Status: done

## Story

As a developer,
I want shadcn/ui initialized with Confluent's Notion-inspired design tokens,
so that all UI components use the correct palette, typography, and spacing from the very first component built.

## Acceptance Criteria

1. **Given** `apps/web/src/index.css` (or `globals.css`), **When** the app loads in the browser, **Then** the following CSS variables are defined and applied globally:
   - `--background: #FAFAF9` (page base)
   - `--card: #FFFFFF`
   - `--foreground: #1A1A1A`
   - `--muted-foreground: #6B6B6B`
   - `--border: #E8E8E7`
   - `--primary: #37352F`
   - `--radius: 6px`

2. **Given** shadcn/ui CLI is initialized in `apps/web`, **When** `npx shadcn add button input card sheet sonner separator badge avatar label` is run, **Then** all components are added to `apps/web/src/components/ui/` with no errors. *(Note: `sonner` replaces deprecated `toast` per shadcn guidance.)*

3. **Given** a primary Button is rendered, **When** a user views it at rest, **Then** background is `#37352F` and text is white.

4. **Given** a primary Button is rendered, **When** a user hovers over it, **Then** background darkens to `#1A1A1A` with no hue shift and no color transition.

5. **Given** the `index.html` of `apps/web`, **When** the page loads, **Then** Inter is loaded (via bundled `@fontsource-variable/inter` for self-hosted support) and applied as the default `font-family` across the entire app.

6. **Given** a Card component rendered on the base page background, **When** a developer inspects it, **Then** the card shows `background: #FFFFFF`, `border: 1px solid #E8E8E7`, `border-radius: 6px` on `background: #FAFAF9`.

7. **Given** Tailwind CSS v4 is configured, **When** `pnpm turbo run build` is run, **Then** only used CSS classes are included in the production bundle (no unused Tailwind output).

## Tasks / Subtasks

- [x] Task 1: Install Tailwind CSS v4 and configure (AC: 7)
  - [x] Install `tailwindcss` and `@tailwindcss/vite` as devDependencies in `apps/web`
  - [x] Add `@tailwindcss/vite` plugin to `vite.config.ts` (add to `plugins` array alongside `react()`)
  - [x] Replace contents of `apps/web/src/index.css` with Tailwind v4 `@import "tailwindcss"` directive
  - [x] Verify `pnpm turbo run build` succeeds with Tailwind v4 active

- [x] Task 2: Initialize shadcn/ui CLI v4 (AC: 2)
  - [x] Run `npx shadcn@latest init` in `apps/web` — base-nova style, CSS variables, `src/components/ui` component path
  - [x] Verify `components.json` is created at `apps/web/components.json`
  - [x] Run `npx shadcn add button input card sheet sonner separator badge avatar label` — all components in `apps/web/src/components/ui/` (sonner replaces deprecated toast)
  - [x] Verify `cn()` utility is created at `apps/web/src/lib/utils.ts`

- [x] Task 3: Apply Confluent design tokens to CSS variables (AC: 1, 6)
  - [x] Edit `apps/web/src/index.css` with all Confluent CSS variables (hex values)
  - [x] Add custom Confluent tokens: `--status-active`, `--status-neutral`, `--status-pending`
  - [x] Removed dark mode variables block — light-only for V1
  - [x] Deleted `App.css` (Vite scaffold defaults)

- [x] Task 4: Configure Inter font (AC: 5)
  - [x] Installed `@fontsource-variable/inter` (bundled font, better than Google Fonts CDN link)
  - [x] Set `--font-sans: 'Inter Variable', sans-serif` in CSS `@theme` block
  - [x] Removed `@fontsource-variable/geist` (shadcn default)

- [x] Task 5: Configure Button hover behavior (AC: 3, 4)
  - [x] Button default variant uses `bg-primary` (`#37352F`) for background
  - [x] Hover set to `hover:bg-foreground` (`#1A1A1A`) — no hue shift
  - [x] Removed `transition-all` from base button class — instant change, no animation
  - [x] Removed dark mode prefixes from all button variants

- [x] Task 6: Clean up Vite scaffold defaults (AC: 1, 7)
  - [x] Deleted `apps/web/src/App.css`
  - [x] Replaced `App.tsx` with token verification UI (Card, Button, Input, Badge with status dots)
  - [x] Removed `apps/web/src/assets/react.svg` and `apps/web/src/assets/vite.svg`
  - [x] Kept `apps/web/public/favicon.svg`

- [x] Task 7: Verify full pipeline (AC: 1, 2, 3, 4, 5, 6, 7)
  - [x] `pnpm turbo run typecheck` — 0 errors (fixed TS6 baseUrl deprecation)
  - [x] `pnpm turbo run build` — 0 errors, Tailwind tree-shakes unused classes
  - [x] `pnpm turbo run lint` — 0 errors, 2 warnings (shadcn variant exports — expected)
  - [ ] Visual verification in browser: background `#FAFAF9`, Card white with subtle border, Button `#37352F` → hover `#1A1A1A`, Inter font active

### Review Findings

#### Prior-run findings (status updated after 2026-04-14 second review)

- [x] [Review][Decision] Card border/radius mismatch with AC 6. **Resolved → D1.A** (fix card.tsx to `border border-border rounded-lg` — keep design-system coherence; user-confirmed after challenge). Converted to patch PD1.
- [x] [Review][Patch] Remove `next-themes` dependency and fix Sonner to not use `useTheme()` — still valid [package.json:84, sonner.tsx:1,4]
- [x] [Review][Patch] Add explicit `import * as React from 'react'` in Sonner — `React.CSSProperties` reference at [sonner.tsx:12](apps/web/src/components/ui/sonner.tsx)
- [x] [Review][Patch] Fix lint script `--ext` flag — **Resolved** in story 1-1 code review (2026-04-14). Script is now `eslint .`.
- [x] [Review][Patch] Move `shadcn` from dependencies to devDependencies [package.json:23]
- [x] [Review][Patch] Remove dead `dark:` prefixes from non-button shadcn components and `@custom-variant dark` from index.css [avatar.tsx, badge.tsx, input.tsx, index.css:6]
- [x] [Review][Defer] `"use client"` directives in label.tsx/separator.tsx — deferred, harmless shadcn CLI output
- [x] [Review][Defer] `allowedHosts` hardcoded in vite.config.ts — **Resolved** in story 1-1 code review (env-driven now).
- [x] [Review][Defer] `hero.png` + `icons.svg` scaffold leftovers — deferred, pre-existing from story 1.1
- [x] [Review][Defer] Chart tokens near-indistinguishable — deferred, design concern for later
- [x] [Review][Defer] `index.html` missing trailing newline — deferred, minor

#### New findings (2026-04-14 second review)

##### Decision Needed

- [x] [Review][Decision] AC 5 text vs implementation. **Resolved → D2.A** (update AC 5 wording to "Inter is loaded", drop the "Google Fonts" literal). Converted to patch PD2.
- [x] [Review][Decision] AC 2 text vs implementation. **Resolved → D3.A** (update AC 2 wording to replace `toast` with `sonner` — KISS, follow shadcn). Converted to patch PD3.

##### Patch

- [x] [Review][Patch] Broken `@import "shadcn/tailwind.css"` — the `shadcn` npm package has no `tailwind.css` file (verified: `node_modules/shadcn/` contains only `dist/`, `LICENSE.md`, `README.md`, `package.json`). The import silently no-ops. Remove it from [index.css:3](apps/web/src/index.css).
- [x] [Review][Patch] Separator component renders invisibly — `separator.tsx:17` uses `data-horizontal:*` / `data-vertical:*` Tailwind variants, but Base UI's Separator emits `data-orientation="horizontal|vertical"`. Fix to `data-[orientation=horizontal]:*` / `data-[orientation=vertical]:*` (or equivalent arbitrary-variant syntax).
- [x] [Review][Patch] `@apply` in `index.css` violates Anti-Patterns — spec forbids `@apply`; code uses three `@apply` directives in `@layer base` ([index.css:329,332,335]). Replace with raw CSS (`border-color: var(--border); outline-color: color-mix(...); background-color: var(--background); color: var(--foreground); font-family: var(--font-sans);`).
- [x] [Review][Patch] `components.json` declares `"hooks": "@/hooks"` alias — directory does not exist. Either create `apps/web/src/hooks/` or remove the alias to prevent future `shadcn add` confusion.
- [x] [Review][Patch] `vite.config.ts` `loadEnv(mode, process.cwd(), '')` — empty prefix loads ALL env vars (including secrets) into the Vite-visible surface. Restrict to `'VITE_'` prefix.
- [x] [Review][Patch] `vite.config.ts` `server.host: true` binds dev server to all interfaces by default. Gate behind `VITE_HOST` env var (default `'localhost'`) for safer local dev.
- [x] [Review][Patch] File List inaccuracy — spec lists `apps/web/eslint.config.js` as Modified, but the diff shows it created new. Also add `tw-animate-css` to package.json deps section; list `apps/web/public/favicon.svg`, `apps/web/public/icons.svg`, `apps/web/src/assets/hero.png` as Created (scaffold-introduced during 1-2).
- [x] [Review][Patch] `tsconfig.json` root declares `paths` redundantly — duplicated in `tsconfig.app.json`. With `files: []` + project references at root, root `paths` is not consumed during build. Remove root `paths` (keep only in `tsconfig.app.json`) to prevent drift.
- [x] [Review][Patch] (from D1.A) Fix `card.tsx` → replace `ring-1 ring-foreground/10 rounded-xl` with `border border-border rounded-lg` to match AC 6 tokens.
- [x] [Review][Patch] (from D2.A) Update AC 5 wording — replace "Inter (Google Fonts) is loaded" with "Inter is loaded and applied as the default `font-family`" (reflects bundled `@fontsource-variable/inter` decision).
- [x] [Review][Patch] (from D3.A) Update AC 2 wording — replace `toast` with `sonner` in the shadcn add command list (matches shadcn's deprecation of `toast`).

##### Defer

- [x] [Review][Defer] `verbatimModuleSyntax: true` + `import * as React` for type-only usage — works today with React 19 JSX transform; revisit if `noUnusedLocals` / future TS version tightens behavior.
- [x] [Review][Defer] `Input` component drops `ref` (no `forwardRef`) — React 19 passes `ref` as regular prop; shadcn v4 pattern. Revisit if `ref` forwarding becomes required.
- [x] [Review][Defer] Sub-pixel `radius-sm: calc(var(--radius) * 0.6)` = 3.6px — browser rounding inconsistencies at non-retina DPRs; cosmetic.
- [x] [Review][Defer] `Badge` `rounded-4xl` (15.6px) on 20px pill — design concern, not code bug.
- [x] [Review][Defer] `Sheet` close button nests `Button` primitive inside `SheetPrimitive.Close` via `render` prop — Base UI merge semantics handle it; revisit if hydration warnings appear.
- [x] [Review][Defer] `VITE_ALLOWED_HOSTS=","` edge case — empty array blocks all. Not fixing; extremely unlikely misconfiguration.

### Change Log

- **2026-04-14** — Initial implementation: Tailwind v4 + shadcn/ui + Confluent Notion-inspired tokens. 6/7 ACs satisfied (visual AC pending).
- **2026-04-14** — First code review: 1 decision + 5 patches + 5 defers recorded.
- **2026-04-14** — Second code review (after 1-1 review patches applied): 2 new decisions + 8 new patches + 6 new defers recorded. Prior `--ext` patch + `allowedHosts` defer auto-resolved by 1-1 review.

## Dev Notes

### Critical Architecture Constraints

- **Tailwind CSS v4** — NOT v3. Tailwind v4 uses `@import "tailwindcss"` instead of `@tailwind base/components/utilities` directives. Config is CSS-native (`@theme` blocks), NOT `tailwind.config.js`. [Source: architecture.md#Frontend]
- **shadcn/ui CLI v4** — use `npx shadcn@latest` (not `shadcn-ui`). The CLI auto-detects Tailwind v4 and generates compatible CSS variable config. [Source: ux-design-specification.md#Design System Choice]
- **Components in `apps/web/src/components/ui/`** — shadcn copies component source files here. Custom Confluent components go in `apps/web/src/components/confluent/` (created in later stories). [Source: architecture.md#React feature-based structure, ux-design-specification.md#Component Implementation Strategy]
- **`cn()` utility** — shadcn generates `src/lib/utils.ts` with `cn()` (clsx + tailwind-merge). All component class composition MUST use `cn()`. No raw string concatenation for Tailwind classes. [Source: ux-design-specification.md#Component Implementation Strategy]

### Design Token Source of Truth

All color, spacing, and typography values come from the UX Design Specification. Do NOT invent or adjust values:

| Token | Value | Source |
|---|---|---|
| Background base | `#FAFAF9` | ux-design-specification.md#Color System |
| Sidebar bg | `#F1F0EE` | ux-design-specification.md#Color System |
| Card bg | `#FFFFFF` | ux-design-specification.md#Color System |
| Primary text | `#1A1A1A` | ux-design-specification.md#Color System |
| Secondary text | `#6B6B6B` | ux-design-specification.md#Color System |
| Border | `#E8E8E7` | ux-design-specification.md#Color System |
| Accent/Primary | `#37352F` | ux-design-specification.md#Color System |
| Accent hover | `#1A1A1A` | ux-design-specification.md#Color System |
| Status active | `#4CAF7D` | ux-design-specification.md#Color System |
| Status neutral | `#B0B0B0` | ux-design-specification.md#Color System |
| Status destructive | `#E57373` | ux-design-specification.md#Color System |
| Status pending | `#F0A830` | ux-design-specification.md#Customisation Strategy |
| Border radius | `6px` | ux-design-specification.md#Spacing & Layout |
| Font | Inter (400,500,600,700) | ux-design-specification.md#Typography System |
| Base spacing | 4px grid | ux-design-specification.md#Spacing & Layout |

### Previous Story Intelligence (Story 1.1)

**Key learnings from 1.1 that impact this story:**

- **TypeScript version mismatch:** `apps/web` uses TS ~6.0.x (Vite template default), `apps/api` uses TS 5.x. Both typecheck cleanly but be aware of potential differences.
- **Cross-workspace resolution:** Shared package resolves via pnpm symlink, NOT tsconfig paths. Web uses `moduleResolution: bundler`.
- **ESLint config:** `apps/web/eslint.config.js` is ESLint 9 flat config format. Root `.eslintrc.cjs` is legacy format. Any new ESLint plugins (e.g., Tailwind) must use flat config format in `apps/web`.
- **Vite config already has:** `host: true`, `port: 5173`, `allowedHosts` for coton.app domains.
- **Build pipeline:** `pnpm turbo run build` runs `tsc -b && vite build` for web. Tailwind must be integrated before `vite build` for CSS processing.
- **Current `index.css`:** Contains Vite scaffold defaults (purple accent, dark mode, centered layout). Must be completely replaced with Tailwind + Confluent tokens.
- **Current `App.css`:** Contains Vite scaffold card/button styles (~184 lines). Delete or replace entirely.

### Anti-Patterns to Avoid

- **Do NOT create a `tailwind.config.js`** — Tailwind v4 uses CSS-native config. If shadcn CLI creates one, check if it's needed for v4 compatibility; prefer CSS `@theme` blocks.
- **Do NOT use raw hex values in components** — always reference CSS variables (`hsl(var(--primary))` or Tailwind utility classes).
- **Do NOT add dark mode** — Confluent is light-only for V1. Remove any dark mode variable blocks.
- **Do NOT change `packages/shared`** — this story touches `apps/web` only.
- **Do NOT install additional UI libraries** — shadcn/ui + Tailwind is the complete UI foundation.
- **Do NOT use `@apply`** — Tailwind v4 deprecates heavy `@apply` usage. Use utility classes directly.

### Project Structure Notes

Files this story creates or modifies:

**Modified:**
- `apps/web/package.json` — add Tailwind + shadcn dependencies
- `apps/web/vite.config.ts` — add `@tailwindcss/vite` plugin
- `apps/web/src/index.css` — replace entirely with Tailwind + Confluent tokens
- `apps/web/src/App.tsx` — replace Vite default with minimal token verification UI
- `apps/web/index.html` — add Inter font link

**Created:**
- `apps/web/components.json` — shadcn CLI config
- `apps/web/src/components/ui/*.tsx` — shadcn components (button, input, card, sheet, toast, separator, badge, avatar, label)
- `apps/web/src/lib/utils.ts` — `cn()` utility

**Deleted:**
- `apps/web/src/App.css` — Vite scaffold styles
- `apps/web/src/assets/react.svg` — unused
- `apps/web/src/assets/vite.svg` — unused

### References

- UX design tokens: [Source: ux-design-specification.md#Customisation Strategy]
- UX color system: [Source: ux-design-specification.md#Color System]
- UX typography: [Source: ux-design-specification.md#Typography System]
- UX spacing: [Source: ux-design-specification.md#Spacing & Layout Foundation]
- UX component strategy: [Source: ux-design-specification.md#Design System Components]
- Architecture frontend stack: [Source: architecture.md#Frontend]
- Architecture directory structure: [Source: architecture.md#React feature-based structure]
- Architecture dependency order: [Source: architecture.md#Cross-Component Dependencies]
- Epics story 1.2 AC: [Source: epics.md#Story 1.2]

## Dev Agent Record

### Agent Model Used

claude-opus-4-6

### Debug Log References

- `pnpm turbo run typecheck`: 1 successful (web), 0 errors
- `pnpm turbo run build`: 1 successful (web), built in 231ms, CSS 40.67kB gzip 7.68kB
- `pnpm turbo run lint`: 1 successful (web), 0 errors 2 warnings
- Full monorepo `typecheck build lint`: 3 successful, 0 cached

### Completion Notes List

1. Tailwind CSS v4 installed with `@tailwindcss/vite` plugin — CSS-native config via `@theme` blocks, no `tailwind.config.js`.
2. shadcn/ui v4 initialized (base-nova style) — 9 components added: button, input, card, sheet, sonner, separator, badge, avatar, label.
3. All CSS variables set to Confluent Notion-inspired palette (hex values). Custom status tokens (`--status-active`, `--status-neutral`, `--status-pending`) registered in `@theme inline` block for Tailwind utility class support (`bg-status-active` etc.).
4. Inter font via `@fontsource-variable/inter` (bundled, no CDN dependency). Replaced shadcn default Geist font.
5. Button hover: `bg-primary` (#37352F) → `hover:bg-foreground` (#1A1A1A), `transition-all` removed for instant change. Dark mode prefixes stripped from all variants.
6. Dark mode completely removed (light-only V1).
7. Path alias `@/*` added to `tsconfig.json` + `tsconfig.app.json` + `vite.config.ts` — required by shadcn CLI. `baseUrl` removed (deprecated in TS 6).
8. ESLint config updated: `react-refresh/only-export-components` set to `warn` with `allowConstantExport` to accommodate shadcn variant exports.
9. Vite scaffold cleanup: `App.css` deleted, `App.tsx` replaced with token verification UI, unused SVG assets removed.

### Key Decisions

- **`@fontsource-variable/inter` over Google Fonts CDN:** Bundled font eliminates external CDN dependency, works offline, better for self-hosted deployments (open source requirement).
- **`sonner` instead of `toast`:** shadcn deprecated the `toast` component in favor of `sonner` — used the replacement.
- **Hex values instead of oklch:** Direct mapping from UX spec hex values for clarity and auditability. shadcn default oklch values replaced.
- **`@/*` path alias:** Required by shadcn CLI for component imports. Added to both tsconfig and vite resolve alias.

### File List

**Created:**
- `apps/web/components.json` — shadcn CLI configuration (hooks alias removed after review)
- `apps/web/src/components/ui/button.tsx` — Button component (customized hover, no transition-all)
- `apps/web/src/components/ui/input.tsx` — dark: prefixes removed
- `apps/web/src/components/ui/card.tsx` — `border border-border rounded-lg` to match AC 6
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/sonner.tsx` — hardcoded `theme="light"` (no next-themes)
- `apps/web/src/components/ui/separator.tsx` — `data-[orientation=*]` variants (Base UI-correct)
- `apps/web/src/components/ui/badge.tsx` — dark: prefixes removed
- `apps/web/src/components/ui/avatar.tsx` — dark: prefixes removed
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
- `apps/web/eslint.config.js` — flat config with react-hooks + react-refresh rules
- `apps/web/public/favicon.svg`, `apps/web/public/icons.svg`, `apps/web/src/assets/hero.png` — scaffold/template assets

**Modified:**
- `apps/web/package.json` — added tailwindcss, @tailwindcss/vite, tw-animate-css, @fontsource-variable/inter; `shadcn` moved to devDependencies; `next-themes` removed
- `apps/web/vite.config.ts` — added tailwindcss plugin, path resolve alias, env-driven `host`/`allowedHosts`, `loadEnv` restricted to `VITE_` prefix
- `apps/web/src/index.css` — Tailwind v4 import + Confluent tokens; `@apply` replaced with raw CSS; `@custom-variant dark` removed; broken `shadcn/tailwind.css` import removed
- `apps/web/src/App.tsx` — replaced scaffold with token verification UI
- `apps/web/src/main.tsx` — (modified by story 1-1 code review: added `UserRole` cross-workspace type check)
- `apps/web/tsconfig.json` — added project references; no `paths` (moved to tsconfig.app.json only)
- `apps/web/tsconfig.app.json` — added `@/*` path alias, removed baseUrl
- `apps/web/index.html` — updated title to "Confluent"

**Deleted:**
- `apps/web/src/App.css` — Vite scaffold defaults
- `apps/web/src/assets/react.svg` — unused scaffold asset
- `apps/web/src/assets/vite.svg` — unused scaffold asset
