# Ranking data maintenance

The checked-in `src/data/ranking.json` is currently a development sample. This pipeline does not manufacture a Top 300 and never replaces it unless a real, fully validated 300-work release is available.

## Inputs and matching

- `fetch` captures public AniList GraphQL anime records (`id`, `idMal`, titles, average score, popularity, year, studios and genres) and Jikan's public top-anime records (MAL score, score count and members). It needs no credentials.
- `data/ranking/bangumi-mappings.json` is a checked-in, manually reviewed source. It contains no scraper and must have exactly one stable match key per record: `malId` or `anilistId`, plus the reviewed `bangumiId`, Chinese title, score and vote count.
- Matching uses AniList's `idMal` to find a reviewed `malId` record first. Only then can it use an explicit reviewed `anilistId` record. Title-based/fuzzy matching is intentionally absent.
- AniList can expose alternate records with the same `idMal`. Before matching, the pipeline deterministically keeps one record per MAL ID by higher AniList average score, then higher popularity, then smaller AniList ID. Every discarded record is listed in the unmatched review report; this is selection, not a silent merge. Duplicate AniList IDs and duplicate reviewed mapping/Bangumi IDs still fail validation.
- Jikan may also repeat a MAL ID. It keeps one record by higher score, then `scored_by`, then members, then title order; discarded Jikan records are likewise listed in the review report. Mapping and release identity checks remain strict after both source-side selections.

Example reviewed mapping:

```json
[
  {
    "malId": 5114,
    "bangumiId": 975,
    "titleZh": "钢之炼金术师FA",
    "score": 9.1,
    "votes": 25000
  }
]
```

Duplicate AniList/MAL/Bangumi identities are rejected before review output is written.

## Commands

Run these from the repository root. The first command makes external public requests; the latter two are local-only.

```bash
npx tsx scripts/ranking-pipeline.ts fetch --pages 12
npx tsx scripts/ranking-pipeline.ts review
npx tsx scripts/ranking-pipeline.ts release --version 2026-07-12
```

`fetch` requires `--pages` to be a positive integer. AniList pages may be fetched concurrently, but Jikan pages are deliberately single-flight and wait 1 second after each successful page before requesting the next one (never before the first or after the last). A retryable Jikan `429` or `5xx` response retries at most three times: `429` honors `Retry-After` (or its existing bounded delay), while gateway/server `5xx` responses use capped exponential delays of 2, 4, then 8 seconds. Other `4xx` responses fail immediately. Failure errors include the Jikan page number and status for diagnosis. It validates every HTTP/payload response in memory, writes both files to an immutable `data/ranking/captured/generations/<generation>/` directory, then atomically swaps the single `data/ranking/captured/current.json` pointer. Default `review` and `release` resolve that pointer before reading either source, so they always consume one complete generation; a failed capture leaves readers on the prior generation. Old flat `anilist.json`/`jikan.json` files are read only when no pointer exists, for migration compatibility. `review` writes the complete candidate review JSON and a readable `data/ranking/unmatched-report.md`; review that report and add only deliberate mappings. Captures and review output are operational artifacts and are ignored by Git.

`release` does not read `candidate-review.json`. It rebuilds from the captured AniList/Jikan files plus the checked-in reviewed Bangumi mappings, then requires exactly 300 entries with positive, globally unique AniList/MAL/Bangumi IDs, complete snapshot fields and vote eligibility. Candidate review JSON is only a human review artifact. Release uses an adjacent temporary file then rename, so a refusal leaves `src/data/ranking.json` unchanged.

## Bangumi search suggestions (review-only)

When a captured AniList work has no reviewed Bangumi mapping, generate a separate search aid with:

```bash
npx tsx scripts/bangumi-suggestions.ts
```

It reads the current captured AniList/Jikan generation and the checked-in reviewed mappings, then writes ignored operational artifacts under `data/ranking/bangumi-suggestions/`. Each run writes an immutable `generations/<generation>/suggestions.json` and `report.md` pair, then atomically switches `current.json` to that generation. Readers must resolve `current.json` first and read both artifacts from its one generation; they must not combine independently named files. Candidates already covered by a reviewed MAL mapping (before an explicit AniList mapping) are skipped. To review a specific capture pair, provide both `--anilist <path>` and `--jikan <path>`.

The tool sends deliberately paced, single-flight `POST` requests to Bangumi v0 subject search with the anime type filter and a browser-like User-Agent. It uses `BANGUMI_ACCESS_TOKEN` only when supplied through the environment; the token is never written to JSON, Markdown, or logs. Results contain only candidate data and an exact normalized-title indicator. They are never accepted automatically, never write `data/ranking/bangumi-mappings.json`, and have no effect on review or release. The artifact directory is fixed to `data/ranking/bangumi-suggestions/`; captured data, formal mappings, release data, and symlink escapes are rejected. The pointer is swapped only after both generation artifacts are complete, so a failed second artifact or pre-pointer check leaves readers on the prior matching pair. A 401/403, network problem, or malformed subject response produces a resumable blocked report instead of a mapping.

For `review` and `release`, source overrides are intentionally paired: provide both `--anilist <path>` and `--jikan <path>`, or neither to use `current.json`. A single override is rejected before any capture source is read.

## Published method

Scores are normalized to a common 0–100 scale: AniList is already 0–100; MAL and Bangumi are multiplied by 10. The composite is the equal-weight arithmetic mean of those three normalized scores, rounded to four decimal places. Eligibility has an explicit independent threshold of at least 100 source votes for AniList `popularity`, MAL `scored_by`, and the manually reviewed Bangumi `votes` value. This threshold and the method version are emitted with every release snapshot.
