import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadQueries } from './datasets'
import { writeReport } from './report'
import { estimateCost, executeRun, runPaths } from './run'
import { ALL_ARMS, CONDITION_IDS, type ModelPrice, type Query, type RunConfig } from './types'
import { mulberry32, readJson, readJsonl, sampleStratified, writeJson, writeJsonl } from './util'
import { ApiError, type Backend, MockBackend, type ModelInfo, VeniceBackend } from './venice'

class UsageError extends Error {}

const ROOT = resolve(import.meta.dir, '..')
const RUNS_DIR = join(ROOT, 'runs')
const DEFAULT_BASE_URL = 'https://api.venice.ai/api/v1'
const DEFAULT_MODELS = { answer: 'zai-org-glm-5-2', judge: 'grok-4-7' }

const HELP = `venice-search-bench: compare Venice web search providers

Usage: bun run bench <command> [options]

Commands
  run         Search, answer, and grade a query set, then write a report
  report      Rebuild report.md, results.csv, and summary.json for a run
  validate    Check query files and print their composition
  models      List Venice text models with privacy tier and pricing

Run options
  --dataset <file>          Query file (repeatable; default data/seed.jsonl)
  --arms <list>             brave,google,exa,none (default: all)
  --conditions <list>       native,k5-2k,k5-8k (default: all)
  --search-limit <n>        Results requested per search (default 10, max 20)
  --limit <n>               Sample n queries, stratified by slice
  --seed <n>                Sampling seed for --limit (default 1)
  --slice <name>            Only queries in this slice (repeatable)
  --ids <list>              Only these query ids
  --answer-model <id>       Default ${DEFAULT_MODELS.answer}
  --judge-model <id>        Default ${DEFAULT_MODELS.judge}
  --answer-thinking <mode>  off (default) or default
  --answer-max-tokens <n>   Default 8192, or 16384 with thinking
  --citations               Also grade citation support
  --pairwise                Also judge answers pairwise on queries without gold
  --no-judge                Skip all grading
  --include-unreviewed      Include queries marked needsReview
  --concurrency <n>         Queries in flight (default 4)
  --search-rpm <n>          Search requests per minute across providers (default 55)
  --chat-rpm <n>            Chat requests per minute per model (default 60)
  --budget <usd>            Refuse to start above this estimate without --yes (default 5)
  --yes                     Start even if the estimate exceeds the budget
  --mock                    Offline deterministic backend; spends nothing
  --name <label>            Suffix for the run id
  --resume <run-id>         Continue a run; finished steps are not repeated

Other options
  --run <run-id>            Run to rebuild (report)
  --all                     Include models that are not private-tier (models)

Environment
  VENICE_API_KEY            Required unless --mock (Bun also reads it from .env)
  VENICE_BASE_URL           Default ${DEFAULT_BASE_URL}
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dataset: { type: 'string', multiple: true },
    arms: { type: 'string' },
    conditions: { type: 'string' },
    'search-limit': { type: 'string', default: '10' },
    limit: { type: 'string' },
    seed: { type: 'string', default: '1' },
    slice: { type: 'string', multiple: true },
    ids: { type: 'string' },
    'answer-model': { type: 'string', default: DEFAULT_MODELS.answer },
    'judge-model': { type: 'string', default: DEFAULT_MODELS.judge },
    'answer-thinking': { type: 'string', default: 'off' },
    'answer-max-tokens': { type: 'string' },
    citations: { type: 'boolean', default: false },
    pairwise: { type: 'boolean', default: false },
    'no-judge': { type: 'boolean', default: false },
    'include-unreviewed': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
    'search-rpm': { type: 'string', default: '55' },
    'chat-rpm': { type: 'string', default: '60' },
    budget: { type: 'string', default: '5' },
    yes: { type: 'boolean', default: false },
    mock: { type: 'boolean', default: false },
    name: { type: 'string' },
    resume: { type: 'string' },
    run: { type: 'string' },
    all: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const log = (line: string) => console.log(line)
const warn = (line: string) => console.error(`warning: ${line}`)

function int(name: string, value: string | undefined, min = 1): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} must be an integer >= ${min}`)
  return n
}

function list<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: readonly T[]): T[] {
  if (!value) return [...fallback]
  const items = value.split(',').map(s => s.trim()).filter(Boolean)
  const bad = items.filter(item => !allowed.includes(item as T))
  if (bad.length) throw new UsageError(`--${name}: unknown ${bad.join(', ')} (allowed: ${allowed.join(', ')})`)
  return [...new Set(items)] as T[]
}

const datasetPaths = (): string[] => (values.dataset?.length ? values.dataset : [join(ROOT, 'data', 'seed.jsonl')]).map(p => resolve(p))

function makeBackend(): Backend {
  if (values.mock) return new MockBackend()
  const apiKey = process.env.VENICE_API_KEY
  if (!apiKey) throw new UsageError('VENICE_API_KEY is not set. Set it in your environment or add a VENICE_API_KEY=your-key line to .env in this directory. Use --mock to try the pipeline offline.')
  return new VeniceBackend({
    apiKey,
    baseUrl: process.env.VENICE_BASE_URL ?? DEFAULT_BASE_URL,
    searchRpm: int('search-rpm', values['search-rpm']),
    chatRpm: int('chat-rpm', values['chat-rpm']),
    maxConcurrent: 8,
  })
}

async function modelMap(backend: Backend, required: string[]): Promise<Map<string, ModelInfo>> {
  const models = new Map((await backend.models()).map(m => [m.id, m]))
  for (const id of new Set(required)) {
    const info = models.get(id)
    if (!info) throw new UsageError(`unknown model ${id}; run \`bun run bench models\` to list text models`)
    if (info.privacy !== 'private') warn(`${id} is "${info.privacy}" tier, not private: prompts are proxied to a third-party provider`)
  }
  return models
}

function selectQueries(queries: Query[]): Query[] {
  let selected = queries
  if (values.slice?.length) selected = selected.filter(q => values.slice?.includes(q.slice))
  if (values.ids) {
    const ids = new Set(values.ids.split(',').map(s => s.trim()))
    selected = selected.filter(q => ids.has(q.id))
    const missing = [...ids].filter(id => !selected.some(q => q.id === id))
    if (missing.length) throw new UsageError(`unknown query ids: ${missing.join(', ')}`)
  }
  if (values.limit) selected = sampleStratified(selected, int('limit', values.limit), q => q.slice, mulberry32(int('seed', values.seed, 0)))
  if (selected.length === 0) throw new UsageError('no queries selected')
  return selected
}

function runId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return [stamp, values.name, values.mock ? 'mock' : undefined].filter(Boolean).join('-')
}

async function cmdRun(): Promise<void> {
  const backend = makeBackend()
  let config: RunConfig
  let queries: Query[]
  let runDir: string
  if (values.resume) {
    runDir = join(RUNS_DIR, values.resume)
    const saved = await readJson<RunConfig>(runPaths.config(runDir))
    if (!saved) throw new UsageError(`no run at ${runDir}`)
    if (saved.mock !== values.mock) throw new UsageError(`run ${values.resume} was ${saved.mock ? '' : 'not '}a mock run; pass the same --mock setting`)
    config = {
      ...saved,
      grading: {
        judge: saved.grading.judge && !values['no-judge'],
        citations: saved.grading.citations || values.citations,
        pairwise: saved.grading.pairwise || values.pairwise,
      },
    }
    queries = await readJsonl<Query>(runPaths.queries(runDir))
  } else {
    const loaded = await loadQueries(datasetPaths(), { includeUnreviewed: values['include-unreviewed'] })
    if (loaded.skippedForReview) warn(`${loaded.skippedForReview} queries marked needsReview were skipped (--include-unreviewed to keep them)`)
    queries = selectQueries(loaded.queries)
    const thinking = values['answer-thinking']
    if (thinking !== 'off' && thinking !== 'default') throw new UsageError('--answer-thinking must be off or default')
    const id = runId()
    runDir = join(RUNS_DIR, id)
    config = {
      runId: id,
      createdAt: new Date().toISOString(),
      datasets: datasetPaths().map(p => p.replace(`${ROOT}/`, '')),
      queryCount: queries.length,
      arms: list('arms', values.arms, ALL_ARMS, ALL_ARMS),
      conditions: list('conditions', values.conditions, CONDITION_IDS, CONDITION_IDS),
      searchLimit: int('search-limit', values['search-limit']),
      models: { answer: values['answer-model'] as string, judge: values['judge-model'] as string },
      answerThinking: thinking,
      answerMaxTokens: values['answer-max-tokens'] ? int('answer-max-tokens', values['answer-max-tokens']) : thinking === 'off' ? 8192 : 16384,
      grading: { judge: !values['no-judge'], citations: values.citations, pairwise: values.pairwise },
      pricing: {},
      mock: values.mock,
      baseUrl: values.mock ? 'mock' : (process.env.VENICE_BASE_URL ?? DEFAULT_BASE_URL),
    }
    if (config.searchLimit > 20) throw new UsageError('--search-limit cannot exceed 20')
  }

  const requiredModels = [config.models.answer, ...(config.grading.judge ? [config.models.judge] : [])]
  const models = await modelMap(backend, requiredModels)

  const estimate = estimateCost(queries, config, models)
  log(`Run ${config.runId}: ${queries.length} queries; arms ${config.arms.join(', ')}; conditions ${config.conditions.join(', ')}`)
  log(`  searches ${estimate.searches} ($${estimate.searchUsd.toFixed(2)}), answers ~$${estimate.answerUsd.toFixed(2)}, judge ~$${estimate.judgeUsd.toFixed(2)}`)
  log(`  rough total ~$${estimate.totalUsd.toFixed(2)}${values.resume ? ' before subtracting finished work' : ''}${config.mock ? ' (mock: nothing is spent)' : ''}`)
  if (estimate.unpricedModels.length) warn(`no pricing for ${estimate.unpricedModels.join(', ')}; estimate excludes them`)
  const budget = Number(values.budget)
  if (!config.mock && !values.resume && estimate.totalUsd > budget && !values.yes) {
    throw new UsageError(`estimate exceeds --budget $${budget.toFixed(2)}; rerun with --yes or a larger --budget`)
  }

  if (!values.resume) {
    config.pricing = Object.fromEntries(
      requiredModels.map((id): [string, ModelPrice] => {
        const m = models.get(id)
        return [
          id,
          {
            inputUsdPerMillion: m?.inputUsdPerMillion,
            outputUsdPerMillion: m?.outputUsdPerMillion,
            cacheInputUsdPerMillion: m?.cacheInputUsdPerMillion,
            cacheWriteUsdPerMillion: m?.cacheWriteUsdPerMillion,
          },
        ]
      }),
    )
    await writeJson(runPaths.config(runDir), config)
    await writeJsonl(runPaths.queries(runDir), queries)
  } else {
    await writeJson(runPaths.config(runDir), config)
  }

  const started = Date.now()
  try {
    await executeRun({ runDir, config, backend, models, concurrency: int('concurrency', values.concurrency), log }, queries)
  } catch (error) {
    if (error instanceof ApiError) {
      throw new UsageError(`${error.message} (HTTP ${error.status}). Finished steps are saved; continue with: bun run bench run --resume ${config.runId}${config.mock ? ' --mock' : ''}`)
    }
    throw error
  } finally {
    const { files } = await writeReport(runDir)
    log(`\nFinished in ${((Date.now() - started) / 1000).toFixed(0)}s. Report: ${files[0]}`)
  }
}

async function cmdReport(): Promise<void> {
  const id = values.run ?? positionals[1]
  if (!id) throw new UsageError('usage: bun run bench report --run <run-id>')
  const { report, files } = await writeReport(join(RUNS_DIR, id))
  log(report)
  log(`Wrote ${files.join(', ')}`)
}

async function cmdValidate(): Promise<void> {
  const { queries } = await loadQueries(datasetPaths(), { includeUnreviewed: true })
  const count = (key: (q: Query) => string | undefined) => {
    const counts = new Map<string, number>()
    for (const q of queries) counts.set(key(q) ?? '(none)', (counts.get(key(q) ?? '(none)') ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')
  }
  const coding = queries.filter(q => q.slice === 'coding')
  log(`${queries.length} queries valid`)
  log(`  slices: ${count(q => q.slice)}`)
  log(`  gold answers: ${queries.filter(q => q.goldAnswer).length}; gold URLs: ${queries.filter(q => q.goldUrls?.length).length}; needsReview: ${queries.filter(q => q.needsReview).length}`)
  log(`  languages: ${count(q => q.language ?? 'en')}`)
  if (coding.length) {
    log(`  coding sub-slices: ${[...new Set(coding.map(q => q.subSlice ?? '(none)'))].map(s => `${s} ${coding.filter(q => (q.subSlice ?? '(none)') === s).length}`).join(', ')}`)
    log(`  coding styles: ${[...new Set(coding.map(q => q.style ?? '(none)'))].map(s => `${s} ${coding.filter(q => (q.style ?? '(none)') === s).length}`).join(', ')}`)
  }
}

async function cmdModels(): Promise<void> {
  const models = await makeBackend().models()
  const rows = models
    .filter(m => values.all || m.privacy === 'private')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(m =>
      [
        m.id.padEnd(40),
        (m.privacy ?? '?').padEnd(11),
        `$${m.inputUsdPerMillion ?? '?'}/$${m.outputUsdPerMillion ?? '?'}`.padEnd(14),
        m.supportsResponseSchema ? 'schema' : '      ',
        m.supportsFunctionCalling ? 'tools' : '     ',
        m.supportsReasoningEffort ? `effort:${(m.reasoningEffortOptions ?? []).join('/')}` : m.supportsReasoning ? 'reasoning' : '',
      ].join(' '),
    )
  log(`${'model'.padEnd(40)} ${'privacy'.padEnd(11)} ${'in/out per M'.padEnd(14)}`)
  log(rows.join('\n'))
  if (!values.all) log('\nShowing private-tier models only; pass --all for every model.')
}

const commands: Record<string, () => Promise<void>> = {
  run: cmdRun,
  report: cmdReport,
  validate: cmdValidate,
  models: cmdModels,
}

const command = positionals[0]
if (!command || values.help || command === 'help') {
  log(HELP)
} else if (!commands[command]) {
  console.error(`unknown command ${command}\n\n${HELP}`)
  process.exit(2)
} else {
  try {
    await commands[command]()
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`error: ${error.message}`)
      process.exit(2)
    }
    throw error
  }
}
