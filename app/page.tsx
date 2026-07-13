import rankingData from "../src/data/ranking.json";
import { parseRankingSnapshot } from "../src/data/schema.ts";
import { RankingWorkspace } from "../src/features/ranking/RankingWorkspace.tsx";
import { AppStatus } from "../src/features/app/AppStatus.tsx";

export default function Home() {
  const snapshot = parseRankingSnapshot(rankingData);

  return <main><AppStatus syncBaseUrl={process.env.VITE_SYNC_BASE_URL ?? ""} /><RankingWorkspace works={snapshot.works} methodologyVersion={snapshot.methodologyVersion} sourceSnapshotVersion={snapshot.version} /></main>;
}
