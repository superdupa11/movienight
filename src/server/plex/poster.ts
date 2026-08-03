import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { artPaths } from "../db/movies.js";
import { fetchPlexImage } from "./client.js";

const POSTER_SIZE = { width: 400, height: 600 };
const BACKDROP_SIZE = { width: 1280, height: 720 };

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function transcodeToWebp(
  sourcePlexPath: string,
  destPath: string,
  size: { width: number; height: number },
): Promise<boolean> {
  try {
    const bytes = await fetchPlexImage(sourcePlexPath);
    await mkdir(dirname(destPath), { recursive: true });
    await sharp(bytes).resize(size.width, size.height, { fit: "cover" }).webp({ quality: 82 }).toFile(destPath);
    return true;
  } catch (err) {
    console.warn(`[poster] transcode failed for ${sourcePlexPath}:`, (err as Error).message);
    return false;
  }
}

/**
 * Cheap disk check first, transcode only on a miss (PROTOCOL §3 "What actually
 * needs warming"). Doubles as the broken-art check: a movie whose source never
 * downloaded comes back with hasPoster: false so the caller can drop it from
 * the deck rather than showing a grey rectangle.
 */
export async function ensureArt(
  movieId: string,
  plexThumbPath: string | null,
  plexArtPath: string | null,
): Promise<{ hasPoster: boolean; hasBackdrop: boolean }> {
  const { posterPath, backdropPath } = artPaths(movieId);

  let hasPoster = await pathExists(posterPath);
  if (!hasPoster && plexThumbPath) hasPoster = await transcodeToWebp(plexThumbPath, posterPath, POSTER_SIZE);

  let hasBackdrop = await pathExists(backdropPath);
  if (!hasBackdrop && plexArtPath) hasBackdrop = await transcodeToWebp(plexArtPath, backdropPath, BACKDROP_SIZE);

  return { hasPoster, hasBackdrop };
}
