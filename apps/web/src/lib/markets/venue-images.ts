/** The venues' artwork hosts, served through this site's `/media/<venue>/…` route instead of
 * directly: where a venue's site is blocked its image host is too (Kalshi's `assets.kalshi.com`
 * resolves to a block page on some networks), and an event's image should show wherever the app
 * itself loads. Only these hosts are fetched, so the route can't serve anything else. */
export const VENUE_IMAGE_HOSTS = {
  kalshi: "assets.kalshi.com",
  polymarket: "polymarket-upload.s3.us-east-2.amazonaws.com",
} as const;
type Venue = keyof typeof VENUE_IMAGE_HOSTS;

export const MEDIA_PATH = "/media";

/** `url` as the app loads it: a venue's image through this site, any other URL as it is. */
export function venueImageUrl(url: string | null): string | null {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const venue = (Object.keys(VENUE_IMAGE_HOSTS) as Venue[]).find(
    (key) => VENUE_IMAGE_HOSTS[key] === parsed.hostname,
  );
  return venue && parsed.protocol === "https:" && !parsed.port && !parsed.search
    ? `${MEDIA_PATH}/${venue}${parsed.pathname}`
    : url;
}

/** The venue image a `/media/<venue>/<path>` request names, or null for anything else. */
export function venueImageSource(pathname: string): URL | null {
  const match = /^\/media\/([a-z]+)(\/[^?#]+)$/.exec(pathname);
  if (!match?.[1] || !match[2] || !Object.hasOwn(VENUE_IMAGE_HOSTS, match[1])) return null;
  const host = VENUE_IMAGE_HOSTS[match[1] as Venue];
  const url = new URL(`https://${host}${match[2]}`);
  return url.hostname === host ? url : null;
}
