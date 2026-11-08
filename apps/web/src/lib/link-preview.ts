import type { Metadata } from "next";

// The link preview every page shares (Open Graph; X builds its card from the same tags): a still
// card everywhere, and a silent 10 s loop where the app plays one (Telegram, iMessage, Discord).
// Both come from the video engine (pdoom-video-engine, projects/probabl/videos/2026-10-og-loop):
// the image is the loop's first frame, so the poster turns into the video without a jump.

export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://probabl.trade";
export const SITE_TITLE = "probabl — Event-driven stock markets";

/** 1200×630 (1.91:1, the large-card shape); a JPEG, since WhatsApp drops previews over ~300 KB. */
export const PREVIEW_IMAGE = {
  url: "/og.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: SITE_TITLE,
};

/** A direct MP4 (H.264, no audio, moov first, 1.6 MB), served with byte ranges by worker.ts. */
export const PREVIEW_VIDEO = {
  path: "/og-video.mp4",
  type: "video/mp4",
  width: 1280,
  height: 672,
} as const;

/** Worlds' own preview, on every /worlds link: a world said, its futures narrowing through a gate
 * per part, and what it pays (pdoom-video-engine, projects/probabl/videos/2026-11-worlds-og). */
export const WORLDS_PREVIEW_IMAGE = {
  url: "/og-worlds.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: "probabl Worlds: bet on your what if",
};
export const WORLDS_PREVIEW_VIDEO = { ...PREVIEW_VIDEO, path: "/og-worlds.mp4" } as const;

/** Every preview video, each served with byte ranges by worker.ts. */
export const PREVIEW_VIDEO_PATHS: readonly string[] = [
  PREVIEW_VIDEO.path,
  WORLDS_PREVIEW_VIDEO.path,
];

// Next resolves Open Graph image URLs against metadataBase but writes video URLs as given.
const videoOf = (video: typeof PREVIEW_VIDEO | typeof WORLDS_PREVIEW_VIDEO) => {
  const url = new URL(video.path, SITE_URL).toString();
  return { url, secureUrl: url, type: video.type, width: video.width, height: video.height };
};

export const LINK_PREVIEW = {
  type: "website",
  siteName: "probabl",
  images: [PREVIEW_IMAGE],
  videos: [videoOf(PREVIEW_VIDEO)],
} satisfies Metadata["openGraph"];

export const WORLDS_LINK_PREVIEW = {
  type: "website",
  siteName: "probabl",
  title: "Bet on your what if. · probabl Worlds",
  description:
    "Pick the events you believe in and where a stock closes. probabl prices your world from Polymarket and Kalshi and shows what $20 pays if it all happens.",
  images: [WORLDS_PREVIEW_IMAGE],
  videos: [videoOf(WORLDS_PREVIEW_VIDEO)],
} satisfies Metadata["openGraph"];
