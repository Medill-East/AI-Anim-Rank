# AI Anim Rank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish an installable public animation ranking app with locally private progress markers and optional anonymous end-to-end encrypted sync.

**Architecture:** A React/Vite PWA renders a checked-in, versioned ranking snapshot and keeps a user's progress in IndexedDB. A small Cloudflare Worker exposes compare-and-swap storage for encrypted blobs in D1; cryptography, recovery phrase generation, and merge behavior all stay in the browser. The static app is deployable through Sites, while the Worker is deployed independently to Cloudflare.

**Tech Stack:** TypeScript, React, Vite, Vitest, Testing Library, Zod, Dexie, Web Crypto, Vite PWA plugin, Cloudflare Workers, D1, Wrangler.

---

## File map

- `package.json`, `vite.config.ts`, `tsconfig.json`: Vite application, test and PWA setup.
- `src/data/schema.ts`, `src/data/ranking.json`, `src/data/ranking.ts`: versioned public snapshot and typed parser.
- `src/domain/progress.ts`: private-state invariants and pure merge helpers.
- `src/storage/progress-db.ts`, `src/storage/backup.ts`: IndexedDB persistence and portable backup validation.
- `src/sync/crypto.ts`, `src/sync/client.ts`: recovery phrase, client-side encryption, protocol client and retry behavior.
- `src/features/ranking/*`: search/filter/sort view-model and public ranking workspace components.
- `src/features/progress/*`: private mark controls, statistics, backup, and sync safety settings.
- `src/app/App.tsx`, `src/app/styles.css`: responsive application composition and visual system.
- `worker/src/index.ts`, `worker/schema.sql`, `worker/wrangler.toml`: encrypted-blob API and D1 deployment config.
- `scripts/validate-ranking.ts`: snapshot quality gate.
- `tests/*`, `worker/test/*`: unit, component and Worker protocol tests.
- `.openai/hosting.json`: Sites hosting configuration, created only by the Sites initializer if absent.

### Task 1: Create the app shell and verification toolchain

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/app/styles.css`
- Create: `src/test/setup.ts`, `tests/app-smoke.test.tsx`

- [ ] **Step 1: Write the failing smoke test**

```tsx
import { render, screen } from '@testing-library/react'
import { App } from '../src/app/App'

test('renders the public ranking workspace', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'AI Anim Rank' })).toBeVisible()
  expect(screen.getByLabelText('搜索作品')).toBeVisible()
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/app-smoke.test.tsx`

Expected: failure because the project and `App` do not exist.

- [ ] **Step 3: Add the minimum Vite/React/Vitest setup and app placeholder**

```tsx
export function App() {
  return (
    <main>
      <h1>AI Anim Rank</h1>
      <label>
        搜索作品
        <input aria-label="搜索作品" type="search" />
      </label>
    </main>
  )
}
```

Configure `vitest` with `jsdom`, import `@testing-library/jest-dom/vitest` in `src/test/setup.ts`, and provide `dev`, `build`, `test`, and `test:watch` scripts.

- [ ] **Step 4: Run the test and production build**

Run: `npm test -- --run tests/app-smoke.test.tsx && npm run build`

Expected: test passes and Vite emits `dist/`.

- [ ] **Step 5: Commit the baseline**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json index.html src tests
git commit -m "feat: bootstrap ranking app"
```

### Task 2: Define and validate the public ranking snapshot

**Files:**
- Create: `src/data/schema.ts`, `src/data/ranking.ts`, `src/data/ranking.json`, `scripts/validate-ranking.ts`
- Create: `tests/ranking-schema.test.ts`

- [ ] **Step 1: Write the failing schema tests**

```ts
import { parseRankingSnapshot } from '../src/data/schema'

const valid = {
  version: '2026-07-12',
  methodologyVersion: 'v1',
  works: [{ workId: 'anilist:1', rank: 1, titleZh: '星际牛仔', titleOriginal: 'Cowboy Bebop', year: 1998, studios: ['SUNRISE'], genres: ['动作'], compositeScore: 91.2, sources: { anilist: { score: 86, votes: 1000 }, mal: { score: 8.75, votes: 1000 }, bangumi: { score: 8.8, votes: 1000 } } }],
}

test('rejects duplicate work ids and ranks', () => {
  expect(() => parseRankingSnapshot({ ...valid, works: [valid.works[0], valid.works[0]] })).toThrow()
})
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `npm test -- --run tests/ranking-schema.test.ts`

Expected: failure because `parseRankingSnapshot` does not exist.

- [ ] **Step 3: Implement typed parsing and the quality gate**

Implement a Zod `Work` schema requiring stable IDs, one-based unique ranks, non-empty Chinese/original titles, years, studios, genres, bounded scores, and all three primary source objects. `parseRankingSnapshot` must reject duplicated `workId` and `rank` values. `validate-ranking.ts` imports `ranking.json`, calls the parser, verifies exactly 300 unique works for release mode, and exits non-zero with a readable error.

The checked-in first development fixture must be explicitly labelled `sample: true` at snapshot level and must not claim to be a Top 300 release. Add a build-time guard that rejects `sample: true` when `VITE_RELEASE_BUILD=true`.

- [ ] **Step 4: Run schema and validation commands**

Run: `npm test -- --run tests/ranking-schema.test.ts && npx tsx scripts/validate-ranking.ts`

Expected: schema tests pass; fixture validation reports it is a development sample.

- [ ] **Step 5: Commit snapshot contracts**

```bash
git add src/data scripts tests/ranking-schema.test.ts package.json package-lock.json
git commit -m "feat: add validated ranking snapshot contract"
```

### Task 3: Implement private progress invariants and IndexedDB persistence

**Files:**
- Create: `src/domain/progress.ts`, `src/storage/progress-db.ts`
- Create: `tests/progress.test.ts`, `tests/progress-db.test.ts`

- [ ] **Step 1: Write failing invariant tests**

```ts
import { applyProgressPatch } from '../src/domain/progress'

test('recommending marks a work watched and clears not interested', () => {
  expect(applyProgressPatch({}, { recommended: true })).toMatchObject({ watched: true, recommended: true, notInterested: false })
})

test('marking not interested clears recommendation and marks watched', () => {
  expect(applyProgressPatch({ recommended: true }, { notInterested: true })).toMatchObject({ watched: true, recommended: false, notInterested: true })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- --run tests/progress.test.ts tests/progress-db.test.ts`

Expected: failure because progress modules do not exist.

- [ ] **Step 3: Implement immutable records and Dexie repository**

Define `ProgressRecord` with `workId`, four booleans, optional `note`, `updatedAt`, and `revision`. `applyProgressPatch` must enforce the stated invariant rules and only advance `updatedAt` when the meaningful state changes. Create a Dexie database with a `progress` table keyed by `workId`; expose `loadAll`, `save`, `replaceAll`, and `clear`. No public ranking field may be written to this database.

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/progress.test.ts tests/progress-db.test.ts`

Expected: all invariant and fake-IndexedDB persistence tests pass.

- [ ] **Step 5: Commit private local state**

```bash
git add src/domain src/storage tests/progress.test.ts tests/progress-db.test.ts package.json package-lock.json
git commit -m "feat: persist private progress locally"
```

### Task 4: Add backup import/export and pure search/filter/sort view models

**Files:**
- Create: `src/storage/backup.ts`, `src/features/ranking/query.ts`
- Create: `tests/backup.test.ts`, `tests/ranking-query.test.ts`

- [ ] **Step 1: Write failing behavior tests**

```ts
test('backup rejects unknown work ids', () => {
  expect(() => parseBackup('{"version":1,"records":[{"workId":"unknown"}]}', new Set(['anilist:1']))).toThrow('未知作品')
})

test('recommended status filter only returns private recommended works', () => {
  expect(filterWorks(works, progress, { status: 'recommended', query: '', genre: 'all', sort: 'rank-asc' })).toEqual([works[0]])
})
```

- [ ] **Step 2: Run the test files and verify they fail**

Run: `npm test -- --run tests/backup.test.ts tests/ranking-query.test.ts`

Expected: failure because parser and query functions do not exist.

- [ ] **Step 3: Implement versioned backup and deterministic queries**

Export `{ version: 1, exportedAt, records }`, with no recovery phrase or sync credentials. Validate import JSON with Zod, validate every `workId` against the current snapshot, and expose `merge` and `replace` modes. Implement case-insensitive Chinese/original-title search, `all`/genre status filters, and rank/score/year ascending/descending sort; keep functions pure and return a new array.

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/backup.test.ts tests/ranking-query.test.ts`

Expected: all backup and query tests pass.

- [ ] **Step 5: Commit portable private data features**

```bash
git add src/storage/backup.ts src/features/ranking/query.ts tests/backup.test.ts tests/ranking-query.test.ts
git commit -m "feat: add backup and ranking queries"
```

### Task 5: Build the responsive public ranking workspace

**Files:**
- Create: `src/features/ranking/RankingWorkspace.tsx`, `src/features/ranking/RankingTable.tsx`, `src/features/ranking/WorkDetail.tsx`
- Modify: `src/app/App.tsx`, `src/app/styles.css`
- Create: `tests/ranking-workspace.test.tsx`

- [ ] **Step 1: Write failing component tests**

```tsx
test('filters the list by Chinese title and opens a work detail panel', async () => {
  const user = userEvent.setup()
  render(<RankingWorkspace works={works} progressById={{}} />)
  await user.type(screen.getByLabelText('搜索作品'), '星际')
  await user.click(screen.getByRole('button', { name: /星际牛仔/ }))
  expect(screen.getByRole('dialog', { name: '星际牛仔详情' })).toBeVisible()
})
```

- [ ] **Step 2: Run the component test and verify it fails**

Run: `npm test -- --run tests/ranking-workspace.test.tsx`

Expected: failure because the workspace component does not exist.

- [ ] **Step 3: Implement desktop and mobile browsing surfaces**

Create accessible labeled controls for search, genre, status, sort, and reset. Render a scrollable ranking region whose table header uses `position: sticky` within that region. Rows show public metadata only; private state indicators are rendered only from the local `progressById` map. On narrow viewports, render semantic expandable rows and an accessible detail dialog/bottom sheet instead of squeezing the table. Use CSS custom properties, one accent color, and an editorial dark visual system.

- [ ] **Step 4: Run component tests and build**

Run: `npm test -- --run tests/ranking-workspace.test.tsx && npm run build`

Expected: interaction test passes and the application builds.

- [ ] **Step 5: Commit the ranking workspace**

```bash
git add src/app src/features/ranking tests/ranking-workspace.test.tsx
git commit -m "feat: build responsive ranking workspace"
```

### Task 6: Add private marking UI, statistics, and backup controls

**Files:**
- Create: `src/features/progress/ProgressControls.tsx`, `src/features/progress/ProgressSummary.tsx`, `src/features/progress/BackupControls.tsx`
- Modify: `src/app/App.tsx`, `src/features/ranking/WorkDetail.tsx`
- Create: `tests/progress-controls.test.tsx`

- [ ] **Step 1: Write failing UI tests**

```tsx
test('recommend action updates local state and announces saving', async () => {
  const user = userEvent.setup()
  render(<ProgressControls record={emptyRecord} onChange={onChange} />)
  await user.click(screen.getByRole('checkbox', { name: '推荐' }))
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ watched: true, recommended: true }))
  expect(screen.getByRole('status')).toHaveTextContent('已保存')
})
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run: `npm test -- --run tests/progress-controls.test.tsx`

Expected: failure because progress controls do not exist.

- [ ] **Step 3: Implement private controls and stats**

Use controlled checkboxes with explicit Chinese labels and write through the repository immediately. Display total works, watched count, completion rate, reviewed count, recommended count, and not-interested count; never expose these values in public HTML or share metadata. Implement JSON download with `Blob` and an import file input that shows merge/replace confirmation only after validation succeeds.

- [ ] **Step 4: Run tests and build**

Run: `npm test -- --run tests/progress-controls.test.tsx && npm run build`

Expected: private status behavior passes and bundle builds.

- [ ] **Step 5: Commit personal progress UI**

```bash
git add src/app/App.tsx src/features/progress src/features/ranking/WorkDetail.tsx tests/progress-controls.test.tsx
git commit -m "feat: add private progress controls"
```

### Task 7: Implement client-side recovery phrase, encryption, and merge protocol

**Files:**
- Create: `src/sync/crypto.ts`, `src/sync/client.ts`, `src/sync/types.ts`
- Create: `tests/sync-crypto.test.ts`, `tests/sync-client.test.ts`

- [ ] **Step 1: Write failing cryptography and merge tests**

```ts
test('encrypted progress cannot be read without its recovery phrase', async () => {
  const vault = await createVault()
  const encrypted = await encryptRecords(vault, records)
  await expect(decryptRecords(await createVault(), encrypted)).rejects.toThrow()
  await expect(decryptRecords(vault, encrypted)).resolves.toEqual(records)
})

test('merge keeps the newest record per work id', () => {
  expect(mergeRecords([{ workId: 'anilist:1', updatedAt: 1 }], [{ workId: 'anilist:1', updatedAt: 2 }])).toEqual([{ workId: 'anilist:1', updatedAt: 2 }])
})
```

- [ ] **Step 2: Run the sync tests and verify they fail**

Run: `npm test -- --run tests/sync-crypto.test.ts tests/sync-client.test.ts`

Expected: failure because sync modules do not exist.

- [ ] **Step 3: Implement the browser-only cryptographic boundary**

Generate a 128-bit random entropy recovery phrase with a reviewed word-list dependency, derive an AES-GCM key with Web Crypto PBKDF2 using an explicit per-vault salt, and derive an opaque vault identifier using SHA-256. Encrypt a versioned progress payload with a random 96-bit IV; send only `{ vaultId, ciphertext, iv, salt, version }`. Implement `mergeRecords` as last-write-wins per `workId` and a `SyncClient` that uses `If-Match` version headers, fetches/merges/retries once on `409`, then retains unsynced local state if offline.

- [ ] **Step 4: Run sync tests**

Run: `npm test -- --run tests/sync-crypto.test.ts tests/sync-client.test.ts`

Expected: encryption round trip, wrong-key rejection, merge and conflict retry tests pass.

- [ ] **Step 5: Commit encrypted sync client**

```bash
git add src/sync tests/sync-crypto.test.ts tests/sync-client.test.ts package.json package-lock.json
git commit -m "feat: add encrypted anonymous sync client"
```

### Task 8: Build the sync safety and recovery experience

**Files:**
- Create: `src/features/progress/SyncSettings.tsx`, `src/features/progress/RecoveryDialog.tsx`
- Modify: `src/app/App.tsx`
- Create: `tests/sync-settings.test.tsx`

- [ ] **Step 1: Write failing safety-flow tests**

```tsx
test('requires acknowledgement before enabling sync', async () => {
  const user = userEvent.setup()
  render(<SyncSettings syncState="disabled" />)
  await user.click(screen.getByRole('button', { name: '启用私密同步' }))
  expect(screen.getByText('恢复短语是唯一凭证')).toBeVisible()
  expect(screen.getByRole('button', { name: '我已安全保存，继续' })).toBeDisabled()
  await user.click(screen.getByRole('checkbox', { name: '我已保存恢复短语' }))
  expect(screen.getByRole('button', { name: '我已安全保存，继续' })).toBeEnabled()
})
```

- [ ] **Step 2: Run the safety-flow test and verify it fails**

Run: `npm test -- --run tests/sync-settings.test.tsx`

Expected: failure because settings components do not exist.

- [ ] **Step 3: Implement explicit safety states**

Present the generated phrase once in a masked, copyable dialog and require acknowledgement before storing the local vault. Provide QR export/import based on the recovery payload but do not put it into a URL. The settings view must state: no account exists, Cloudflare only stores ciphertext, clearing every connected browser plus losing the phrase is irreversible, and anyone with the phrase can read/change the vault. Provide a disconnect action that deletes local vault credentials but does not promise remote deletion.

- [ ] **Step 4: Run tests and build**

Run: `npm test -- --run tests/sync-settings.test.tsx && npm run build`

Expected: acknowledgement flow passes and no phrase appears in the rendered document after closing the dialog.

- [ ] **Step 5: Commit sync safety UX**

```bash
git add src/app/App.tsx src/features/progress/SyncSettings.tsx src/features/progress/RecoveryDialog.tsx tests/sync-settings.test.tsx
git commit -m "feat: add safe sync onboarding"
```

### Task 9: Implement and test the encrypted blob Worker

**Files:**
- Create: `worker/package.json`, `worker/wrangler.toml`, `worker/schema.sql`, `worker/src/index.ts`, `worker/test/index.test.ts`

- [ ] **Step 1: Write failing Worker protocol tests**

```ts
test('stores ciphertext and rejects stale writes', async () => {
  const first = await worker.fetch('https://sync/v1/vaults/a'.replace('a', vaultId), { method: 'PUT', body: JSON.stringify(payload) })
  expect(first.status).toBe(201)
  const stale = await worker.fetch(`https://sync/v1/vaults/${vaultId}`, { method: 'PUT', headers: { 'If-Match': '0' }, body: JSON.stringify(payload) })
  expect(stale.status).toBe(409)
})
```

- [ ] **Step 2: Run Worker tests and verify they fail**

Run: `npm --prefix worker test -- --run test/index.test.ts`

Expected: failure because the Worker project does not exist.

- [ ] **Step 3: Implement narrow D1 API**

Create table `vaults(vault_id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, salt TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`. Implement only `GET /v1/vaults/:id` and `PUT /v1/vaults/:id`; validate opaque base64url IDs and payload sizes, add restrictive CORS for the published Sites origin, return `ETag` versions, insert on absent vault, update only when `If-Match` matches, and return `409` with current ciphertext metadata on conflict. Do not decrypt, log, or index payload contents.

- [ ] **Step 4: Run Worker tests and type check**

Run: `npm --prefix worker test -- --run test/index.test.ts && npm --prefix worker run typecheck`

Expected: protocol and stale-version tests pass.

- [ ] **Step 5: Commit Worker service**

```bash
git add worker
git commit -m "feat: add encrypted sync worker"
```

### Task 10: Make the app installable, validate it, and deploy

**Files:**
- Modify: `vite.config.ts`, `src/app/App.tsx`, `src/app/styles.css`, `README.md`
- Create: `public/icon-192.png`, `public/icon-512.png`
- Modify or create: `.openai/hosting.json`

- [ ] **Step 1: Write the failing installability test**

```ts
test('web manifest identifies the installable ranking app', async () => {
  const manifest = await import('../public/manifest.webmanifest', { with: { type: 'json' } })
  expect(manifest.default.name).toBe('AI Anim Rank')
  expect(manifest.default.display).toBe('standalone')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/pwa.test.ts`

Expected: failure because the manifest does not exist.

- [ ] **Step 3: Add the PWA plugin, offline shell, and deployment documentation**

Configure `vite-plugin-pwa` with `registerType: 'autoUpdate'`, standalone display, named app icons, and caching limited to public static assets and application shell. Add a visible offline/sync status that never implies remote data is available while disconnected. In `README.md`, document local run/test commands, snapshot release validation, Cloudflare D1 migration/deploy commands, required `VITE_SYNC_BASE_URL`, Sites publication, and the recovery-phrase warning.

- [ ] **Step 4: Run final checks and visually inspect local app**

Run: `npm test -- --run && npm run build && VITE_RELEASE_BUILD=true npm run build`

Expected: unit/component tests pass; normal build passes; release build fails until a verified non-sample 300-item snapshot is supplied.

Open the local app at the Vite URL, verify desktop sticky header, mobile expanded row controls, private mark persistence after reload, and sync-warning copy before publishing.

- [ ] **Step 5: Publish only after a verified data snapshot exists**

Run: `npx wrangler d1 execute ai-anim-rank-sync --remote --file=worker/schema.sql && npm --prefix worker run deploy && <Sites hosting command supplied by .openai/hosting.json>`

Expected: Worker URL is configured as `VITE_SYNC_BASE_URL`, Sites returns the public PWA, and no development sample appears in the deployed build.

- [ ] **Step 6: Commit release configuration and documentation**

```bash
git add vite.config.ts public src/app README.md .openai/hosting.json tests/pwa.test.ts
git commit -m "feat: make ranking app installable"
```

## Plan self-review

- Spec coverage: public snapshot/data validation (Task 2), all private state and statuses (Tasks 3 and 6), filters/sorting/sticky responsive workspace (Tasks 4 and 5), backup (Task 4), client-only encryption and conflict handling (Task 7), recovery risk UX (Task 8), ciphertext-only Worker/D1 backend (Task 9), PWA/Sites/deployment validation (Task 10).
- Scope: the actual three-source collection and 300-work editorial verification remain a dedicated data-maintenance deliverable. The app cannot truthfully publish a Top 300 until that verified snapshot replaces the clearly marked development fixture.
- Consistency: `workId`, `ProgressRecord`, recovery vault, `If-Match` versioning, and ciphertext payload fields use one naming model throughout.
- Placeholder scan: no deferred implementation placeholders are present; release data is intentionally gated rather than represented with fabricated content.
