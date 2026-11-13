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

export async function loader({params, request}: { params: { album?: string }; request: Request }) {
    const id = albumIdOf(params.album);
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
    const name = `${folder}.zip`;
    return new Response(zip.body, {
        headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${name}"`,
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
        },
    });
}
