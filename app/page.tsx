import rankingData from "../src/data/ranking.json";
import { parseRankingSnapshot } from "../src/data/schema.ts";
import { RankingWorkspace } from "../src/features/ranking/RankingWorkspace.tsx";
import { AppStatus } from "../src/features/app/AppStatus.tsx";

export default function Home() {
  const snapshot = parseRankingSnapshot(rankingData);
  const syncBaseUrl = import.meta.env.VITE_SYNC_BASE_URL ?? "";

  return <main><AppStatus syncBaseUrl={syncBaseUrl} /><RankingWorkspace works={snapshot.works} methodologyVersion={snapshot.methodologyVersion} sourceSnapshotVersion={snapshot.version} syncBaseUrl={syncBaseUrl} /></main>;
}
