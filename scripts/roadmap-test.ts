/**
 * Roadmap unit tests — the derivation, the proof vocabulary, the ranking, the lint.
 *
 * Run:  node --experimental-strip-types --no-warnings scripts/run-ts.mjs scripts/roadmap-test.ts
 *
 * These exist because every rule in this layer is a rule about NOT lying, and a
 * rule about not lying is worthless unless something checks it. Three of the
 * cases below are regressions of bugs that actually shipped:
 *
 *   `flag_default reads a literal, not truthiness` — `di_grounding_enabled:
 *   bool = False` read as satisfied on the first dry run, because a source token
 *   is a non-empty string and "present and truthy" said yes.
 *
 *   `a stage set by machinery is not demand` — `crm/` is janitor-written, so a
 *   stage with no human `via` log line proves nothing.
 *
 *   `manual proof never reads done` — the escape hatch has to actually be a
 *   dead end, or it becomes a way to launder an unprovable claim into green.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  deriveState, deriveStage, lintRoadmap, rankBuildNext, reachableThroughUnlocks,
  parseProof, pullScore, daysBetween, roadmapDemandSignals, DEMAND_FRESH_DAYS,
  rowSignals,
  type RoadmapMilestone, type RoadmapRow, type DerivedEntry, type Stage,
} from '../src/lib/roadmap.ts'
import {
  evalCheck, evalHandoff, readContacts, readMeetings, resolveField, fieldMatches, literalMatches,
  type GitOps, type ProofContext, type HandoffOps,
} from '../src/lib/roadmap-proof.ts'
import { stageAtLeast, wantsProduct, CRM_STAGES } from '../src/lib/config.ts'
import { localToday, localDate, localDaysAgo } from '../src/lib/dates.ts'
import { maxGapHours, parseCron } from '../src/lib/cron-schedule.ts'
import { viewDeploy, type DeployState } from '../src/lib/deploy-state.ts'
import { evaluateBeat, lateAfterHours, findings, type Pipeline, type Evidence } from '../src/lib/heartbeat.ts'

/** A fixed "now" so nothing in here depends on the day it runs. */
const NOW = new Date('2026-09-08T12:00:00Z')
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const ahead = (d: number) => {
  const t = new Date(NOW.getTime() + d * 86_400_000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

type Item = Pick<RoadmapMilestone, 'kind' | 'target' | 'done'>
const st = (item: Item, d: DerivedEntry | undefined, ran = true) =>
  deriveState(item, d, ran, NOW).state

// ── deriveState: the ten Phase 12 cases, unchanged ──────────────────────────

test('deriveState: done short-circuits everything', () => {
  // Even past its target and with a broken repo, a recorded `done` is a fact.
  assert.equal(st({ kind: 'build', target: '2020-01-01', done: '2026-09-01' }, { slug: 'x', error: 'boom' }), 'done')
})

test('deriveState: a passed target is slipped without needing any repo', () => {
  const r = deriveState({ kind: 'build', target: ahead(-9) }, undefined, false, NOW)
  assert.equal(r.state, 'slipped')
  assert.match(r.reason, /passed 9d ago/)
})

test('deriveState: a check that never ran is unknown, never green', () => {
  assert.equal(st({ kind: 'build' }, undefined, false), 'unknown')
})

test('deriveState: a repo error is unknown, never green', () => {
  assert.equal(st({ kind: 'build' }, { slug: 'x', error: 'Nexus could not fetch origin' }), 'unknown')
})

test('deriveState: handoff consumed is the only handoff that means value', () => {
  assert.equal(st({ kind: 'handoff' }, { slug: 'x', handoffState: 'consumed' }), 'done')
})

test('deriveState: handoff merged with a consumer declared and absent is stranded — the worst outcome', () => {
  const r = deriveState({ kind: 'handoff', handoff: { consumedBy: 'src/lib/bid-sync.ts' } },
    { slug: 'x', handoffState: 'merged', handoffAgeDays: 98 }, true, NOW)
  assert.equal(r.state, 'stranded')
  assert.match(r.reason, /Merged 98d ago, still not consumed here/)
})

test('deriveState: handoff merged with NO consumer declared is not stranded — nothing was tested', () => {
  // 2026-09-09: three BidPro milestones read red "still not consumed here" and
  // none of them declared a consumed_by. The check never ran; the board asserted.
  const r = deriveState({ kind: 'handoff' },
    { slug: 'x', handoffState: 'merged', handoffRef: 'origin/staging', handoffAgeDays: 1 }, true, NOW)
  assert.equal(r.state, 'active')
  assert.match(r.reason, /merged at origin\/staging, no consumer declared — 1d ago/)
})

test('deriveState: handoff spec-sent long ago is idle', () => {
  assert.equal(st({ kind: 'handoff' }, { slug: 'x', handoffState: 'spec-sent', handoffAgeDays: 40 }), 'idle')
})

test('deriveState: handoff spec-sent recently is active', () => {
  assert.equal(st({ kind: 'handoff' }, { slug: 'x', handoffState: 'spec-sent', handoffAgeDays: 3 }), 'active')
})

test('deriveState: handoff with no resolved state is unknown', () => {
  assert.equal(st({ kind: 'handoff' }, { slug: 'x', handoffState: 'unknown' }), 'unknown')
})

test('deriveState: build with a near target and cold evidence is at-risk', () => {
  assert.equal(st({ kind: 'build', target: ahead(7) }, { slug: 'x', evidenceAgeDays: 24 }), 'at-risk')
})

test('deriveState: build with a near target and warm evidence is on-track', () => {
  assert.equal(st({ kind: 'build', target: ahead(7) }, { slug: 'x', evidenceAgeDays: 2 }), 'on-track')
})

test('deriveState: build cold for 30d with no near target is idle', () => {
  assert.equal(st({ kind: 'build' }, { slug: 'x', evidenceAgeDays: 63 }), 'idle')
})

test('deriveState: build that is moving but undated is no-target, not green-with-a-date', () => {
  assert.equal(st({ kind: 'build' }, { slug: 'x', evidenceAgeDays: 1 }), 'no-target')
})

test('deriveState: build with a far target and warm evidence is active', () => {
  assert.equal(st({ kind: 'build', target: ahead(40) }, { slug: 'x', evidenceAgeDays: 1 }), 'active')
})

test('deriveState: build with no evidence age resolved is unknown', () => {
  assert.equal(st({ kind: 'build' }, { slug: 'x' }), 'unknown')
})

// ── deriveState: Phase 13's proof branch ────────────────────────────────────

test('deriveState: a manual proof reads needs-person and NEVER done', () => {
  for (const kind of ['demand', 'decision'] as const) {
    const r = deriveState({ kind }, { slug: 'x', proofTrue: 0, proofTotal: 0 }, true, NOW)
    assert.equal(r.state, 'needs-person')
    assert.notEqual(r.state, 'done')
  }
})

test('deriveState: a fully satisfied proof is done', () => {
  assert.equal(st({ kind: 'decision' }, { slug: 'x', proofTrue: 2, proofTotal: 2 }), 'done')
})

test('deriveState: a partly satisfied proof with no target is no-target, not active', () => {
  // The whole board sits here today. It must not read green.
  assert.equal(st({ kind: 'demand' }, { slug: 'x', proofTrue: 1, proofTotal: 3 }), 'no-target')
})

test('deriveState: a proof with nothing true and a near target is at-risk', () => {
  assert.equal(st({ kind: 'decision', target: ahead(5) }, { slug: 'x', proofTrue: 0, proofTotal: 2 }), 'at-risk')
})

test('deriveState: a proof with nothing true and a far target is idle, not active', () => {
  assert.equal(st({ kind: 'demand', target: ahead(40) }, { slug: 'x', proofTrue: 0, proofTotal: 2 }), 'idle')
})

test('deriveState: an unevaluated proof is unknown', () => {
  assert.equal(st({ kind: 'decision' }, { slug: 'x' }), 'unknown')
})

// ── deriveStage ─────────────────────────────────────────────────────────────

const stage = (m: Item, d?: DerivedEntry): Stage => deriveStage(m, d, NOW)

test('deriveStage: a file with nothing else is framed', () => {
  assert.equal(stage({ kind: 'build' }, { slug: 'x' }), 'framed')
})

test('deriveStage: a target alone is committed', () => {
  assert.equal(stage({ kind: 'build', target: ahead(30) }, { slug: 'x' }), 'committed')
})

test('deriveStage: evidence that moved outranks a target — building, not committed', () => {
  assert.equal(stage({ kind: 'build', target: ahead(30) }, { slug: 'x', evidenceAgeDays: 3 }), 'building')
})

test('deriveStage: evidence colder than the idle window is not building', () => {
  assert.equal(stage({ kind: 'build' }, { slug: 'x', evidenceAgeDays: 60 }), 'framed')
})

test('deriveStage: an opened or merged handoff is building', () => {
  assert.equal(stage({ kind: 'handoff' }, { slug: 'x', handoffState: 'pr-opened' }), 'building')
  assert.equal(stage({ kind: 'handoff' }, { slug: 'x', handoffState: 'merged' }), 'building')
})

test('deriveStage: a partly true proof is building', () => {
  assert.equal(stage({ kind: 'demand' }, { slug: 'x', proofTrue: 1, proofTotal: 3 }), 'building')
})

test('deriveStage: a fully true proof is shipped', () => {
  assert.equal(stage({ kind: 'decision' }, { slug: 'x', proofTrue: 2, proofTotal: 2 }), 'shipped')
})

test('deriveStage: a consumed handoff is shipped', () => {
  assert.equal(stage({ kind: 'handoff' }, { slug: 'x', handoffState: 'consumed' }), 'shipped')
})

test('deriveStage: done recorded is shipped, and proven only after thirty clean days', () => {
  assert.equal(stage({ kind: 'build', done: '2026-09-01' }, { slug: 'x' }), 'shipped')
  assert.equal(stage({ kind: 'build', done: '2026-07-01' }, { slug: 'x' }), 'proven')
})

test('deriveStage: a satisfied `proven:` proof outranks everything', () => {
  assert.equal(stage({ kind: 'handoff' }, { slug: 'x', provenTrue: 1, provenTotal: 1 }), 'proven')
})

// ── the nine proof checks ───────────────────────────────────────────────────

/** A GitOps that answers from a literal map — no repo, no network, no clock. */
function fakeGit(spec: {
  missing?: string[]
  paths?: Record<string, string[]>
  files?: Record<string, string>
}): GitOps {
  return {
    async open(repo) {
      if (spec.missing?.includes(repo)) return { error: `${repo} not cloned on this machine` }
      return { dir: `/fake/${repo}`, ref: 'origin/main' }
    },
    async pathCount(_dir, _ref, paths) {
      const known = spec.paths?.[_dir.replace('/fake/', '')] ?? []
      return paths.filter(p => known.some(k => k.startsWith(p))).length
    },
    async grep(_dir, _ref, needle, sub) {
      return Object.entries(spec.files ?? {})
        .filter(([f, body]) => (!sub || f.startsWith(sub)) && body.includes(needle)).length
    },
    async show(_dir, _ref, file) {
      return spec.files?.[file] ?? null
    },
  }
}

let ROOT = ''
const ctx = (over: Partial<ProofContext> = {}): ProofContext => ({
  contacts: [], meetings: [], root: ROOT, git: fakeGit({}), ...over,
})

test('proof fixtures', async t => {
  ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'roadmap-proof-'))
  await fs.mkdir(path.join(ROOT, 'gtm'), { recursive: true })
  await fs.mkdir(path.join(ROOT, 'crm/contacts'), { recursive: true })
  await fs.mkdir(path.join(ROOT, 'crm/meetings'), { recursive: true })

  await fs.writeFile(path.join(ROOT, 'gtm/targets.md'), [
    '---', 'actuals:', '  loi: 0', 'phase0:',
    '  - id: price-list', '    done: false',
    '  - id: one-pagers', '    done: true',
    '---', '# targets', '',
  ].join('\n'))

  await fs.writeFile(path.join(ROOT, 'gtm/plan.md'), [
    '# plan',
    '[DECISION] Set the Candor price — $75K-$150K/yr collapsed to one number',
    '[DECISION] Pick a hosting project [RESOLVED 2026-09-01]',
    '',
  ].join('\n'))

  await t.test('file_exists', async () => {
    assert.equal((await evalCheck({ check: 'file_exists', path: 'gtm/targets.md' }, ctx())).ok, true)
    assert.equal((await evalCheck({ check: 'file_exists', path: 'products/nope.md' }, ctx())).ok, false)
  })

  await t.test('frontmatter_field: dotted paths and list-item addressing', async () => {
    const f = (field: string, equals: unknown) =>
      evalCheck({ check: 'frontmatter_field', path: 'gtm/targets.md', field, equals }, ctx())
    // `equals: true` means "present and truthy" — 0 is not.
    assert.equal((await f('actuals.loi', true)).ok, false)
    // `phase0[one-pagers].done` addresses a list item by its id.
    assert.equal((await f('phase0[one-pagers].done', true)).ok, true)
    assert.equal((await f('phase0[price-list].done', true)).ok, false)
    assert.equal((await f('phase0[nope].done', true)).ok, false)
    assert.equal((await f('actuals.loi', 0)).ok, true)
  })

  await t.test('decision_resolved: open means false, [RESOLVED] means true', async () => {
    const d = (contains: string) =>
      evalCheck({ check: 'decision_resolved', path: 'gtm/plan.md', contains }, ctx())
    assert.equal((await d('Set the Candor price')).ok, false)
    assert.equal((await d('Pick a hosting project')).ok, true)
    // A question nobody ever asked is not a question that was answered.
    assert.equal((await d('something never written')).ok, false)
  })

  await t.test('git_path_exists', async () => {
    const git = fakeGit({ paths: { Nexus: ['packages/services/prr/service.py'] } })
    assert.equal((await evalCheck(
      { check: 'git_path_exists', repo: 'Nexus', path: 'packages/services/prr/' }, ctx({ git }))).ok, true)
    assert.equal((await evalCheck(
      { check: 'git_path_exists', repo: 'Nexus', path: 'packages/gone/' }, ctx({ git }))).ok, false)
  })

  await t.test('git_grep: a repo this machine lacks is false WITH a reason, never a silent pass', async () => {
    const git = fakeGit({ missing: ['contract-management'] })
    const r = await evalCheck({ check: 'git_grep', repo: 'contract-management', pattern: 'x' }, ctx({ git }))
    assert.equal(r.ok, false)
    assert.match(r.detail, /not cloned on this machine/)
  })

  await t.test('git_grep: finds and misses', async () => {
    const git = fakeGit({ files: { 'app/api/route.ts': 'export const alerts = "alerts/summary"' } })
    assert.equal((await evalCheck({ check: 'git_grep', repo: 'r', pattern: 'alerts/summary' }, ctx({ git }))).ok, true)
    assert.equal((await evalCheck({ check: 'git_grep', repo: 'r', pattern: 'nothing' }, ctx({ git }))).ok, false)
  })

  await t.test('flag_default reads a LITERAL, not truthiness (regression, 2026-09-08)', async () => {
    // The bug: a source token is always a string, so "present and truthy" made
    // `= False` pass. This is the exact false green the whole layer exists to
    // prevent, and it shipped until the first dry run.
    const git = fakeGit({ files: { 'config.py': '    di_grounding_enabled: bool = False\n' } })
    const r = await evalCheck(
      { check: 'flag_default', repo: 'Nexus', path: 'config.py', name: 'di_grounding_enabled', equals: true },
      ctx({ git }))
    assert.equal(r.ok, false, '`= False` must not satisfy `equals: true`')
    assert.match(r.detail, /= False \(want true\)/)
  })

  await t.test('flag_default: Python True and TypeScript true both answer `equals: true`', async () => {
    for (const src of ['x: bool = True\n', 'x = true\n', 'const x: boolean = true\n']) {
      const git = fakeGit({ files: { 'c.py': src } })
      assert.equal((await evalCheck(
        { check: 'flag_default', repo: 'R', path: 'c.py', name: 'x', equals: true }, ctx({ git }))).ok,
        true, `failed for ${JSON.stringify(src)}`)
    }
  })

  await t.test('flag_default: an undeclared flag is false, not an error', async () => {
    const git = fakeGit({ files: { 'c.py': 'y = True\n' } })
    const r = await evalCheck(
      { check: 'flag_default', repo: 'R', path: 'c.py', name: 'x', equals: true }, ctx({ git }))
    assert.equal(r.ok, false)
    assert.match(r.detail, /not declared/)
  })

  await t.test('contact_stage: a stage set by machinery is NOT demand', async () => {
    const contacts = [
      { slug: 'human', product: 'prr', stage: 'demo-given' as const, worked: true },
      { slug: 'imported', product: 'prr', stage: 'demo-given' as const, worked: false },
    ]
    const ok = await evalCheck({ check: 'contact_stage', contact: 'human', at_least: 'contacted' }, ctx({ contacts }))
    assert.equal(ok.ok, true)
    // Same stage, no human `via` log line — crm/ is janitor-written.
    const machine = await evalCheck({ check: 'contact_stage', contact: 'imported', at_least: 'contacted' }, ctx({ contacts }))
    assert.equal(machine.ok, false)
    assert.match(machine.detail, /no human-`via` log line/)
    // A contact that does not exist is false, not a crash.
    assert.equal((await evalCheck({ check: 'contact_stage', contact: 'ghost', at_least: 'contacted' }, ctx({ contacts }))).ok, false)
  })

  await t.test('contact_stage: the threshold is a floor, not equality', async () => {
    const contacts = [{ slug: 'a', stage: 'verbal-commitment' as const, worked: true }]
    assert.equal((await evalCheck({ check: 'contact_stage', contact: 'a', at_least: 'contacted' }, ctx({ contacts }))).ok, true)
    assert.equal((await evalCheck({ check: 'contact_stage', contact: 'a', at_least: 'won' }, ctx({ contacts }))).ok, false)
  })

  await t.test('contacts_count: counts only human-worked contacts of that product', async () => {
    const contacts = [
      { slug: 'a', product: 'prr', stage: 'contacted' as const, worked: true },
      { slug: 'b', product: 'prr', stage: 'contacted' as const, worked: false },
      { slug: 'c', product: 'recruitment', stage: 'won' as const, worked: true },
      { slug: 'd', product: 'prr', stage: 'identified' as const, worked: true },
    ]
    const n = (count: number) => evalCheck(
      { check: 'contacts_count', product: 'prr', stage_at_least: 'contacted', count }, ctx({ contacts }))
    assert.equal((await n(1)).ok, true)
    assert.equal((await n(2)).ok, false, 'the machine-set and the identified contact must not count')
  })

  await t.test('contacts_count: `interested_in` counts, so one person can be demand for two products', async () => {
    // The OEIS case, reduced: filed under `assistants`, on record asking for PRA.
    const contacts = [
      { slug: 'pindy', product: 'assistants', interestedIn: ['prr', 'plan-review'],
        stage: 'verbal-commitment' as const, worked: true },
    ]
    const n = (product: string) => evalCheck(
      { check: 'contacts_count', product, stage_at_least: 'contacted', count: 1 }, ctx({ contacts }))
    assert.equal((await n('assistants')).ok, true, 'primary still counts')
    assert.equal((await n('prr')).ok, true, 'and so does the secondary ask')
    assert.equal((await n('plan-review')).ok, true)
    assert.equal((await n('procurement')).ok, false, 'interest is a list, not a wildcard')
  })

  await t.test('meeting_logged: category agency is part of the check, not a bonus', async () => {
    const meetings = [
      { slug: 'm1', title: 'OEIS AI demo', date: '2026-08-26', category: 'agency', agency: 'oeis', contacts: [] },
      { slug: 'm2', title: 'OEIS AI demo', date: '2026-08-27', category: 'other', agency: 'oeis', contacts: [] },
      { slug: 'm3', title: 'OEIS planning', date: '2026-08-28', category: 'agency', agency: 'oeis', contacts: [] },
    ]
    const m = (after?: string) => evalCheck(
      { check: 'meeting_logged', agency: 'oeis', title_match: '\\b(demo|walkthrough|poc|pilot)\\b', after },
      ctx({ meetings }))
    assert.equal((await m()).ok, true)
    // m2 is the same title on a later date but category `other`; m3 is agency
    // but not a demo. Only m1 qualifies, so an `after` past it fails.
    assert.equal((await m('2026-08-26')).ok, false)
    assert.equal((await m('2026-08-01')).ok, true)
  })

  await t.test('meeting_logged: a bad regex is false with a reason, not a crash', async () => {
    const r = await evalCheck({ check: 'meeting_logged', agency: 'x', title_match: '([' }, ctx())
    assert.equal(r.ok, false)
    assert.match(r.detail, /not a regex/)
  })

  await t.test('readContacts: an unknown stage is dropped and NAMED, not rounded to identified', async () => {
    await fs.writeFile(path.join(ROOT, 'crm/contacts/good.md'),
      '---\nstage: verbal-commitment\nproduct: assistants\n---\n# g\n\n## Log\n\n- **2026-08-26** — met _(via recall)_\n')
    await fs.writeFile(path.join(ROOT, 'crm/contacts/bogus.md'),
      '---\nstage: extremely-warm\n---\n# b\n')
    await fs.writeFile(path.join(ROOT, 'crm/contacts/seeded.md'),
      '---\nstage: contacted\n---\n# s\n\n## Log\n\n- **2026-08-01** — imported _(via lead-sync)_\n')

    const warnings: string[] = []
    const got = await readContacts(ROOT, w => warnings.push(w))
    assert.deepEqual(got.map(c => c.slug).sort(), ['good', 'seeded'])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /extremely-warm/)
    // `verbal-commitment` now survives — it is in CRM_STAGES as of 2026-09-08.
    assert.equal(got.find(c => c.slug === 'good')!.stage, 'verbal-commitment')
    assert.equal(got.find(c => c.slug === 'good')!.worked, true)
    assert.equal(got.find(c => c.slug === 'seeded')!.worked, false, 'lead-sync is not a human touch')
  })

  await t.test('readMeetings reads category, agency and title', async () => {
    await fs.writeFile(path.join(ROOT, 'crm/meetings/2026-08-26-oeis.md'),
      '---\ndate: 2026-08-26\ncategory: agency\nagency: oeis\ntitle: OEIS demo\ncontacts:\n  - pindi-oeis\n---\n# m\n')
    const got = await readMeetings(ROOT)
    assert.equal(got.length, 1)
    assert.equal(got[0].category, 'agency')
    assert.equal(got[0].agency, 'oeis')
    assert.deepEqual(got[0].contacts, ['pindi-oeis'])
  })

  await fs.rm(ROOT, { recursive: true, force: true })
})

// ── parsing ─────────────────────────────────────────────────────────────────

test('parseProof: `manual` is null (needs a person); a list is checks; junk is dropped', () => {
  assert.equal(parseProof('manual'), null)
  assert.deepEqual(parseProof(undefined), [])
  assert.deepEqual(parseProof([{ check: 'not_a_real_check', path: 'x' }]), [])
  assert.deepEqual(parseProof([{ check: 'file_exists', path: 'a.md' }]), [{ check: 'file_exists', path: 'a.md' }])
})

test('stageAtLeast: verbal-commitment sits between pilot-discussion and won', () => {
  assert.ok(stageAtLeast('verbal-commitment', 'pilot-discussion'))
  assert.ok(stageAtLeast('won', 'verbal-commitment'))
  assert.ok(!stageAtLeast('pilot-discussion', 'verbal-commitment'))
  assert.ok(CRM_STAGES.includes('verbal-commitment'))
  // Terminal non-`won` stages are outside the ladder: `lost` is not a lesser win.
  assert.ok(!stageAtLeast('lost', 'contacted'))
})

test('wantsProduct: interest is additive to attribution, never a replacement', () => {
  const pindy = { product: 'assistants', interestedIn: ['prr', 'plan-review'] }
  assert.equal(wantsProduct(pindy, 'assistants'), true, 'primary')
  assert.equal(wantsProduct(pindy, 'prr'), true, 'secondary')
  assert.equal(wantsProduct(pindy, 'recruitment'), false)
  // Absent list, absent product: neither may throw or become a wildcard.
  assert.equal(wantsProduct({ product: 'prr' }, 'prr'), true)
  assert.equal(wantsProduct({ product: 'prr' }, 'plan-review'), false)
  assert.equal(wantsProduct({}, 'prr'), false)
  assert.equal(wantsProduct({ interestedIn: [] }, 'prr'), false)
  // The regression this shipped for: a row whose product NOBODY carries as
  // primary can still score, which is the whole reason the field exists.
  assert.equal(wantsProduct(pindy, 'plan-review'), true)
})

test('fieldMatches vs literalMatches: the two coercion rules are different on purpose', () => {
  assert.equal(fieldMatches(0, true), false)
  assert.equal(fieldMatches('anything', true), true)
  assert.equal(literalMatches('False', true), false, 'the flag_default regression')
  assert.equal(literalMatches('True', true), true)
})

test('resolveField: dotted, list-addressed, and absent', () => {
  const data = { a: { b: 1 }, list: [{ id: 'x', done: true }] }
  assert.equal(resolveField(data, 'a.b'), 1)
  assert.equal(resolveField(data, 'list[x].done'), true)
  assert.equal(resolveField(data, 'list[nope].done'), undefined)
  assert.equal(resolveField(data, 'a.b.c.d'), undefined)
})

test('localDate is the LOCAL calendar day at every hour (regression, 2026-09-08)', () => {
  // The bug: `new Date().toISOString().slice(0, 10)` is the UTC day, so in any
  // negative-offset zone it returns TOMORROW for the last hours of the evening.
  // It shipped: resolveDecision stamped `[RESOLVED 2026-09-09]` from a commit
  // made at 18:04 local on 2026-09-08.
  //
  // TZ-independent by construction: whatever hour of 2026-09-08 you build, the
  // local calendar day is 2026-09-08. The UTC slice fails this for some hour in
  // every zone that is not UTC, which is the whole point.
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 8, 8, h, 30, 0)
    assert.equal(localDate(d), '2026-09-08', `hour ${h} local`)
  }
  assert.equal(localToday(new Date(2026, 8, 8, 18, 4, 0)), '2026-09-08')
  // Month and year boundaries are where an off-by-one day does the most damage.
  assert.equal(localDate(new Date(2026, 0, 1, 23, 59, 0)), '2026-01-01')
  assert.equal(localDate(new Date(2025, 11, 31, 22, 0, 0)), '2025-12-31')
})

test('localDaysAgo walks calendar days, not 86,400,000ms', () => {
  const now = new Date(2026, 8, 8, 22, 58, 0)
  assert.equal(localDaysAgo(0, now), '2026-09-08')
  assert.equal(localDaysAgo(1, now), '2026-09-07')
  assert.equal(localDaysAgo(90, now), '2026-06-10')
  // Across a DST fall-back a day is 25 hours; subtracting fixed milliseconds
  // would land on the wrong date. 2026-11-01 is the US transition.
  assert.equal(localDaysAgo(1, new Date(2026, 10, 2, 0, 30, 0)), '2026-11-01')
})

test('daysBetween counts calendar days in local time', () => {
  assert.equal(daysBetween(new Date('2026-09-08T23:00:00'), '2026-09-10'), 2)
  assert.equal(daysBetween(new Date('2026-09-08T01:00:00'), '2026-09-01'), -7)
})

// ── the ranking ─────────────────────────────────────────────────────────────

function milestone(over: Partial<RoadmapMilestone> & { slug: string; row: string }): RoadmapMilestone {
  return {
    name: over.slug, kind: 'build', horizon: 'now', unlocks: [], blockedOn: [],
    evidence: [], proof: [], proven: [], body: '', state: 'no-target', stage: 'framed',
    reason: '', ...over,
  }
}

function row(slug: string, milestones: RoadmapMilestone[], score: number): RoadmapRow {
  return {
    slug, name: slug, group: 'nexus', kind: 'product', northStar: 'star',
    repos: [], evidence: [], body: '', milestones,
    pull: { byStage: {}, total: 0, warm: 0, meetings90: 0, score },
  }
}

test('reachableThroughUnlocks: transitive, excludes self, survives a cycle', () => {
  const g = new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]])
  assert.deepEqual(Array.from(reachableThroughUnlocks('a', g)).sort(), ['b', 'c'])
})

test('rankBuildNext: a fixed fixture ranks in a known order', () => {
  // a → b → d, a → c. Row A carries all the pull; row B carries none.
  //   a: reach 3 (b,c,d), meanPull 1 → 3 × 2      = 6
  //   b: reach 1 (d),     meanPull 1 → 1 × 2      = 2
  //   e: reach 0, waiting on Pavan   → 0 + 1      = 1
  //   c, d: reach 0, no urgency                   = 0, tie broken on slug
  const rows = [
    row('A', [
      milestone({ slug: 'a', row: 'A', unlocks: ['b', 'c'] }),
      milestone({ slug: 'b', row: 'A', unlocks: ['d'] }),
      milestone({ slug: 'c', row: 'A' }),
      milestone({ slug: 'd', row: 'A' }),
    ], 10),
    row('B', [milestone({ slug: 'e', row: 'B', waitingOn: 'Pavan' })], 0),
  ]
  const ranked = rankBuildNext(rows, NOW)
  assert.deepEqual(ranked.map(r => r.slug), ['a', 'b', 'e', 'c', 'd'])
  assert.deepEqual(ranked.map(r => Number(r.score.toFixed(2))), [6, 2, 1, 0, 0])
  assert.match(ranked[0].reason, /unlocks 3 milestones/)
  assert.match(ranked[2].reason, /waiting on you/)
})

test('rankBuildNext: unlocking already-shipped work earns nothing', () => {
  const rows = [row('A', [
    milestone({ slug: 'a', row: 'A', unlocks: ['b'] }),
    milestone({ slug: 'b', row: 'A', stage: 'shipped' }),
  ], 0)]
  const ranked = rankBuildNext(rows, NOW)
  // `b` is shipped, so it is neither ranked nor counted as reach for `a`.
  assert.deepEqual(ranked.map(r => r.slug), ['a'])
  assert.equal(ranked[0].score, 0)
  assert.match(ranked[0].reason, /unlocks nothing yet/)
})

test('rankBuildNext: urgency — overdue outranks near, near outranks waiting', () => {
  const rows = [row('A', [
    milestone({ slug: 'overdue', row: 'A', target: ahead(-3), daysToTarget: -3 }),
    milestone({ slug: 'near', row: 'A', target: ahead(5), daysToTarget: 5 }),
    milestone({ slug: 'waiting', row: 'A', waitingOn: 'Pavan' }),
  ], 0)]
  assert.deepEqual(rankBuildNext(rows, NOW).map(r => r.slug), ['overdue', 'near', 'waiting'])
})

test('pullScore: identified is worth nothing, a meeting is worth two stage-points', () => {
  assert.equal(pullScore({ identified: 95 }, 0), 0)
  assert.equal(pullScore({ contacted: 1 }, 0), 1)
  assert.equal(pullScore({}, 3), 6)
  assert.equal(pullScore({ 'verbal-commitment': 1 }, 1), 7)
})

// ── the lint ────────────────────────────────────────────────────────────────

const lintRow = (over: Partial<RoadmapRow> = {}): RoadmapRow => ({
  slug: 'r', name: 'R', group: 'nexus', kind: 'product', northStar: 'a star',
  repos: [], evidence: [], body: '', milestones: [], ...over,
})
type LintM = Parameters<typeof lintRoadmap>[1][number]
const lintM = (over: Partial<LintM> & { slug: string }): LintM => ({
  row: 'r', kind: 'build', unlocks: [], blockedOn: [],
  evidence: [{ repo: 'Nexus', path: 'p/' }], proof: [], ...over,
})

test('rowSignals: the two warnings are mirrors, and both need a product to mean anything', () => {
  const r = (product: string | undefined, inv30: number, inv90: number, score: number) =>
    ({ product, investment: { 30: inv30, 90: inv90 }, pull: { score } }) as Parameters<typeof rowSignals>[0]

  // Effort with nobody asking.
  assert.deepEqual(rowSignals(r('prr', 13, 165, 0)),
    { investedWithoutPull: true, demandWithoutInvestment: false })

  // The squeeze: somebody warm asking, nobody building. The real Attest numbers.
  assert.deepEqual(rowSignals(r('plan-review', 8, 17, 9)),
    { investedWithoutPull: false, demandWithoutInvestment: true })

  // Being built AND wanted is the state we want; neither fires. Real Candor.
  assert.deepEqual(rowSignals(r('prr', 13, 165, 7)),
    { investedWithoutPull: false, demandWithoutInvestment: false })

  // A row with no product has no demand column, so NEITHER may fire — BidPro's
  // `pull 0` is correct by definition (internal, Pavan 2026-09-08), not a finding.
  assert.deepEqual(rowSignals(r(undefined, 0, 372, 0)),
    { investedWithoutPull: false, demandWithoutInvestment: false })

  // Warm but only just: below the floor, quiet is a defensible answer.
  assert.equal(rowSignals(r('ad-hoc-reporting', 26, 99, 3)).demandWithoutInvestment, false)
  // And a row can be quiet at exactly the threshold without firing.
  assert.equal(rowSignals(r('prr', 10, 20, 9)).demandWithoutInvestment, false)
  assert.equal(rowSignals(r('prr', 9, 20, 9)).demandWithoutInvestment, true)
})

test('lint: a clean board produces no errors', () => {
  assert.deepEqual(lintRoadmap([lintRow()], [lintM({ slug: 'a' })]), [])
})

test('lint: a row with no north star fails', () => {
  const errs = lintRoadmap([lintRow({ northStar: '' })], [lintM({ slug: 'a' })])
  assert.equal(errs.length, 1)
  assert.match(errs[0], /no north_star/)
})

test('lint: a dangling unlocks fails — it silently demotes real work in the ranking', () => {
  const errs = lintRoadmap([lintRow()], [lintM({ slug: 'a', unlocks: ['ghost'] })])
  assert.match(errs.join(), /unlocks "ghost" does not exist/)
})

test('lint: a dangling blocked_on fails', () => {
  const errs = lintRoadmap([lintRow()], [lintM({ slug: 'a', blockedOn: ['ghost'] })])
  assert.match(errs.join(), /blocked_on "ghost" does not exist/)
})

test('lint: a milestone pointing at a row that does not exist fails', () => {
  const errs = lintRoadmap([lintRow()], [lintM({ slug: 'a', row: 'nope' })])
  assert.match(errs.join(), /row "nope" does not exist/)
})

test('lint: a build milestone with no evidence fails', () => {
  const errs = lintRoadmap([lintRow()], [lintM({ slug: 'a', evidence: [] })])
  assert.match(errs.join(), /kind build with no evidence path/)
})

test('lint: a demand/decision with an empty proof list fails, but `manual` passes', () => {
  for (const kind of ['demand', 'decision'] as const) {
    const bad = lintRoadmap([lintRow()], [lintM({ slug: 'a', kind, evidence: [], proof: [] })])
    assert.match(bad.join(), /with no proof/)
    const manual = lintRoadmap([lintRow()], [lintM({ slug: 'a', kind, evidence: [], proof: null })])
    assert.deepEqual(manual, [], '`proof: manual` is a legal answer')
  }
})

test('lint: a proof pattern that will not compile fails at lint, not as `unknown`', () => {
  // `(?i)` is a Python inline flag; JavaScript throws on it. Shipped in
  // attest-oeis-demo and only visible as a buried `unknown` reason.
  const bad = milestone({
    slug: 'a', row: 'R', kind: 'demand',
    proof: [{ check: 'meeting_logged', agency: 'oeis', title_match: '(?i)(demo)' }],
  })
  const errs = lintRoadmap([row('R', [bad], 0)], [bad])
  assert.equal(errs.length, 1)
  assert.match(errs[0], /title_match .* is not a regex/)
  const good = milestone({
    slug: 'a', row: 'R', kind: 'demand',
    proof: [{ check: 'meeting_logged', agency: 'oeis', title_match: '(demo)' }],
  })
  assert.deepEqual(lintRoadmap([row('R', [good], 0)], [good]), [])
})

test('lint: a cycle in unlocks fails and names the loop', () => {
  const errs = lintRoadmap([lintRow()], [
    lintM({ slug: 'a', unlocks: ['b'] }),
    lintM({ slug: 'b', unlocks: ['c'] }),
    lintM({ slug: 'c', unlocks: ['a'] }),
  ])
  assert.equal(errs.filter(e => e.startsWith('cycle')).length, 1)
  assert.match(errs.find(e => e.startsWith('cycle'))!, /a → b → c → a/)
})

test('lint: a diamond is not a cycle', () => {
  // a→b, a→c, b→d, c→d visits `d` twice without ever being on the stack twice.
  assert.deepEqual(lintRoadmap([lintRow()], [
    lintM({ slug: 'a', unlocks: ['b', 'c'] }),
    lintM({ slug: 'b', unlocks: ['d'] }),
    lintM({ slug: 'c', unlocks: ['d'] }),
    lintM({ slug: 'd' }),
  ]), [])
})

// ── demand → Today ──────────────────────────────────────────────────────────

const contact = (over: Partial<{
  name: string; product: string; interestedIn: string[]
  stage: string; lastTouched: string; worked: boolean
}> = {}) => ({
  name: 'A', product: 'prr', stage: 'demo-given', lastTouched: ago(3).slice(0, 10), worked: true,
  ...over,
}) as Parameters<typeof roadmapDemandSignals>[1][number]

const demandRow = (milestones: RoadmapMilestone[]) => ({
  ...row('R', milestones, 0), product: 'prr',
})

test('demand: a warm, recently-touched, human-worked contact surfaces the row\'s next `now` milestone', () => {
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  const got = roadmapDemandSignals(rows, [contact()], NOW)
  assert.equal(got.length, 1)
  assert.equal(got[0].next?.slug, 'a')
  assert.equal(got[0].daysAgo, 3)
})

test('demand: a machine-set stage is not demand', () => {
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  assert.deepEqual(roadmapDemandSignals(rows, [contact({ worked: false })], NOW), [])
})

test('demand: a cold contact is not demand, however warm the stage', () => {
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  const stale = contact({ stage: 'won', lastTouched: ago(DEMAND_FRESH_DAYS + 1).slice(0, 10) })
  assert.deepEqual(roadmapDemandSignals(rows, [stale], NOW), [])
})

test('demand: below `demo-given` is not a buying signal', () => {
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  assert.deepEqual(roadmapDemandSignals(rows, [contact({ stage: 'contacted' })], NOW), [])
})

test('demand: no open `now` work means nothing to surface', () => {
  // Warm buyer, but every `now` milestone is shipped — there is no move to make.
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now', stage: 'shipped' })])]
  assert.deepEqual(roadmapDemandSignals(rows, [contact()], NOW), [])
  // …and `next`/`later` work does not count as something to do today.
  const later = [demandRow([milestone({ slug: 'b', row: 'R', horizon: 'later' })])]
  assert.deepEqual(roadmapDemandSignals(later, [contact()], NOW), [])
})

test('demand: a row with no product is skipped — pull is meaningless there', () => {
  const rows = [row('R', [milestone({ slug: 'a', row: 'R', horizon: 'now' })], 0)]
  assert.deepEqual(roadmapDemandSignals(rows, [contact({ product: undefined })], NOW), [])
})

test('demand: one signal per row, the warmest contact', () => {
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  const got = roadmapDemandSignals(rows, [
    contact({ name: 'Cool', stage: 'demo-given' }),
    contact({ name: 'Hot', stage: 'won' }),
  ], NOW)
  assert.equal(got.length, 1)
  assert.equal(got[0].contactName, 'Hot')
})

test('demand: a future last_touched is ignored rather than counted as fresh', () => {
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  const future = contact({ lastTouched: ahead(5) })
  assert.deepEqual(roadmapDemandSignals(rows, [future], NOW), [])
})

test('demand: a secondary `interested_in` is demand for that row too', () => {
  // Filed under another product, asking for this one. Before `interested_in`
  // this row saw nobody at all (2026-09-08).
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  const elsewhere = contact({ name: 'Pindy', product: 'assistants', interestedIn: ['prr'] })
  const got = roadmapDemandSignals(rows, [elsewhere], NOW)
  assert.equal(got.length, 1)
  assert.equal(got[0].contactName, 'Pindy')
})

test('demand: interest in some OTHER product is still not demand for this row', () => {
  const rows = [demandRow([milestone({ slug: 'a', row: 'R', horizon: 'now' })])]
  const other = contact({ product: 'assistants', interestedIn: ['plan-review'] })
  assert.deepEqual(roadmapDemandSignals(rows, [other], NOW), [])
})

// ── handoffs ────────────────────────────────────────────────────────────────
// These exist because until 2026-09-08 `checkHandoff` reached for git directly
// and could not be tested at all — five milestones, every BidPro handoff, with
// zero coverage. The fake below is the whole point of the `HandoffOps` seam.

interface FakeCfg {
  /** repo name → what `open` answers. */
  repos?: Record<string, { refs: string[]; narrow?: boolean } | { error: string }>
  /** `dir@ref` → needles present. A bare needle is "in some code file";
   *  `needle#path` says exactly where, so pathspecs can be exercised. */
  hits?: Record<string, string[]>
  /** `dir@ref@needle` → ISO instant it first appeared. */
  first?: Record<string, string>
  /** spec path → ISO instant. Absent key means the file does not exist. */
  specs?: Record<string, string>
}

/** A toy git pathspec: positive entries are prefixes; `:!x` excludes — `*.md`
 *  by suffix, a directory by prefix. Enough to prove the logic composes them. */
const inPathspec = (file: string, specs: string[] = []) => {
  const hit = (p: string) => p.startsWith('*')
    ? file.endsWith(p.slice(1))
    : file === p || file.startsWith(p.replace(/\/$/, '') + '/')
  const pos = specs.filter(s => !s.startsWith(':!'))
  const neg = specs.filter(s => s.startsWith(':!')).map(s => s.slice(2))
  return (pos.length === 0 || pos.some(hit)) && !neg.some(hit)
}

const fakeOps = (cfg: FakeCfg): HandoffOps => ({
  async open(name) {
    const r = cfg.repos?.[name]
    if (!r) return { error: `${name} not configured` }
    if ('error' in r) return r
    return { dir: name, refs: r.refs, narrow: r.narrow ?? false }
  },
  async grep(dir, ref, needle, pathspec) {
    return (cfg.hits?.[`${dir}@${ref}`] ?? [])
      .filter(h => h === needle || h.startsWith(`${needle}#`))
      .map(h => h.includes('#') ? h.slice(needle.length + 1) : 'src/somewhere.ts')
      .filter(f => inPathspec(f, pathspec))
  },
  async firstSeen(dir, ref, needle) {
    return cfg.first?.[`${dir}@${ref}@${needle}`] ?? null
  },
  async specAt(relPath) {
    return Object.prototype.hasOwnProperty.call(cfg.specs ?? {}, relPath)
      ? cfg.specs![relPath]
      : null
  },
})

const QT = { repos: { qual_table_automations: { refs: ['origin/main', 'origin/staging'] } } }

test('handoff: a literal on the default ref is merged, and says which ref', async () => {
  const got = await evalHandoff({ landed: 'bid_plan_items' }, ['qual_table_automations'], fakeOps({
    ...QT,
    hits: { 'qual_table_automations@origin/main': ['bid_plan_items'] },
    first: { 'qual_table_automations@origin/main@bid_plan_items': '2026-08-01T00:00:00Z' },
  }), NOW)
  assert.equal(got.state, 'merged')
  assert.equal(got.ref, 'origin/main')
})

test('handoff: found on staging when main does not have it — the BidPro case', async () => {
  // The whole reason for the 2026-09-08 change: their team merges to `staging`
  // and origin/main moves separately, so checking one ref rendered `unknown`.
  const got = await evalHandoff({ landed: 'bid_plan_items' }, ['qual_table_automations'], fakeOps({
    ...QT,
    hits: { 'qual_table_automations@origin/staging': ['bid_plan_items'] },
    first: { 'qual_table_automations@origin/staging@bid_plan_items': '2026-09-01T00:00:00Z' },
  }), NOW)
  assert.equal(got.state, 'merged')
  assert.equal(got.ref, 'origin/staging', 'the ref must be reported, not implied')
})

test('handoff: the default ref wins when BOTH have the literal', async () => {
  // `merged on main` is a stronger claim than `merged on staging`; if both are
  // true the board must report the stronger one.
  const got = await evalHandoff({ landed: 'x' }, ['qual_table_automations'], fakeOps({
    ...QT,
    hits: {
      'qual_table_automations@origin/main': ['x'],
      'qual_table_automations@origin/staging': ['x'],
    },
  }), NOW)
  assert.equal(got.ref, 'origin/main')
})

test('handoff: not found names every ref searched, and flags a single-branch clone', async () => {
  const narrow = await evalHandoff({ landed: 'awarded_at' }, ['qual_table_automations'], fakeOps({
    repos: { qual_table_automations: { refs: ['origin/main'], narrow: true } },
  }), NOW)
  assert.match(narrow.error!, /"awarded_at" not found in code at origin\/main/)
  assert.match(narrow.error!, /single-branch/)

  const wide = await evalHandoff({ landed: 'awarded_at' }, ['qual_table_automations'], fakeOps({
    ...QT,
  }), NOW)
  assert.match(wide.error!, /origin\/main or origin\/staging/)
  assert.doesNotMatch(wide.error!, /single-branch/, 'a wide clone must not be blamed')
})

test('handoff: consumed outranks merged — value, not motion', async () => {
  // Merged-but-unconsumed is the worst outcome on this board: they did the work
  // and nothing picked it up. The two must never blur. Both sides are present
  // here; the case where only ours is comes two tests down.
  const got = await evalHandoff(
    { landed: 'status_changed_at', consumedBy: 'scripts/sync-bids.ts' },
    ['qual_table_automations'],
    fakeOps({
      repos: {
        ...QT.repos,
        'command-center': { refs: ['origin/main'] },
      },
      hits: {
        'command-center@origin/main': ['status_changed_at#scripts/sync-bids.ts'],
        'qual_table_automations@origin/main': ['status_changed_at'],
      },
    }), NOW)
  assert.equal(got.state, 'consumed')
  assert.equal(got.ref, 'origin/main', 'consumed is merged plus a reference here, so their ref still applies')
})

test('handoff: a reference OUTSIDE consumed_by does not count as consumed', async () => {
  const got = await evalHandoff(
    { landed: 'status_changed_at', consumedBy: 'scripts/sync-bids.ts' },
    ['qual_table_automations'],
    fakeOps({
      repos: { ...QT.repos, 'command-center': { refs: ['origin/main'] } },
      // present in command-center, but not under the declared path
      hits: {
        'command-center@origin/main': ['status_changed_at'],
        'qual_table_automations@origin/main': ['status_changed_at'],
      },
      first: { 'qual_table_automations@origin/main@status_changed_at': '2026-08-01T00:00:00Z' },
    }), NOW)
  assert.equal(got.state, 'merged', 'falls back to merged, never to consumed')
})

test('handoff: an unreachable command-center does not block the merged answer', async () => {
  const got = await evalHandoff(
    { landed: 'x', consumedBy: 'scripts/a.ts' }, ['qual_table_automations'], fakeOps({
      ...QT,   // command-center deliberately not configured -> open() errors
      hits: { 'qual_table_automations@origin/main': ['x'] },
    }), NOW)
  assert.equal(got.state, 'merged')
})

test('handoff: a literal that appears only in prose is NOT landed — the spec is not the table', async () => {
  // 2026-09-08: all four BidPro literals read `merged` on staging in the same
  // second. Each was matching docs/unified-bid-system-plan.md — our own plan,
  // PR'd into their repo. The board said they had shipped; they had received.
  const ops = fakeOps({
    ...QT,
    hits: { 'qual_table_automations@origin/staging': ['bid_plan_items#docs/unified-bid-system-plan.md'] },
    first: { 'qual_table_automations@origin/staging@bid_plan_items': ago(1) },
    specs: { 'operations/workflows/bidpro-docs/unified-bid-system-plan.md': ago(1) },
  })
  const bare = await evalHandoff({ landed: 'bid_plan_items' }, ['qual_table_automations'], ops, NOW)
  assert.equal(bare.state, undefined)
  assert.match(bare.error!, /only in prose at origin\/staging .*docs\/unified-bid-system-plan\.md/)

  // With the spec declared, the honest state is the one below merged.
  const spec = await evalHandoff(
    { landed: 'bid_plan_items', spec: 'operations/workflows/bidpro-docs/unified-bid-system-plan.md' },
    ['qual_table_automations'], ops, NOW)
  assert.equal(spec.state, 'spec-sent')
  assert.equal(spec.ageDays, 1)
})

test('handoff: consumed requires merged — a placeholder on our side proves nothing', async () => {
  // Our wire type declares every field we ASKED for (`status_changed_at?:`
  // under "asked for in the handoff, not served yet"). Deciding `consumed` from
  // our repo alone would have gone green the day the request was typed.
  const got = await evalHandoff(
    { landed: 'status_changed_at', consumedBy: 'src/lib/bid-sync.ts' },
    ['qual_table_automations'],
    fakeOps({
      repos: { ...QT.repos, 'command-center': { refs: ['origin/main'] } },
      hits: { 'command-center@origin/main': ['status_changed_at#src/lib/bid-sync.ts'] },
    }), NOW)
  assert.notEqual(got.state, 'consumed')
  assert.match(got.error!, /not found in code/)
})

test('handoff: consumed carries their ref and file — it is merged plus a reference here', async () => {
  const got = await evalHandoff(
    { landed: 'status_changed_at', consumedBy: 'src/lib/bid-sync.ts' },
    ['qual_table_automations'],
    fakeOps({
      repos: { ...QT.repos, 'command-center': { refs: ['origin/main'] } },
      hits: {
        'command-center@origin/main': ['status_changed_at#src/lib/bid-sync.ts'],
        'qual_table_automations@origin/staging': ['status_changed_at#alembic/versions/085_status_changed_at.py'],
      },
    }), NOW)
  assert.equal(got.state, 'consumed')
  assert.equal(got.ref, 'origin/staging')
  assert.equal(got.file, 'alembic/versions/085_status_changed_at.py')
})

test('handoff: a reference in OUR prose does not count as consumed either', async () => {
  const got = await evalHandoff(
    { landed: 'status_changed_at', consumedBy: 'docs' },
    ['qual_table_automations'],
    fakeOps({
      repos: { ...QT.repos, 'command-center': { refs: ['origin/main'] } },
      hits: {
        'command-center@origin/main': ['status_changed_at#docs/handoff.md'],
        'qual_table_automations@origin/main': ['status_changed_at#app/models.py'],
      },
    }), NOW)
  assert.equal(got.state, 'merged')
})

test('handoff: landed_in narrows the search, and a match outside it is named', async () => {
  const fixtureOnly = fakeOps({
    ...QT,
    hits: { 'qual_table_automations@origin/main': ['bid_plan_items#tests/fixtures/plan.json'] },
  })
  const out = await evalHandoff({ landed: 'bid_plan_items', landedIn: 'alembic/' },
    ['qual_table_automations'], fixtureOnly, NOW)
  assert.equal(out.state, undefined)
  assert.match(out.error!, /only outside alembic\/ .*tests\/fixtures\/plan\.json/)

  const migration = fakeOps({
    ...QT,
    hits: { 'qual_table_automations@origin/main': [
      'bid_plan_items#tests/fixtures/plan.json', 'bid_plan_items#alembic/versions/086.py'] },
  })
  const got = await evalHandoff({ landed: 'bid_plan_items', landedIn: 'alembic/' },
    ['qual_table_automations'], migration, NOW)
  assert.equal(got.state, 'merged')
  assert.equal(got.file, 'alembic/versions/086.py')
})

test('handoff: pr and spec fall through in order, and each carries its age', async () => {
  const pr = await evalHandoff({ pr: 'https://github.com/x/y/pull/1' }, ['r'],
    fakeOps({ repos: { r: { refs: ['origin/main'] } } }), NOW)
  assert.equal(pr.state, 'pr-opened')

  const spec = await evalHandoff({ spec: 'operations/workflows/a.md' }, ['r'], fakeOps({
    repos: { r: { refs: ['origin/main'] } },
    specs: { 'operations/workflows/a.md': '2026-08-29T00:00:00Z' },
  }), NOW)
  assert.equal(spec.state, 'spec-sent')
  assert.equal(spec.ageDays, 10, 'age is measured from the injected now, not the wall clock')
})

test('handoff: a declared spec that does not exist is an error, not spec-sent', async () => {
  const got = await evalHandoff({ spec: 'operations/workflows/missing.md' }, ['r'],
    fakeOps({ repos: { r: { refs: ['origin/main'] } } }), NOW)
  assert.match(got.error!, /Spec .*missing\.md not found/)
  assert.equal(got.state, undefined)
})

test('handoff: a missing landed literal still yields to pr/spec rather than erroring', async () => {
  // A handoff can declare both. If the literal is absent but a PR is open, the
  // honest answer is pr-opened — not "not found".
  const got = await evalHandoff({ landed: 'nope', pr: 'https://x/1' }, ['qual_table_automations'],
    fakeOps({ ...QT }), NOW)
  assert.equal(got.state, 'pr-opened')
  assert.equal(got.error, undefined)
})

test('handoff: no repo on the row, and an unusable repo, are different errors', async () => {
  const noRepo = await evalHandoff({ landed: 'x' }, [], fakeOps({}), NOW)
  assert.match(noRepo.error!, /No repo declared/)

  const broken = await evalHandoff({ landed: 'x' }, ['r'],
    fakeOps({ repos: { r: { error: 'r not cloned on this machine' } } }), NOW)
  assert.match(broken.error!, /not cloned/)
})

test('handoff: nothing declared is unknown — never green', async () => {
  const got = await evalHandoff({}, ['r'], fakeOps({ repos: { r: { refs: ['origin/main'] } } }), NOW)
  assert.equal(got.state, 'unknown')
})

// ── cron schedules → an expectation ─────────────────────────────────────────

test('maxGapHours answers the REAL gap, not the nominal cadence', () => {
  const from = new Date(2026, 8, 8)   // fixed Tuesday, so this never depends on today
  // The two that decide whether this check cries wolf:
  assert.equal(maxGapHours('0 8 * * 1-5', from), 72,
    'weekday-daily is 72h Friday to Monday — a 24h expectation alarms every Monday')
  assert.equal(maxGapHours('0 9 * * 3', from), 168,
    'daily-intel-scan fires Wednesdays despite its name')
  assert.equal(maxGapHours('0 * * * *', from), 1)
  assert.equal(maxGapHours('0 2 * * *', from), 24)
  assert.equal(maxGapHours('30 6 * * 1', from), 168)
  // Sub-hourly collapses to an hour, which is the right resolution for staleness.
  assert.equal(maxGapHours('*/15 * * * *', from), 1)
})

test('maxGapHours returns null rather than guessing — unreadable is never healthy', () => {
  const from = new Date(2026, 8, 8)
  assert.equal(maxGapHours('nonsense', from), null)
  assert.equal(maxGapHours('0 8 * * 1-5 *', from), null, 'six fields is not this dialect')
  assert.equal(maxGapHours('0 25 * * *', from), null, 'hour 25 is out of range')
  assert.equal(maxGapHours('@daily', from), null, 'named schedules are not supported')
  assert.equal(maxGapHours('0 0 1 * *', from), null, 'monthly fires once in the sample window')
})

test('parseCron: day-of-month and day-of-week are OR-ed when both are set', () => {
  // The classic cron quirk. Reading it as AND would narrow the expected cadence
  // and manufacture "late" alarms.
  const c = parseCron('0 0 1 * 1')!
  assert.equal(c.domAndDowBothSet, true)
  const onlyDom = parseCron('0 0 1 * *')!
  assert.equal(onlyDom.domAndDowBothSet, false)
})

// ── heartbeat ───────────────────────────────────────────────────────────────

const pipe = (over: Partial<Pipeline> = {}): Pipeline => ({
  key: 'p', name: 'P', produces: 'a thing', declaredHours: 24,
  runsOn: 'mini', probes: [], ...over,
})
const ev = (at: string | null, kind: Evidence['kind'], sourceSeen = true): Evidence =>
  ({ at, kind, sourceSeen })
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

test('heartbeat: the grace window is generous — a check that cries wolf gets muted', () => {
  assert.equal(lateAfterHours(1), 2)      // hourly tolerates 2h
  assert.equal(lateAfterHours(24), 36)
  assert.equal(lateAfterHours(72), 108)   // weekday-daily
})

test('heartbeat: a live schedule beats the declared fallback, and a mismatch is reported', () => {
  const p = pipe({ declaredHours: 24 })
  const fromSchedule = evaluateBeat(p, ev(hoursAgo(30), 'run-record'), 72, NOW)
  assert.equal(fromSchedule.expectHours, 72)
  assert.equal(fromSchedule.expectFrom, 'schedule')
  assert.equal(fromSchedule.state, 'ok', '30h is fine against the REAL 72h gap')
  assert.match(fromSchedule.drift!, /72h.*declares 24h/)

  const noSchedule = evaluateBeat(p, ev(hoursAgo(30), 'run-record'), null, NOW)
  assert.equal(noSchedule.expectFrom, 'declared')
  assert.equal(noSchedule.state, 'ok', '30h is within the 36h limit for 24h')
  assert.equal(noSchedule.drift, undefined)

  assert.equal(evaluateBeat(p, ev(hoursAgo(40), 'run-record'), null, NOW).state, 'late')
})

test('heartbeat: "never ran" and "nothing to look at here" are different answers', () => {
  const never = evaluateBeat(pipe(), ev(null, 'none', true), null, NOW)
  assert.equal(never.state, 'never')

  // The MacBook cannot see the mini's logs. Reporting that as `never` would make
  // every mini-side pipeline a false alarm.
  const elsewhere = evaluateBeat(pipe(), ev(null, 'none', false), null, NOW)
  assert.equal(elsewhere.state, 'unknown')
  assert.match(elsewhere.detail, /no evidence source on this machine/)
})

test('heartbeat: a quiet pipeline judged only by its artifact is unknown, never late', () => {
  // Most of these write nothing when they find nothing, so an untouched file is
  // equally what "healthy and quiet" and "dead" look like.
  const quiet = pipe({ quietRunsAreNormal: true })
  const byArtifact = evaluateBeat(quiet, ev(hoursAgo(400), 'artifact'), null, NOW)
  assert.equal(byArtifact.state, 'unknown')
  assert.match(byArtifact.detail, /quiet from dead/)

  // A RUN RECORD settles it, and then late means late.
  const byRecord = evaluateBeat(quiet, ev(hoursAgo(400), 'run-record'), null, NOW)
  assert.equal(byRecord.state, 'late')

  // A pipeline that writes every run gets no such benefit of the doubt.
  const noisy = evaluateBeat(pipe(), ev(hoursAgo(400), 'artifact'), null, NOW)
  assert.equal(noisy.state, 'late')
})

test('heartbeat: a future timestamp is a clock fault, not freshness', () => {
  // Exactly the shape tonight's UTC-vs-local bug produced. It must never read ok.
  const b = evaluateBeat(pipe(), ev(hoursAgo(-30), 'run-record'), null, NOW)
  assert.equal(b.state, 'unknown')
  assert.match(b.detail, /FUTURE/)
  assert.equal(evaluateBeat(pipe(), ev('not-a-date', 'run-record'), null, NOW).state, 'unknown')
})

test('heartbeat: findings are worst-first and hide only genuinely healthy pipelines', () => {
  const beats = [
    evaluateBeat(pipe({ key: 'ok' }), ev(hoursAgo(1), 'run-record'), null, NOW),
    evaluateBeat(pipe({ key: 'never' }), ev(null, 'none', true), null, NOW),
    evaluateBeat(pipe({ key: 'late' }), ev(hoursAgo(99), 'run-record'), null, NOW),
    evaluateBeat(pipe({ key: 'unknown' }), ev(null, 'none', false), null, NOW),
  ]
  assert.deepEqual(findings(beats).map(b => b.key), ['late', 'unknown', 'never'])

  // An `ok` pipeline whose schedule disagrees with the declaration still surfaces:
  // the belief and the configuration have come apart.
  const drifting = evaluateBeat(pipe({ declaredHours: 24 }), ev(hoursAgo(1), 'run-record'), 168, NOW)
  assert.equal(drifting.state, 'ok')
  assert.equal(findings([drifting]).length, 1)
})

test('viewDeploy: a failed build serving old code is DANGER, a skip is only a warning', () => {
  const base: DeployState = {
    at: NOW.toISOString(), result: 'deployed', sha: 'a'.repeat(40), target: 'a'.repeat(40),
  }
  assert.equal(viewDeploy(base, NOW).severity, 'ok')
  assert.equal(viewDeploy(base, NOW).behind, false)

  // The dangerous one: the dashboard looks completely normal and is weeks behind.
  const failed = viewDeploy({ ...base, result: 'build-failed', target: 'b'.repeat(40) }, NOW)
  assert.equal(failed.severity, 'danger')
  assert.equal(failed.behind, true)
  assert.match(failed.headline, /BUILD FAILED/)

  // Someone mid-work on the mini is a choice, not a fault — warn, never danger.
  const dirty = viewDeploy({ ...base, result: 'skipped-dirty', target: 'b'.repeat(40) }, NOW)
  assert.equal(dirty.severity, 'warn')

  // `current` means the tick found nothing to do, which is the healthy steady
  // state — it must not read as staleness just because no deploy happened.
  assert.equal(viewDeploy({ ...base, result: 'current' }, NOW).severity, 'ok')
})


// ── Phase 14: proof on every kind, movement on every branch, the tenth check ─

test('deriveState: a build whose proof is fully true is done without a typed date', () => {
  const r = deriveState({ kind: 'build' }, { slug: 'x', evidenceAgeDays: 40, proofTrue: 2, proofTotal: 2 }, true, NOW)
  assert.equal(r.state, 'done')
  assert.equal(r.reason, 'Proof satisfied (2/2)')
  // Idle for 40 days would have been `idle`; proof outranks activity.
  assert.equal(st({ kind: 'build' }, { slug: 'x', evidenceAgeDays: 40 }), 'idle')
})

test('deriveState: partial proof on a build is shown, and does not change the state', () => {
  const r = deriveState({ kind: 'build', target: ahead(30) }, { slug: 'x', evidenceAgeDays: 3, proofTrue: 1, proofTotal: 3 }, true, NOW)
  assert.equal(r.state, 'active')
  assert.match(r.reason, /proof 1\/3$/)
  const none = deriveState({ kind: 'build', target: ahead(30) }, { slug: 'x', evidenceAgeDays: 3 }, true, NOW)
  assert.doesNotMatch(none.reason, /proof/)
})

test('deriveState: a handoff with a fully true proof is done even while merely merged', () => {
  const r = deriveState(
    { kind: 'handoff', handoff: { consumedBy: 'src/x.ts' } },
    { slug: 'x', handoffState: 'merged', handoffAgeDays: 5, proofTrue: 1, proofTotal: 1 }, true, NOW)
  assert.equal(r.state, 'done')
  // Without the proof the same facts are `stranded` — the Phase 13 reading, untouched.
  assert.equal(st({ kind: 'handoff', handoff: { consumedBy: 'src/x.ts' } } as Item,
    { slug: 'x', handoffState: 'merged', handoffAgeDays: 5 }), 'stranded')
})

test('deriveState: movement on a branch names the branch, and never reads as a landing', () => {
  const onBranch = deriveState({ kind: 'build' }, { slug: 'x', evidenceAgeDays: 0, lastEvidenceRef: 'origin/claude/mailbox' }, true, NOW)
  assert.equal(onBranch.state, 'no-target')
  assert.match(onBranch.reason, /last commit 0d ago on origin\/claude\/mailbox/)
  const onMain = deriveState({ kind: 'build' }, { slug: 'x', evidenceAgeDays: 0 }, true, NOW)
  assert.doesNotMatch(onMain.reason, / on /)
  // Near a target the branch still shows; at-risk does not (nothing moved to name).
  const near = deriveState({ kind: 'build', target: ahead(5) }, { slug: 'x', evidenceAgeDays: 1, lastEvidenceRef: 'origin/staging' }, true, NOW)
  assert.equal(near.state, 'on-track')
  assert.match(near.reason, /on origin\/staging/)
})

test('deriveStage: a build with a fully true proof is shipped, then proven after the clean window', () => {
  assert.equal(deriveStage({ kind: 'build' }, { slug: 'x', proofTrue: 2, proofTotal: 2 }, NOW), 'shipped')
  assert.equal(deriveStage({ kind: 'build' }, { slug: 'x', proofTrue: 2, proofTotal: 2, provenTrue: 1, provenTotal: 1 }, NOW), 'proven')
})

test('parseProof: calendar_event is in the vocabulary; an eleventh check is not', () => {
  const p = parseProof([
    { check: 'calendar_event', title_match: 'demo', after: '2026-09-01' },
    { check: 'url_reachable', url: 'https://x' },
  ])
  assert.equal(p?.length, 1)
  assert.equal(p?.[0].check, 'calendar_event')
})

test('calendar_event: not read, unreachable, hit, miss, window — and never a confident red for a feed that failed', async () => {
  const ev = (title: string, day: string) => ({ uid: title, title, startAt: `${day}T10:00:00-07:00`, allDay: false, calendar: 'Work', isDemo: false })
  const check = { check: 'calendar_event' as const, title_match: 'OEIS.*demo', after: '2026-09-01', before: '2026-10-01' }

  const unread = await evalCheck(check, ctx())
  assert.equal(unread.ok, false); assert.match(unread.detail, /not read/)

  const down = await evalCheck(check, ctx({ calendar: [], calendarErrors: ['Work: HTTP 401'] }))
  assert.equal(down.ok, false); assert.match(down.detail, /unreachable.*HTTP 401/)

  const empty = await evalCheck(check, ctx({ calendar: [], calendarErrors: [] }))
  assert.equal(empty.ok, false); assert.match(empty.detail, /^no calendar event/)

  const hit = await evalCheck(check, ctx({ calendar: [ev('OEIS follow-up demo', '2026-09-19'), ev('Dentist', '2026-09-19')] }))
  assert.equal(hit.ok, true); assert.match(hit.detail, /1 calendar event.*2026-09-19 OEIS follow-up demo/)

  // Outside the window: before `after`, or on/after `before`.
  const early = await evalCheck(check, ctx({ calendar: [ev('OEIS demo', '2026-08-30')] }))
  assert.equal(early.ok, false)
  const late = await evalCheck(check, ctx({ calendar: [ev('OEIS demo', '2026-10-01')] }))
  assert.equal(late.ok, false)

  const bad = await evalCheck({ ...check, title_match: '(?i)demo' }, ctx({ calendar: [] }))
  assert.equal(bad.ok, false); assert.match(bad.detail, /not a regex/)
})
