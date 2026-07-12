import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "AI Anim Rank",
  title: {
    default: "AI Anim Rank",
    template: "%s · AI Anim Rank",
  },
  description: "可复核排序的 AI 动画作品排行榜，个人进度保存在本机。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/app-icon-192.png",
  },
  appleWebApp: { capable: true, title: "AI Anim Rank", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#10100f" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
