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

// Next resolves Open Graph image URLs against metadataBase but writes video URLs as given.
const videoUrl = new URL(PREVIEW_VIDEO.path, SITE_URL).toString();

export const LINK_PREVIEW = {
  type: "website",
  siteName: "probabl",
  images: [PREVIEW_IMAGE],
  videos: [
    {
      url: videoUrl,
      secureUrl: videoUrl,
      type: PREVIEW_VIDEO.type,
      width: PREVIEW_VIDEO.width,
      height: PREVIEW_VIDEO.height,
    },
  ],
} satisfies Metadata["openGraph"];
