# AI Anim Rank Layout, Methodology, and Neutral Worker Deployment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the ranking workspace's scanability, add an honest ranking-methodology disclosure, and publish the release through a neutral Cloudflare Workers URL.

**Architecture:** Keep the existing single workspace component and local-progress model. Pass the parsed snapshot's methodology version into that component, render a native disclosure before filtering, and use CSS grid/table constraints to prevent unrelated labels and action buttons from wrapping each other. Deploy the existing Vinext Worker to a renamed, neutral account `workers.dev` subdomain; do not move or configure the optional sync API.

**Tech Stack:** React 19, TypeScript, CSS, node:test + JSDOM, Vinext/Vite, Wrangler/Cloudflare Pages.

---

### Task 1: Specify the new public ranking explanation

**Files:**
- Modify: `tests/ranking-workspace-dom.test.tsx`
- Modify: `src/features/ranking/RankingWorkspace.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Write the failing DOM test**

Add a static-render test that gives `RankingWorkspace` `methodologyVersion="v1-auditable-three-source"` and asserts all of the following:

```ts
assert.match(html, /排名依据/);
assert.match(html, /AniList/);
assert.match(html, /MyAnimeList/);
assert.match(html, /Bangumi/);
assert.match(html, /统一换算为 0–100/);
assert.match(html, /三个来源等权/);
assert.match(html, /v1-auditable-three-source/);
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `npx tsx --test tests/ranking-workspace-dom.test.tsx`

Expected: the new assertion fails because no methodology disclosure exists.

- [ ] **Step 3: Implement the smallest public disclosure**

Add an optional `methodologyVersion` prop to `RankingWorkspace`, pass `snapshot.methodologyVersion` in `app/page.tsx`, and render this native `details` section before the search form:

```tsx
<details className="ranking-methodology">
  <summary>排名依据 <span>三源等权 · 可复核快照</span></summary>
  <div>
    <p>本榜单汇总 AniList、MyAnimeList（MAL）与 Bangumi 的公开评分。</p>
    <p>三个来源统一换算为 0–100 后等权取平均；样本量仅用于最低门槛筛选。</p>
    <p>条目通过可审阅的跨站映射合并；续作、剧场版与独立作品分别计入。</p>
    <p>数据版本：{methodologyVersion}。它适合作为发现作品的入口，不替代个人判断。</p>
  </div>
</details>
```

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run: `npx tsx --test tests/ranking-workspace-dom.test.tsx`

Expected: 0 failing tests.

- [ ] **Step 5: Commit the behavior**

```bash
git add app/page.tsx src/features/ranking/RankingWorkspace.tsx tests/ranking-workspace-dom.test.tsx
git commit -m "feat: explain ranking methodology"
```

### Task 2: Make the desktop controls and rows structurally stable

**Files:**
- Modify: `tests/ranking-workspace-dom.test.tsx`
- Modify: `src/features/ranking/RankingWorkspace.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the failing DOM structure test**

Assert the rendered form contains five `label.filter-field` elements and the personal controls contain four buttons in an element with class `progress-controls`. Also assert the table has an explicit colgroup.

```ts
assert.equal(document.querySelectorAll(".ranking-controls .filter-field").length, 5);
assert.equal(document.querySelectorAll(".progress-controls button").length, 4);
assert.ok(document.querySelector(".ranking-table-region colgroup"));
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run: `npx tsx --test tests/ranking-workspace-dom.test.tsx`

Expected: the filter-field and colgroup assertions fail.

- [ ] **Step 3: Implement the minimal stable markup and layout rules**

Wrap each search/select in a `label.filter-field` with a nested label-text span. Insert a six-column `colgroup` in the desktop table. Change `.progress-controls` to a two-column grid and make action labels single-line. Replace positional selectors in `app/globals.css` with:

```css
.ranking-controls { grid-template-columns: minmax(16rem, 2fr) repeat(4, minmax(8rem, 1fr)) auto; }
.filter-field { display: grid; gap: 6px; }
.ranking-table-region table { table-layout: fixed; }
.progress-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
```

Add constrained line-clamping for title/original-title/genre cells, and use the existing mobile breakpoint to let filter fields reflow without splitting each label from its control.

- [ ] **Step 4: Re-run the targeted test and verify it passes**

Run: `npx tsx --test tests/ranking-workspace-dom.test.tsx`

Expected: 0 failing tests.

- [ ] **Step 5: Commit the layout behavior**

```bash
git add app/globals.css src/features/ranking/RankingWorkspace.tsx tests/ranking-workspace-dom.test.tsx
git commit -m "feat: stabilize ranking workspace layout"
```

### Task 3: Validate a neutral Worker release

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `tests/release-build.test.mjs`

- [ ] **Step 1: Write the failing release-command test**

Extend `tests/release-build.test.mjs` to assert the package scripts include `site:deploy` and that README documents `ai-anim-rank.play-with-experiences.workers.dev` as the intended neutral public URL.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/release-build.test.mjs`

Expected: failure because neither deployment command nor neutral Worker documentation exists.

- [ ] **Step 3: Implement the release entry point**

Add this package script:

```json
"site:deploy": "VITE_RELEASE_BUILD=true vinext deploy --name ai-anim-rank"
```

Replace the obsolete Sites hosting section in `README.md` with Worker build and deployment instructions, stating that the configured `workers.dev` URL is neutral and that optional sync remains a separate Worker.

- [ ] **Step 4: Re-run the test and verify it passes**

Run: `node --test tests/release-build.test.mjs`

Expected: 0 failures.

- [ ] **Step 5: Run the release build**

Run: `VITE_RELEASE_BUILD=true npm run build`

Expected: exit 0 and the Vinext Worker build completes.

- [ ] **Step 6: Deploy the Worker and verify the neutral public URL**

Run: `npm run site:deploy`

Expected: Vinext reports `https://ai-anim-rank.play-with-experiences.workers.dev`. If the renamed account subdomain has not finished propagating, stop before claiming the public deployment is available.

- [ ] **Step 7: Commit the release documentation**

```bash
git add README.md package.json tests/release-build.test.mjs
git commit -m "chore: add neutral Worker deployment"
```

### Task 4: Final verification and visual audit

**Files:**
- Verify: `tests/ranking-workspace-dom.test.tsx`
- Verify: `app/globals.css`
- Verify: deployed Worker URL

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`

Expected: exit 0 with no test failures.

- [ ] **Step 2: Run static checks**

Run: `npm run lint && npx tsc --noEmit`

Expected: both commands exit 0.

- [ ] **Step 3: Inspect the live Worker desktop layout**

Use the browser session to capture a desktop viewport at the neutral Worker URL. Confirm the methodology disclosure is present, filter labels remain paired with their controls, score/mark columns do not wrap unexpectedly, and the four marks form two rows of two buttons.

- [ ] **Step 4: Commit the accepted design document update**

```bash
git add docs/superpowers/specs/2026-07-13-layout-and-pages.md docs/superpowers/plans/2026-07-13-layout-methodology-and-pages.md
git commit -m "docs: record ranking methodology presentation"
```
