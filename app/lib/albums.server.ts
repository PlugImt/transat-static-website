// Server-only helpers for the public album pages (transat.dev/albums/<id>-<slug>). The browser never talks to the
// API: every call and every image goes through this server, so the pages only ever show transat.dev addresses and
// the photos stream at the visitor's pace instead of through the API's short write timeout.

import type {PublicAlbum, PublicAlbumFiles, PublicPhoto, PublicPhotosPage} from "./albums";

export type {PublicAlbum, PublicAlbumFiles, PublicPhoto, PublicPhotosPage};
export {albumPath} from "./albums";

// Production by default: a deployment without ALBUMS_API_URL / PHOTOBOOTH_API_URL must never read the develop
// database. The develop site sets one of them to https://develop.transat.dev.
const DEFAULT_API = "https://api.transat.dev";

export function albumsApi(): string {
    return (process.env.ALBUMS_API_URL || process.env.PHOTOBOOTH_API_URL || DEFAULT_API).replace(/\/+$/, "");
}

/** "42" or "42-soiree-de-gala": the id decides, the slug is decoration and may be stale. */
const SEGMENT_RE = /^([1-9][0-9]{0,11})(?:-[A-Za-z0-9-]{0,120})?$/;
const PHOTO_RE = /^[A-Za-z0-9_-]{10,100}$/;
const CURSOR_RE = /^[A-Za-z0-9_-]{1,400}$/;

export function albumIdOf(segment: string | undefined): string | null {
    const m = segment ? SEGMENT_RE.exec(segment) : null;
    return m ? m[1] : null;
}

export function validPhotoId(id: string | undefined): id is string {
    return !!id && PHOTO_RE.test(id);
}

export function validCursor(cursor: string | null): cursor is string {
    return !!cursor && CURSOR_RE.test(cursor);
}

export class ApiStatusError extends Error {
    constructor(readonly status: number) {
        super(`API answered ${status}`);
    }
}

export async function apiJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${albumsApi()}${path}`, {
        headers: {Accept: "application/json"},
        signal: signal ?? AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new ApiStatusError(res.status);
    return (await res.json()) as T;
}

const PASS_HEADERS = ["content-type", "content-length", "content-disposition", "cache-control", "etag", "last-modified"];

/** Streams an API response to the visitor with only the headers that describe the file. */
export async function proxyFile(apiPath: string, request: Request): Promise<Response> {
    const upstream = await fetch(`${albumsApi()}${apiPath}`, {signal: request.signal});
    if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel();
        const notFound = upstream.status === 404;
        return new Response(notFound ? "Not found" : "Unavailable", {status: notFound ? 404 : 502});
    }
    const headers = new Headers({"X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff"});
    for (const name of PASS_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
    }
    return new Response(upstream.body, {status: 200, headers});
}
