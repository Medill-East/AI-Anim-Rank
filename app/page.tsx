import type { Metadata } from "next";
import rankingData from "../src/data/ranking.json";
import { parseRankingSnapshot } from "../src/data/schema.ts";
import { RankingWorkspace } from "../src/features/ranking/RankingWorkspace.tsx";

export const metadata: Metadata = {
  title: "AI Anim Rank",
  description: "AI 动画作品排行榜。",
};

export default function Home() {
  const snapshot = parseRankingSnapshot(rankingData);

  return <main><RankingWorkspace works={snapshot.works} /></main>;
}
