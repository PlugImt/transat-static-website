import {downloadZip} from "client-zip";
import {albumIdOf, albumsApi, apiJson, ApiStatusError, type PublicAlbumFiles} from "../lib/albums.server";

// The whole album as one zip of the original files, built here one photo at a time: the API only ever streams a
// single original, which fits in its write timeout, while this response can last as long as the visitor needs.
// Photos are stored as they are (no compression: JPEGs do not shrink), so the archive starts at once.

const MAX_CONCURRENT = 3;
let running = 0;

function uniqueName(name: string, used: Set<string>): string {
    const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "photo.jpg";
    let candidate = clean;
    const dot = clean.lastIndexOf(".");
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : "";
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
}

const MAX_SELECTED = 2000;
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

// GET: the whole album.
export async function loader({params, request}: { params: { album?: string }; request: Request }) {
    return zip(params.album, request, null);
}

// POST with "ids" (comma-separated photo ids): only the photos the visitor selected. A form post, so the browser
// saves the archive and stays on the page.
export async function action({params, request}: { params: { album?: string }; request: Request }) {
    let raw = "";
    try {
        raw = String((await request.formData()).get("ids") ?? "");
    } catch {
        return new Response("Bad request", {status: 400});
    }
    const ids = new Set(raw.split(",").map((s) => s.trim()).filter((s) => PHOTO_ID_RE.test(s)));
    if (ids.size === 0 || ids.size > MAX_SELECTED) return new Response("Bad request", {status: 400});
    return zip(params.album, request, ids);
}

async function zip(segment: string | undefined, request: Request, only: Set<string> | null) {
    const id = albumIdOf(segment);
    if (!id) return new Response("Not found", {status: 404});
    if (running >= MAX_CONCURRENT) {
        return new Response("Trop de téléchargements en cours, réessayez dans quelques minutes.", {
            status: 429,
            headers: {"Retry-After": "120", "Content-Type": "text/plain; charset=utf-8"},
        });
    }

    let album: PublicAlbumFiles;
    try {
        album = await apiJson<PublicAlbumFiles>(`/public/albums/${id}/files`);
    } catch (e) {
        const notFound = e instanceof ApiStatusError && e.status === 404;
        return new Response(notFound ? "Not found" : "Unavailable", {status: notFound ? 404 : 502});
    }
    // Only photos of this album, whatever ids were posted.
    if (only) album.files = album.files.filter((f) => only.has(f.id));
    if (album.files.length === 0) return new Response("Not found", {status: 404});

    const folder = album.slug || `album-${id}`;
    const used = new Set<string>();
    running++;
    let released = false;
    const release = () => {
        if (!released) {
            released = true;
            running--;
        }
    };
    request.signal.addEventListener("abort", release);

    async function* files() {
        try {
            for (const f of album.files) {
                if (request.signal.aborted) return;
                const res = await fetch(`${albumsApi()}/public/albums/${id}/photos/${f.id}/original`, {signal: request.signal});
                if (!res.ok || !res.body) {
                    // A photo removed since the list was read: the archive goes on without it.
                    await res.body?.cancel();
                    continue;
                }
                yield {name: `${folder}/${uniqueName(f.name, used)}`, input: res, size: f.size_bytes || undefined};
            }
        } finally {
            release();
        }
    }

    const zip = downloadZip(files());
    const name = only ? `${folder}-${album.files.length}-photos.zip` : `${folder}.zip`;
    return new Response(zip.body, {
        headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${name}"`,
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
        },
    });
}
