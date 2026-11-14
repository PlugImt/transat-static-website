import {albumIdOf, albumsApi} from "../lib/albums.server";

// POST /albums/<id>-<slug>/visit: the public album was opened; forwarded to the API.
export async function action({params, request}: { params: { album?: string }; request: Request }) {
    const id = albumIdOf(params.album);
    if (request.method !== "POST" || !id) {
        return new Response(null, {status: 404});
    }
    const body = (await request.text()).slice(0, 1024);
    const upstream = await fetch(`${albumsApi()}/public/albums/${id}/visits`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body,
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    return new Response(null, {status: upstream?.ok ? 204 : 502});
}
