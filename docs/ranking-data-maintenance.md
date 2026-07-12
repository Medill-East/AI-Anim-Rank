# Ranking data maintenance

The checked-in `src/data/ranking.json` is currently a development sample. This pipeline does not manufacture a Top 300 and never replaces it unless a real, fully validated 300-work release is available.

## Inputs and matching

- `fetch` captures public AniList GraphQL anime records (`id`, `idMal`, titles, average score, popularity, year, studios and genres) and Jikan's public top-anime records (MAL score, score count and members). It needs no credentials.
- `data/ranking/bangumi-mappings.json` is a checked-in, manually reviewed source. It contains no scraper and must have exactly one stable match key per record: `malId` or `anilistId`, plus the reviewed `bangumiId`, Chinese title, score and vote count.
- Matching uses AniList's `idMal` to find a reviewed `malId` record first. Only then can it use an explicit reviewed `anilistId` record. Title-based/fuzzy matching is intentionally absent.

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

`fetch` requires `--pages` to be a positive integer. It validates every HTTP/payload response in memory, writes both files to an immutable `data/ranking/captured/generations/<generation>/` directory, then atomically swaps the single `data/ranking/captured/current.json` pointer. Default `review` and `release` resolve that pointer before reading either source, so they always consume one complete generation; a failed capture leaves readers on the prior generation. Old flat `anilist.json`/`jikan.json` files are read only when no pointer exists, for migration compatibility. `review` writes the complete candidate review JSON and a readable `data/ranking/unmatched-report.md`; review that report and add only deliberate mappings. Captures and review output are operational artifacts and are ignored by Git.

`release` does not read `candidate-review.json`. It rebuilds from the captured AniList/Jikan files plus the checked-in reviewed Bangumi mappings, then requires exactly 300 entries with positive, globally unique AniList/MAL/Bangumi IDs, complete snapshot fields and vote eligibility. Candidate review JSON is only a human review artifact. Release uses an adjacent temporary file then rename, so a refusal leaves `src/data/ranking.json` unchanged.

For `review` and `release`, source overrides are intentionally paired: provide both `--anilist <path>` and `--jikan <path>`, or neither to use `current.json`. A single override is rejected before any capture source is read.

## Published method

Scores are normalized to a common 0–100 scale: AniList is already 0–100; MAL and Bangumi are multiplied by 10. The composite is the equal-weight arithmetic mean of those three normalized scores, rounded to four decimal places. Eligibility has an explicit independent threshold of at least 100 source votes for AniList `popularity`, MAL `scored_by`, and the manually reviewed Bangumi `votes` value. This threshold and the method version are emitted with every release snapshot.
