import { config } from "../config.js";

export type PlexTagRef = { id?: number; tag: string; role?: string; order?: number };

export type PlexMetadataItem = {
  ratingKey: string;
  title: string;
  year?: number;
  duration?: number; // ms
  summary?: string;
  tagline?: string;
  thumb?: string;
  art?: string;
  contentRating?: string;
  rating?: number; // critic rating, 0-10
  audienceRating?: number; // 0-10
  viewCount?: number;
  updatedAt?: number; // epoch seconds
  Genre?: { tag: string }[];
  Director?: PlexTagRef[];
  Role?: PlexTagRef[];
};

type PlexDirectory = { key: string; type: string; title: string };

function plexUrl(path: string): string {
  const url = new URL(config.plex.url + path);
  url.searchParams.set("X-Plex-Token", config.plex.token);
  return url.toString();
}

async function plexFetchJson<T>(path: string): Promise<T> {
  const res = await fetch(plexUrl(path), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Plex ${path} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function getMovieSectionKeys(): Promise<string[]> {
  if (config.plex.sections.length > 0) return config.plex.sections;
  const data = await plexFetchJson<{ MediaContainer: { Directory: PlexDirectory[] } }>("/library/sections");
  return data.MediaContainer.Directory.filter((d) => d.type === "movie").map((d) => d.key);
}

/** One call per section — gives everything except cast/directors. */
export async function getSectionMovies(sectionKey: string): Promise<PlexMetadataItem[]> {
  const data = await plexFetchJson<{ MediaContainer: { Metadata?: PlexMetadataItem[] } }>(
    `/library/sections/${sectionKey}/all`,
  );
  return data.MediaContainer.Metadata ?? [];
}

/** Per-movie call for Director + Role tags. N+1 — nightly only, never on the request path. */
export async function getMovieDetail(ratingKey: string): Promise<PlexMetadataItem | undefined> {
  const data = await plexFetchJson<{ MediaContainer: { Metadata?: PlexMetadataItem[] } }>(
    `/library/metadata/${ratingKey}`,
  );
  return data.MediaContainer.Metadata?.[0];
}

/** Fetches raw poster/backdrop bytes from a Plex-relative thumb/art path (e.g. `/library/metadata/123/thumb/167`). */
export async function fetchPlexImage(relativePath: string): Promise<Buffer> {
  const res = await fetch(plexUrl(relativePath));
  if (!res.ok) throw new Error(`Plex image ${relativePath} -> ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}
