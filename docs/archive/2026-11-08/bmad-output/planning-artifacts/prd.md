---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish']
inputDocuments: []
workflowType: 'prd'
classification:
  projectType: saas_b2b
  domain: deal_flow_startup
  complexity: high
  projectContext: greenfield
  roles: ['porteur_de_projet', 'financeur', 'administrateur']
  dataEntryV1: manual_onboarding_questionnaire
  aiAutomation: out_of_scope_v1
---

# Product Requirements Document - confluent

**Author:** Coton
**Date:** 2026-04-14

## Executive Summary

Confluent is a multi-tenant SaaS platform that eliminates deal flow fragmentation in startup ecosystems. Project holders submit their dossier once through a structured onboarding questionnaire and control exactly who accesses it — sharing via unique, per-recipient traceable links with explicit revocation rights. Support structures and financing actors receive a standardized, pre-qualified pipeline instead of fragmented, inconsistent inbound from multiple sources.

The platform operates as a trusted intermediary layer: an administrator-controlled environment where a configurable qualification framework governs how projects are structured, classified, and surfaced. This replaces the current ad-hoc ecosystem of paid platforms, email chains, and disconnected spreadsheets that forces entrepreneurs to resubmit identical data repeatedly in different formats.

### What Makes This Special

The core differentiator is data sovereignty for the project holder. Unlike submission-based platforms where data is surrendered to the operator, Confluent gives the entrepreneur explicit control over visibility: who receives access, when, and with a full audit trail. Each share generates a unique, identified link per recipient — granting targeted access while maintaining a complete access log.

The admin-configurable qualification questionnaire creates a shared vocabulary across ecosystem actors. Financeurs receive dossiers pre-structured to their evaluation criteria. The entrepreneur fills in data once and manages distribution from a single dashboard.

V1 is deliberately scoped to this core loop: structured intake → controlled sharing → access analytics. AI-assisted data enrichment and co-investor matching are post-V1 capabilities.

## Project Classification

| Dimension | Value |
|---|---|
| **Project Type** | SaaS B2B — multi-tenant |
| **Domain** | Startup deal flow platform |
| **Complexity** | High |
| **Project Context** | Greenfield |
| **User Roles (V1)** | Project holder · Financeur · Administrator |
| **V1 Data Entry** | Manual — structured onboarding questionnaire |
| **AI / Automation** | Out of scope — V1 |

## Success Criteria

### User Success

**Entrepreneur:** Structures and publishes a complete dossier through a single onboarding questionnaire. Shares it selectively via unique per-recipient links. Monitors access: who has been invited, who has viewed, and revokes access at any time. Never resubmits data to a new actor.

**Financeur:** Receives curated deal flow directly from entrepreneurs operating in their domain. Accesses structured, standardized dossiers without chasing data across email and platforms.

**Administrator (Confluent):** Configures the qualification questionnaire, manages user accounts, and guarantees platform integrity as the trusted regional intermediary.

### Business Success

**V1 target — Centre-Val de Loire:**
- 5+ financeurs receiving and consulting dossiers regularly
- 10+ entrepreneurs with published, complete dossiers
- Ecosystem partners (incubators, Village by CA, regional networks) directing entrepreneurs to the platform as default intake channel

**Success signal:** Regional deal flow circulates through Confluent — no more email attachments, no more redundant submissions.

### Technical Success

- Entrepreneur completes full onboarding in a single session without data loss
- Unique links are non-transferable, revocable, and fully auditable
- Access grants and revocations take effect immediately
- Platform reliability suitable for daily professional use
- Codebase fully open source from day one

### Measurable Outcomes

- Entrepreneur completes dossier in <30 minutes
- Every financeur access is tied to a named, identified recipient
- Zero duplicate submissions across ecosystem actors

## User Journeys

### Journey 1: Sophie — First Dossier, First Share (Entrepreneur · Success Path)

**Persona:** Sophie, 34, CEO of a DeepTech startup developing biosensors for industrial quality control. Based in Tours, 3 employees, pre-seed stage. She's been through two incubator programs and is now actively looking for seed funding.

**Opening Scene:** Sophie's incubator coordinator just connected her with three potential investors via email. Her immediate reaction: *"Great — now I need to send them all my documents again."* She opens her laptop, stares at her Dropbox folder, and starts copy-pasting the same email for the third time this month. Different recipients, slightly different asks, same exhausting ritual.

**Rising Action:** Her coordinator mentions Confluent. Sophie signs up, lands on the onboarding questionnaire. The form asks structured questions — team, product, market, financials, maturity stage. She uploads her pitch deck and business plan directly in the flow. 25 minutes later, her dossier exists: complete, classified (DeepTech · Pre-seed), readable by anyone she chooses.

**Climax:** Instead of sending three emails with attachments, Sophie generates three unique links — one per investor, each tied to their email address. She hits send. Two days later she checks her dashboard: two of the three have opened their link. One spent 8 minutes on it.

**Resolution:** Sophie books her first meeting with the investor who spent 8 minutes. She never sent a single attachment. She knows exactly who has seen what. When the third contact goes silent, she revokes their link — quietly, without drama, without them knowing.

*Capabilities revealed: structured onboarding questionnaire, document upload, dossier classification, per-recipient unique link generation, email invitation, access analytics (views, duration, timestamps), access revocation.*

---

### Journey 2: Marc — Qualified Deal Flow Without the Noise (Financeur · Success Path)

**Persona:** Marc, 48, Investment Manager at a regional Business Angels network in Orléans. Manages a portfolio of 12 active investments. Receives 20+ unsolicited pitches per week — PDFs via email, LinkedIn DMs, spreadsheets forwarded by well-meaning contacts.

**Opening Scene:** Monday morning. Marc's inbox has 6 new pitch decks. Three are missing financials. One is a 47-slide PDF with no executive summary. He reads none of them before his 9am call. This is his normal.

**Rising Action:** At 9:15am he gets an email: *"Sophie Moreau has shared her dossier with you on Confluent."* He clicks the link — no account needed, no friction. He sees a structured dossier: company overview, team, product, market size, financials, maturity stage (DeepTech · Pre-seed). Everything in the same place, in the same format as the last dossier he reviewed on the platform.

**Climax:** In 11 minutes Marc has read the dossier and decided: this matches his thesis. He makes a note and moves on. No reply email, no "can you send me your financials?", no chasing.

**Resolution:** Marc quietly starts preferring dossiers that come through Confluent. They're complete. They're classified. When he visits the platform directly, his email address gives him instant access to every dossier that's been shared with him — all in one place, in the same format. His Monday mornings don't change — but his hit rate does.

*Capabilities revealed: frictionless link access (no mandatory account — email-as-identity), consolidated dossier view per recipient email address (FR28), standardized dossier display, sector/maturity classification metadata.*

---

### Journey 3: The French Tech CVL Team — Configuring the Regional Standard (Administrator · Operations Path)

**Persona:** The French Tech Centre-Val de Loire operational team — 2 people responsible for animating the regional startup ecosystem. They coordinate between 8 incubators, 15+ financing actors, and hundreds of entrepreneurs. Their current tools: shared spreadsheets, email lists, and a lot of phone calls.

**Opening Scene:** The platform is live. Before the first entrepreneur can create a dossier, the team needs to define what "a dossier" means for the region — what questions to ask, in what order, with what required fields. They open the admin interface.

**Rising Action:** They configure the onboarding questionnaire section by section: company identity, founding team, product description, market and traction, financial situation, maturity classification (TRL level, financing stage). They mark required vs. optional fields. They add a custom section specific to the region's priorities. They invite the first cohort of financeurs to the platform, assigning them their access role.

**Climax:** First entrepreneur completes the questionnaire. The admin team reviews the output — the dossier is clean, complete, and classified exactly as intended. The shared vocabulary they defined is working: every dossier speaks the same language.

**Resolution:** The French Tech team can now report on regional deal flow with real data. They know how many active dossiers exist, at what stage, in which sectors. They are no longer coordinators — they are platform operators.

*Capabilities revealed: admin questionnaire builder (sections, fields, required/optional, ordering), role and user management, dossier review interface, regional pipeline overview.*

---

### Journey 4: Sophie — Unwanted Access (Entrepreneur · Edge Case)

**Persona:** Same Sophie from Journey 1. Three months in, her startup is gaining traction. She's been more liberal with sharing — a contact introduced at a networking event asked for her dossier and she shared it without thinking twice.

**Opening Scene:** Sophie logs into her dashboard and checks her analytics. She notices the contact — call him David — has viewed her dossier 9 times over the past week. Unusual. She digs into her notes: David works for a company that is, she now realizes, a direct competitor scouting the market.

**Rising Action:** Sophie goes to her access management panel. She can see David's link: active, 9 views, last accessed yesterday. She can see every session timestamp. She clicks "Revoke."

**Climax:** The link is dead in seconds. David's next click will land on a 404. Sophie has the full access log — timestamps, session durations — as a clear record of what happened and when.

**Resolution:** Sophie feels something she hadn't expected: control. She didn't lose her data — she shared it knowingly, she tracked it, and she closed it. She's more confident sharing with the next contact, because she knows she can undo it.

*Capabilities revealed: per-recipient access log with session detail (views, duration, timestamps), immediate revocation with confirmation, audit trail export or display.*

---

### Journey Requirements Summary

| Capability | Journeys (ref) |
|---|---|
| Structured onboarding questionnaire (dynamic, admin-configurable) | J1, J3 |
| Document upload within questionnaire flow | J1 |
| Dossier classification (sector, maturity stage) | J1, J2, J3 |
| Per-recipient unique link generation | J1, J4 |
| Email invitation to recipient | J1, J2 |
| Frictionless financeur access (no mandatory account) | J2 |
| Standardized dossier display for recipients | J2 |
| Access analytics (views, duration, timestamps, per-link) | J1, J4 |
| Per-recipient access revocation (immediate) | J1, J4 |
| Audit trail / access log | J4 |
| Admin questionnaire builder | J3 |
| Admin user and role management | J3 |
| Admin pipeline overview | J3 |

## Domain-Specific Requirements

### Compliance & Regulatory

**GDPR (Priority: Post-V1, high urgency)**
- All personal data collected with explicit, granular consent
- Transparent data collection: entrepreneur knows exactly what is stored and why
- Full data deletion on entrepreneur request — all dossier content, documents, and access logs
- French/EU data residency: official Confluent instance hosted in France (regional provider)
- Self-hosted deployments (open source) under deployer's own data responsibility

### Technical Constraints

**V1 Baseline:**
- No encryption-at-rest requirement in V1 — trust-based model with admin as guarantor
- Basic access control enforced at application layer (per-recipient links, revocation)
- Open source codebase from day one — security by transparency, not obscurity

**Post-V1 Roadmap:**
- Immutable audit logs: cryptographically verifiable record of all dossier access events, exportable by entrepreneur (V2)
- Encryption at rest for uploaded documents — triggered by regulatory demand or community requirement (V2+)
- Hardened admin access controls and privilege separation (V2)

### Risk Mitigations

| Risk | Mitigation | Timeline |
|---|---|---|
| Entrepreneur data exposed without consent | Explicit consent flow at registration | V1 |
| Right to deletion — GDPR Art. 17 | Full data deletion on request | V2 |
| Admin accesses sensitive data without oversight | Trust model V1; audit logs V2 | V2 |
| Open source reveals attack surface | Security-by-design, responsible disclosure policy | Day one |
| Self-hosted instance without GDPR controls | Documentation, deployment guide with compliance checklist | V1 |

### Open Source

Open source is a first-class constraint, not an afterthought:
- Full codebase published from day one
- Enables ecosystem adoption: any regional operator can self-deploy
- Community contributions as a quality and security multiplier
- Deployment documentation must include GDPR and security baseline guidance for self-hosters

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. Data Sovereignty Inversion**

Existing deal flow platforms (Dealroom, AngelList, Notion-based CRMs) operate on a data aggregation model: the platform owns the data, the entrepreneur submits to the platform's terms, and visibility is controlled by the operator. Confluent inverts this: the entrepreneur owns their dossier, controls who sees it, and can revoke access at any time — including from the platform operator itself. This is a paradigm shift from "submit your pitch" to "share your dossier on your terms."

The innovation is not technical — it is architectural and philosophical. The product enforces data sovereignty at the feature level (unique links, per-recipient revocation, access logs), making the principle non-negotiable by design.

**2. Federated Trust Infrastructure**

Confluent is not just a product — it is a deployable protocol. Any regional ecosystem operator can self-host a Confluent instance, configuring it for their own geography, language, and qualification criteria. This creates a federated trust network: multiple independent instances, each governed by a local trusted operator, with no central authority holding all the data.

This positions Confluent closer to an open infrastructure project (analogous to Matrix for messaging, or Mastodon for social) than to a SaaS product. The open source model is not a cost-reduction strategy — it is the trust mechanism itself. Users trust the platform because they can read, audit, and fork the code.

**3. Questionnaire as Governance Instrument**

The admin-configurable questionnaire is the least visible but most powerful innovation. The operator who defines the qualification questions defines the shared vocabulary of the regional ecosystem — what a "complete dossier" means, what maturity stages exist, which sectors are tracked. This is a governance instrument disguised as a product feature.

Over time, if multiple regional instances converge on similar questionnaire structures, a de facto standard emerges — not imposed top-down, but adopted bottom-up through usage. Confluent becomes the infrastructure layer on which regional deal flow standards are built.

### Market Context & Competitive Landscape

Existing solutions fall into three categories:
- **Platform aggregators** (Dealroom, Crunchbase): data belongs to the platform, no entrepreneur control
- **Document tools** (DocSend, Notion): sharing and analytics, but no qualification framework or ecosystem integration
- **Regional CRMs** (custom Excel, Salesforce deployments): no standardization, no portability, operator-dependent

Confluent occupies an unaddressed position: a structured, sovereign, federated deal flow layer. The closest analogy is a data room (VDR) combined with a qualification standard — but no existing VDR is open source, regionally federated, or built around ecosystem coordination.

### Validation Approach

| Innovation | Validation Signal | Timeline |
|---|---|---|
| Data sovereignty | Entrepreneur uses revocation feature within first 30 days | V1 adoption |
| Federated infrastructure | Second independent instance deployed by another regional operator | 12 months post-launch |
| Questionnaire as standard | Two operators converge on similar questionnaire structure without coordination | 18 months post-launch |

### Risk Mitigation

| Risk | Mitigation |
|---|---|
| Data sovereignty is too complex for non-technical entrepreneurs | Onboarding UX simplifies access management — revocation is one click |
| Federated model fragments the ecosystem instead of unifying it | Shared open source questionnaire templates enable voluntary convergence |
| Questionnaire lock-in — operator defines an unusable standard | Admin can iterate on questionnaire; existing dossiers are versioned |
| Open source enables low-quality forks that damage trust | Clear governance model and official instance branding (Confluent.fr) |

## SaaS B2B Specific Requirements

### Tenant Model

Confluent operates as a **single-tenant-per-instance** deployment. Each instance serves one ecosystem operator and its community of entrepreneurs and financeurs. No cross-instance data sharing or user federation in V1.

Within a single instance:
- Entrepreneurs are fully isolated from each other — no shared data, no cross-dossier visibility
- Financeurs see only dossiers explicitly shared with them — opaque between financeurs
- Administrators have full read/write access to all dossiers, with all actions logged and visible to the entrepreneur
- One entrepreneur account can hold multiple dossiers (multiple companies or multiple projects)

### RBAC Permission Matrix

| Action | Entrepreneur | Financeur | Administrator |
|---|---|---|---|
| Create dossier | ✅ Own | ❌ | ❌ |
| Edit dossier content (text) | ✅ Own | ❌ | ✅ All — logged |
| Upload / replace documents | ✅ Own | ❌ | ✅ All — logged |
| Generate share link (per recipient) | ✅ Own | ❌ | ✅ All — logged |
| Revoke share link | ✅ Own | ❌ | ✅ All — logged |
| View access analytics | ✅ Own | ❌ | ✅ All |
| View dossier content | ✅ Own | ✅ Shared only | ✅ All |
| See admin action log on dossier | ✅ Own dossier | ❌ | ✅ All |
| See other financeurs on same dossier | ❌ | ❌ | ✅ |
| Delete own account + data | ✅ | ✅ | ✅ |
| Configure questionnaire | ❌ | ❌ | ✅ |
| Manage user accounts | ❌ | ❌ | ✅ |

> **Admin action log:** Every admin intervention on a dossier (upload, edit, revoke) generates a timestamped, named log entry visible to the dossier owner (entrepreneur) and all admins. This is the accountability mechanism that makes the trust model viable.

### Subscription Tiers

**V1:** Free. Platform funded by the operating structure (French Tech / région).

**Future revenue model (post-V1):**
- Monetization of aggregated, anonymized ecosystem data
- Paid entrepreneur support and coaching services
- Partner referral fees

### Integration Architecture

**Core principle: full provider agnosticism.** All external dependencies abstracted behind configurable interfaces.

| Service | V1 Stack | Abstraction |
|---|---|---|
| Database | PostgreSQL — self-hosted | Configurable via deployment config |
| File storage | S3-compatible API — provider TBD | Storage adapter interface (any S3-compatible provider) |
| Transactional email | Brevo (default) | Configurable SMTP / provider interface |
| Hosting | French regional provider | Any cloud or on-premise |

**V1 Integrations:** None. External API integrations (Infogreffe, Banque de France) are post-V1.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Platform MVP — both sides of the market (entrepreneurs + financeurs) must be active simultaneously for the product to deliver value. A platform with only entrepreneurs is a dossier tool. A platform with only financeurs is an empty directory. Both sides must be seeded at launch.

**Cold Start Strategy:** Benjamin handles ecosystem acquisition — targeting incubators first. Incubators have a direct incentive (a centralized platform for their portfolio) and a direct lever (they can mandate or strongly encourage their incubated companies to publish their dossier). This B2B2C distribution model (platform → incubator → entrepreneur) is the fastest path to reaching the critical mass of 10 active dossiers.

**Build Approach:** Solo development — Jean-Baptiste Beuzelin, AI-assisted. This is a strong constraint that validates the lean MVP scope: 6 focused capabilities, no mobile-first, no external API integrations, no AI features. The scope is coherent with a solo + AI build. Open source from day one unlocks community contributions post-launch.

**Launch Timeline:** TBD — no hard constraint identified. Recommend setting a target once architecture decisions are finalized.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Journey 1: Sophie creates and shares her dossier (entrepreneur success path)
- Journey 2: Marc receives and consults a shared dossier (financeur success path)
- Journey 3: French Tech CVL team configures the platform (admin operations)
- Journey 4: Sophie revokes unwanted access (entrepreneur edge case)

**Must-Have Capabilities:**

| # | Capability | Justification |
|---|---|---|
| 1 | Dynamic onboarding questionnaire (admin-configurable) | Core data collection — without this, there are no dossiers |
| 2 | Document upload within questionnaire flow | Pitch deck and BP are non-negotiable for financeurs |
| 3 | Dossier classification (sector, maturity stage) | Required for financeur relevance filtering |
| 4 | Per-recipient unique link (crypto-random token) + email invitation | Core sharing mechanism — the trust model depends on this |
| 5 | Access management (grant, revoke, active access list) | Data sovereignty is the differentiator — must work in V1 |
| 6 | Access analytics (views, duration, timestamps per link) | Validates the value proposition for entrepreneurs |
| 7 | Admin action log (visible to entrepreneur) | Trust accountability mechanism |
| 8 | Rate limiting on link access | Brute-force protection — non-negotiable given sensitivity of data |
| 9 | Admin: questionnaire builder + user management | Platform operations — without this, the admin can't configure anything |

### Post-MVP Features (Phase 2 — Growth)

- Link expiration with configurable validity period
- Email token verification at first link access (double authentication)
- Full data deletion on request (GDPR Art. 17 compliance)
- Public catalogue with entrepreneur opt-in visibility
- Financeur account and personal dashboard (aggregated view of shared dossiers)
- Accompagnateur role with portfolio dashboard
- Automated notifications and reminders
- Co-investor visibility (financeurs on same dossier)
- Immutable audit logs (cryptographically verifiable)

### Phase 3 — Expansion

- AI-assisted dossier completion and maturity scoring
- External API integrations (Infogreffe, Banque de France)
- Multi-instance federation and shared questionnaire templates
- Full GDPR compliance module (consent management, DPA tooling)
- Encryption at rest for uploaded documents
- Open Source community governance model

### Risk Mitigation Strategy

**Technical Risks:**

| Risk | V1 Mitigation | Future |
|---|---|---|
| Link guessability / brute force | Crypto-random token (UUID v4 / CSPRNG) + rate limiting per IP/minute | Link expiration + email token (V2) |
| Data loss during questionnaire | Session persistence, auto-save draft | — |
| File storage provider lock-in | S3-compatible adapter interface | Provider-agnostic from day one |
| Solo dev bus factor | Open source codebase, AI-assisted, full documentation | Community contributors post-launch |

**Market Risks:**

| Risk | Mitigation |
|---|---|
| Entrepreneurs don't fill their dossier | Incubators as primary distribution channel (Benjamin's mandate); incubator incentive = centralized portfolio view |
| Financeurs don't check the platform | Direct personal outreach by Benjamin; 5 pre-committed financeurs at launch |
| Platform perceived as yet another tool | Incubator buy-in = official recommendation, not optional noise |

**Resource Risks:**

| Risk | Mitigation |
|---|---|
| Solo dev capacity | Lean MVP scope (6 capabilities); AI-assisted development; no complex integrations in V1 |
| Scope creep | Hard MVP boundary documented here; post-MVP features explicitly deferred |
| Community adoption post-launch | Open source from day one; deployment documentation included in V1 deliverables |

## Functional Requirements

> **Capability Contract:** This list defines every user-facing and system capability the product must deliver. UX designers will only design what is listed here. Architects will only support what is listed here. Any capability absent from this list does not exist in V1.

### Dossier Management

- **FR1:** An entrepreneur can create a new dossier associated with their account
- **FR2:** An entrepreneur can hold multiple dossiers (one per company or project)
- **FR3:** An entrepreneur can edit the text content of their own dossier
- **FR4:** An entrepreneur can upload documents to their dossier
- **FR5:** An entrepreneur can replace an uploaded document with a newer version, with the previous version retained in history
- **FR6:** An entrepreneur can revert a document to a previous version
- **FR7:** An entrepreneur can delete a dossier
- **FR8:** The system classifies each dossier by sector and maturity stage based on questionnaire answers
- **FR9:** An administrator can edit the text content of any dossier (action logged and visible to entrepreneur)
- **FR10:** An administrator can upload or replace documents on any dossier (action logged and visible to entrepreneur)

### Onboarding Questionnaire

- **FR11:** An entrepreneur can complete a structured questionnaire to populate their dossier
- **FR12:** The questionnaire auto-saves progress so the entrepreneur can resume without data loss
- **FR13:** An administrator can configure the questionnaire structure (sections, fields, field types, required/optional status, ordering)
- **FR14:** An administrator can update the questionnaire; existing completed dossiers are not retroactively affected
- **FR15:** An administrator can configure the classification taxonomy (sectors, maturity stages, TRL levels)

### Access Control & Sharing

- **FR16:** An entrepreneur can generate a unique access link for a named recipient identified by email address
- **FR17:** The system sends an email invitation to the recipient upon link generation
- **FR18:** An entrepreneur can generate multiple independent links for the same dossier (one per recipient)
- **FR19:** An entrepreneur can view the full list of active access links for a dossier (recipient email, creation date, link status)
- **FR20:** An entrepreneur can revoke an individual access link at any time with immediate effect
- **FR21:** A revoked or invalid link returns an access-denied response to any access attempt
- **FR22:** An administrator can revoke any access link on any dossier (action logged and visible to entrepreneur)

### Analytics & Audit

- **FR23:** An entrepreneur can view access analytics per link: number of views, session duration, timestamps
- **FR24:** An entrepreneur can view a chronological log of all administrator actions on their dossier (action type, timestamp, admin identity)
- **FR25:** An administrator can view access analytics across all dossiers on the platform
- **FR26:** An administrator can view the full action log for any dossier including all admin interventions

### Financeur Experience

- **FR27:** A recipient can access a dossier shared with their email address by verifying their identity via that email (no traditional account registration required)
- **FR28:** A financeur can view a consolidated list of all dossiers that have been shared with their email address
- **FR29:** The shared dossier displays structured content in a standardized, consistent format
- **FR30:** The shared dossier displays the dossier's classification (sector, maturity stage)
- **FR31:** A financeur cannot access or infer the existence of other recipients' links for the same dossier

### Platform Administration

- **FR32:** An administrator can invite users to the platform and assign them a role (entrepreneur or financeur)
- **FR33:** An administrator can deactivate or remove a user account
- **FR34:** An administrator can view a platform-level overview of all dossiers (count, sector distribution, maturity stage distribution)
- **FR35:** An administrator can read the full content of any dossier on the platform

### Account & Data Management

- **FR36:** A user can register for an account with explicit, informed consent to data processing
- **FR37 (Phase 2):** An entrepreneur can request full deletion of their account and all associated data (dossiers, documents, access links, analytics)
- **FR38 (Phase 2):** The system executes a full data deletion request completely and irreversibly
- **FR39:** A user can update their account profile information

### Security

- **FR40:** The system generates each access link using a cryptographically secure random token that is non-guessable and non-sequential
- **FR41:** The system enforces rate limiting on link access attempts per IP address to prevent brute-force enumeration
- **FR42:** The system logs failed access attempts (invalid or revoked links) accessible to administrators

## Non-Functional Requirements

### Performance

- **NFR1:** Dossier display (shared link access) loads within 3 seconds on a standard broadband connection
- **NFR2:** Questionnaire auto-save triggers within 2 seconds of user inactivity with no visible session disruption
- **NFR3:** Document upload provides real-time progress feedback for files larger than 1 MB
- **NFR4:** Access revocation takes effect within 5 seconds — subsequent access attempts on a revoked link are denied immediately

### Security

- **NFR5:** All data in transit is encrypted using TLS 1.2 or higher
- **NFR6:** Share link tokens are generated with a minimum of 128 bits of cryptographic entropy (CSPRNG)
- **NFR7:** Rate limiting blocks more than 10 link access attempts per IP address per minute (to be tightened in future versions as usage scales)
- **NFR8:** User passwords are stored using a modern adaptive hashing algorithm (bcrypt or Argon2) — MD5 and SHA-1 are forbidden
- **NFR9:** The admin action log is append-only — existing entries cannot be modified or deleted
- **NFR10:** All failed link access attempts are logged with IP address and timestamp

### Scalability

- **NFR11:** V1 architecture supports up to 500 entrepreneur accounts, 100 financeur identities, and 1,000 dossiers on a single server without architectural changes
- **NFR12:** The platform deploys on a single server instance for small ecosystems without requiring a distributed setup

### Reliability

- **NFR13:** Target availability: 99% uptime for the official instance (≤7 hours unplanned downtime per month)
- **NFR14:** No data is lost on application restart — all writes are durable before confirmation
- **NFR15:** The official instance performs daily automated database backups with a minimum 30-day retention period
- **NFR16:** Deployment documentation includes a backup and restore procedure for self-hosted instances

### Provider Agnosticism

- **NFR17:** The email delivery layer is abstracted behind a configurable interface — any SMTP-compatible provider or Brevo can be used without code changes
- **NFR18:** The file storage layer is abstracted behind an S3-compatible interface — any S3-compatible provider can be substituted without code changes
- **NFR19:** The database connection is fully configurable via standard PostgreSQL connection parameters

### Accessibility

- **NFR20:** The platform targets WCAG 2.1 AA compliance as a baseline, with progressive improvement toward full AAA compliance in future versions
- **NFR21:** All interactive elements are keyboard-navigable — the platform is fully usable without a mouse
- **NFR22:** All UI components use semantic HTML with appropriate ARIA labels to support screen readers and assistive technologies
- **NFR23:** The questionnaire and dossier interfaces use plain, clear language — free of jargon — to serve non-technical entrepreneurs across all levels of digital literacy
- **NFR24:** The platform is designed to be AI-readable: dossier content is rendered in structured, semantic markup that allows AI agents and automated tools to parse and consume data correctly
- **NFR25:** Dossier data is structured and consistently formatted to enable future machine-readable export (JSON or equivalent), supporting V2+ AI-assisted features
- **NFR26:** The platform interface is responsive and usable on mobile devices, even though mobile-first is not the primary design target for V1
