/**
 * Import the real agency engagements into the CRM.
 *
 * WHY: the CRM held 94 conference badges and none of the people actually being
 * sold to. Every real thread — CDT, LCI, Caltrans, FTB, DDS, CTC — lived only in
 * meeting notes and bid folders, so nobody could pick up a deal from the CRM.
 * That is the failure the GTM corrections describe: selling happens deal by
 * deal and nothing accumulates.
 *
 * SOURCES, all read-only:
 *   - Granola meeting notes (Sept 2025 – July 2026)
 *   - operations bid READMEs (solicitations, pricing, agency contacts)
 *   - Nexus plans/ and docs/ (demo prep, requirements, runbooks) — READ ONLY
 *
 * HONESTY RULES APPLIED:
 *   - Touches are logged on the DATE THEY HAPPENED, not today, so aging and
 *     momentum stay true. `appendLog` takes a date for exactly this.
 *   - People whose surname or email was never recorded are imported with what is
 *     known and flagged `needs detail` in notes. Inventing an email would be
 *     worse than an incomplete record.
 *   - Stage reflects the furthest point actually reached, never intent.
 *   - Idempotent: skips anyone already present, so re-running is safe.
 *
 * Run: node --experimental-strip-types --no-warnings scripts/run-ts.mjs \
 *        scripts/import-engagements.ts [--dry]
 */
import { listContacts, createContact, appendLog, updateContact, commitBatch, slugify } from '../src/lib/crm.ts'
import type { CrmStage } from '../src/lib/config.ts'

const DRY = process.argv.includes('--dry')

interface Touch { date: string; text: string }
interface Engagement {
  name: string
  title?: string
  email?: string
  agency: string
  agencyName: string
  product?: string
  owner?: string
  stage: CrmStage
  nextAction?: string
  nextActionDue?: string
  notes: string
  touches: Touch[]
  incomplete?: boolean
}

const ENGAGEMENTS: Engagement[] = [
  {
    name: 'Robert (CDT MMBI)', agency: 'cdt', agencyName: 'CA Dept of Technology (CDT)',
    product: 'delivery-management', owner: 'Pavan', stage: 'pilot-discussion',
    nextAction: 'Deliver the targeted POC proposal — PeopleSoft/fiscal connectivity + contract management',
    nextActionDue: '2026-07-29',
    incomplete: true,
    notes: `Advisor to CDT's middle-mile broadband (MMBI) program. Surname and email not recorded in any source — **needs detail**.

**Their problem (from the 2026-07-21 meeting):** 20 partner contracts covering 3,000 miles of broadband construction, each structured differently, 40-200 pages (standard ~60), all public domain. Manual clause search is error-prone — "termination for convenience" vs "for cause" sit in different sections per contract.

**Priority use cases, in their order:** (1) ongoing cost triggers — when maintenance/ops fees start, which varies per partner between per-segment and full completion; (2) compliance testing against partner-specific specs; (3) amendment tracking; (4) cross-partner comparison (secondary).

**Positioning that worked:** lead with "your contracts are ingested, ask any question". No architecture talk, no jargon like "vector DB" with procurement. Their framing: we know your problems / solve in ~a month / buy now / buy from us.

**Open and owed:** the pricing and scope document is a separate task with Pavan as owner (per the Nexus demo-prep plan) and has not been delivered. Amendment comparison and compliance testing are deliberately NOT built — they are sold as the ~1-month custom implementation line item.`,
    touches: [
      { date: '2026-07-14', text: 'Platform demo with Robert and Scott (MMBI advisors): AI reporting on the Caltrans Oracle dataset (800M records), ad hoc querying, PRA module, role-based access, 2-3 month onboarding. They agreed to share the areas they want covered and asked for a tailored follow-up.' },
      { date: '2026-07-21', text: 'Pre-demo strategy call. CDT described 20 broadband partner contracts and their manual clause-search pain. Demo repositioned from data-warehouse framing to contract Q&A at their request. Next: obtain sample contracts, prepare pricing and implementation scope for procurement.' },
      { date: '2026-07-22', text: 'Full platform demo — live on Caltrans Oracle (800M+ records), contract assistant with cross-contract querying and page citations, workflow automation, KPI monitoring, and differentiation from Poppy (Poppy discovers and summarises; we take actions across systems). CDT raised PeopleSoft/fiscal connectivity as the real gap. Agreed next step: a targeted POC proposal. CDT said they would circle back within days.' },
    ],
  },
  {
    name: 'Scott (CDT MMBI)', agency: 'cdt', agencyName: 'CA Dept of Technology (CDT)',
    product: 'delivery-management', owner: 'Pavan', stage: 'pilot-discussion',
    incomplete: true,
    notes: 'Advisor to CDT\'s middle-mile broadband (MMBI) program, alongside Robert. Surname and email not recorded — **needs detail**. Attended all three July 2026 sessions. Shannon\'s team was referenced as the eventual end users.',
    touches: [
      { date: '2026-07-14', text: 'Attended the CDT platform demo (see Robert for the full record).' },
      { date: '2026-07-22', text: 'Attended the full CDT platform demo; POC proposal agreed as the next step.' },
    ],
  },
  {
    name: 'Christine (LCI)', agency: 'lci', agencyName: 'LCI / LCIRB',
    product: 'assistants', owner: 'Pavan', stage: 'pilot-discussion',
    nextAction: 'Confirm current status — six meetings through Feb 2026, then silence',
    incomplete: true,
    notes: `Policy and compliance lead at LCI/LCIRB, the California public agency managing the CEQA clearinghouse (400K+ environmental/construction document submissions). Surname and email not recorded — **needs detail**.

The deepest engagement on record after CDT: six meetings between Nov 2025 and Feb 2026, security forms (5310C, 5305F) filed, Azure infrastructure being provisioned, data profiling planned with Christine, Denise and Alicia. Other names on their side: Jamie (technical), Denise, Alicia, Bradley. Naveen was the internal liaison.

**No recorded contact since Feb 2026.** Worth establishing whether this is dormant or simply uncaptured.`,
    touches: [
      { date: '2025-11-06', text: 'LCI meeting. Next steps: complete security forms 5310C and 5305F; schedule a focused session with Naveen and Christine to prioritise use cases; open a contracting discussion.' },
      { date: '2025-11-20', text: 'LCI database walkthrough. Pavan to deliver a formal problem statement by Monday; submit the risk assessment form; request blob storage and SQL extraction permissions.' },
      { date: '2025-12-09', text: 'LCI team meeting. Revised 5305F due end of week; Jamie to file infrastructure tickets (VM, blob storage, local LLM); data profiling sessions to be scheduled with Christine, Denise and Alicia.' },
      { date: '2025-12-30', text: 'CEQA database analysis check-in with Christine and Mahesh. Data discovery, blob storage access, sandbox security compliance, team structure for AI implementation.' },
      { date: '2026-02-25', text: 'LCI meeting on the web assistant. ISI\'s Chris to review existing documentation (2-3 days) and assess feasibility; Azure DevOps and SharePoint access to be provisioned.' },
    ],
  },
  {
    name: 'Prenita Devi', email: 'prenita.devi@ftb.ca.gov',
    agency: 'ftb', agencyName: 'CA Franchise Tax Board (FTB)',
    product: 'platform', owner: 'Pavan', stage: 'demo-given',
    nextAction: 'Re-establish contact — demo given Sept 2025 with no recorded follow-up',
    notes: `Full platform demo on 2025-09-25: multi-agent orchestration, project management consolidation, tax form processing, a voice agent for refund and delinquency inquiries, and the guardrails/security framework. Implementation and pricing were discussed but **no follow-up was ever committed to in the notes**.

Separately, Infinite Solutions responded to FTB RFI-2526-PW-282 (suspense payments) in March 2026 — see \`bids/FTB-RFI-2526-Suspense-Payments\`. Whether the two threads are connected is not recorded.`,
    touches: [
      { date: '2025-09-25', text: 'Full platform demo: multi-agent orchestration, tax form processing, voice agent for refund/delinquency inquiries, guardrails and security. Implementation and pricing discussed; no next step recorded.' },
    ],
  },
  {
    name: 'John Wood', title: 'Contracting authority', agency: 'dds',
    agencyName: 'CA Dept of Developmental Services (DDS)',
    owner: 'Pavan', stage: 'won',
    notes: `**Existing Infinite Solutions SERVICES contract (~$3M)** — confirmed by Pavan 2026-08-21 as an Infinite Solutions engagement, not an InfiniteAI product sale. Recorded here because it is a live agency relationship and a warm path for product expansion, not as product revenue.

DDS supports 500,000 consumers across 21 regional centres. The October 2025 sync covered contract status, data quality issues (tied to $97M in recovered federal reimbursements), AI implementation opportunities, and a possible scope expansion to a new LOISS system. Naveen was the internal liaison.`,
    touches: [
      { date: '2025-10-22', text: 'Project sync and expansion discussion: existing $3M contract status, data quality issues, AI implementation opportunities, scope expansion to the LOISS system. Next step: meet John Wood on timeline extension and whether expansion goes via amendment or task order; build an AI demo from public documents.' },
    ],
  },
  {
    name: 'Amarjot (CTC)', agency: 'ctc', agencyName: 'CA Commission on Teacher Credentialing',
    product: 'assistants', owner: 'Pavan', stage: 'contacted',
    incomplete: true,
    notes: `Surname and email not recorded — **needs detail**. Discovery call 2025-09-18 covering InfiniteAI capabilities and the SLP/RFI2 procurement path.

**Their use case:** AI summarisation of educator misconduct case files for review committees, with PII protection. Agreed next step was for Amarjot to find shareable redacted case documents and for a follow-up demo focused on document summarisation. No record of that demo happening.`,
    touches: [
      { date: '2025-09-18', text: 'Discovery call: capabilities, SLP/RFI2 procurement path, and an educator-misconduct summarisation use case. Next: Amarjot to source redacted case documents; schedule a follow-up demo on summarisation and PII protection.' },
    ],
  },
]

// Caltrans already has contacts in the CRM; these are touches to append rather
// than people to create.
const CALTRANS_TOUCHES: { slug: string; stage?: CrmStage; nextAction?: string; touches: Touch[]; notes?: string }[] = [
  {
    slug: 'wesley-namikawa',
    stage: 'demo-given',
    nextAction: 'Confirm whether an RFP will follow RFI 20A0400 — response submitted Feb 2026, still "awaiting potential RFP"',
    notes: `Infinite Solutions relationship owner for the Caltrans ad hoc reporting pursuit (RFI 20A0400).

**The opportunity:** replace CGI Info Advantage before the FI$Cal go-live (2028-06-30). 1,740 active financial data users (57 average concurrent, 229 peak), data landing in Oracle Autonomous Data Warehouse on OCI. $17B budget department.

**What was proposed:** the Reporting module as COTS, fully managed SaaS on OCI co-located with their ADW, 22-26 weeks across 6 phases. **$289,500/yr** (named user: Typical $150, Super $250, Admin $300), 5-year TCO **$3.5M**, via CMAS / TDDC MSA. Differentiators: an Info Advantage migration toolkit (60-70% automated conversion), native Oracle ADW optimisation, FI$Cal dual-source support, and a Sacramento-local team.

Agency procurement contact: Ivan Cabreros, IT Contract Analyst, ivan.cabreros@dot.ca.gov, 279-234-2266.`,
    touches: [
      { date: '2026-02-17', text: 'RFI 20A0400 (Ad Hoc Reporting Solution) response submitted. Proposed $289,500/yr, 5-year TCO $3.5M, via CMAS / TDDC MSA.' },
      { date: '2026-04-17', text: 'Reporting platform collaboration session — CGI Advantage walkthrough with Chandravani and Sri Lata, covering how to overlay AI reporting on existing Caltrans data infrastructure. Demo targeted for May 4.' },
      { date: '2026-05-04', text: 'Reporting tool demo delivered to Caltrans (date approximate — Pavan noted 2026-08-21 that this demo happened but was never recorded). Demo queries are documented in the Nexus repo at docs/reporting/caltrans_demo_reference.md.' },
    ],
  },
]

async function main() {
  const existing = new Set((await listContacts()).map(c => c.slug))
  let created = 0, touched = 0, skipped = 0

  for (const e of ENGAGEMENTS) {
    const slug = slugify(e.name)
    if (existing.has(slug)) { skipped++; continue }
    if (DRY) {
      console.log(`  + ${e.name} (${e.agencyName}) stage=${e.stage} touches=${e.touches.length}${e.incomplete ? '  [needs detail]' : ''}`)
      created++; touched += e.touches.length; continue
    }
    await createContact({
      name: e.name, title: e.title, email: e.email,
      agency: e.agency, agencyName: e.agencyName, product: e.product, owner: e.owner,
      stage: e.stage, status: 'active',
      nextAction: e.nextAction, nextActionDue: e.nextActionDue,
      source: 'engagement-import', notes: e.notes, log: [],
    }, 'engagement-import', false)

    for (const t of e.touches) {
      await appendLog(slug, t.text, { via: 'granola', date: t.date })
    }
    // appendLog advances stage off `identified`; restore the true furthest point.
    await updateContact(slug, { stage: e.stage }, 'engagement-import', false)
    created++; touched += e.touches.length
  }

  for (const c of CALTRANS_TOUCHES) {
    if (!existing.has(c.slug)) { console.log(`  ! ${c.slug} not in CRM — skipped`); continue }
    if (DRY) { console.log(`  ~ ${c.slug}: +${c.touches.length} touches, stage=${c.stage}`); touched += c.touches.length; continue }
    for (const t of c.touches) await appendLog(c.slug, t.text, { via: 'bid-record', date: t.date })
    await updateContact(c.slug, {
      stage: c.stage, nextAction: c.nextAction, notes: c.notes, product: 'ad-hoc-reporting',
    }, 'engagement-import', false)
    touched += c.touches.length
  }

  console.log(`\n${DRY ? '[dry] would create' : 'created'}: ${created} contacts, ${touched} historical touches, skipped ${skipped}`)
  if (!DRY && (created || touched)) {
    await commitBatch(
      `import ${created} real agency engagements with ${touched} historical touches`,
      'engagement-import')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
