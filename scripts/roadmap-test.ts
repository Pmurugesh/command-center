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
  parseProof, pullScore, daysBetween,
  type RoadmapMilestone, type RoadmapRow, type DerivedEntry, type Stage,
} from '../src/lib/roadmap.ts'
import {
  evalCheck, readContacts, readMeetings, resolveField, fieldMatches, literalMatches,
  type GitOps, type ProofContext,
} from '../src/lib/roadmap-proof.ts'
import { stageAtLeast, CRM_STAGES } from '../src/lib/config.ts'

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

test('deriveState: handoff merged but unconsumed is stranded — the worst outcome', () => {
  const r = deriveState({ kind: 'handoff' }, { slug: 'x', handoffState: 'merged', handoffAgeDays: 98 }, true, NOW)
  assert.equal(r.state, 'stranded')
  assert.match(r.reason, /Merged 98d ago, still not consumed here/)
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
