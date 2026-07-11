import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Anim Rank",
  description: "AI 动画作品排行榜。",
};

export default function Home() {
  return (
    <main>
      <h1>AI Anim Rank</h1>
      <form role="search">
        <label htmlFor="work-search">搜索作品</label>
        <input id="work-search" type="search" name="query" />
      </form>
    </main>
  );
}
