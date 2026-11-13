import {albumIdOf, apiJson, ApiStatusError, type PublicPhotosPage, validCursor} from "../lib/albums.server";

// The next pages of an album for the gallery's infinite scroll: /albums/<id>-<slug>/photos?cursor=…
export async function loader({params, request}: { params: { album?: string }; request: Request }) {
    const id = albumIdOf(params.album);
    if (!id) return Response.json({error: "not found"}, {status: 404});
    const cursor = new URL(request.url).searchParams.get("cursor");
    const query = new URLSearchParams({limit: "60"});
    if (cursor !== null) {
        if (!validCursor(cursor)) return Response.json({error: "invalid cursor"}, {status: 400});
        query.set("cursor", cursor);
    }
    try {
        const page = await apiJson<PublicPhotosPage>(`/public/albums/${id}/photos?${query}`);
        return Response.json(page, {headers: {"Cache-Control": "public, max-age=60", "X-Robots-Tag": "noindex"}});
    } catch (e) {
        const status = e instanceof ApiStatusError && e.status === 404 ? 404 : 502;
        return Response.json({error: status === 404 ? "not found" : "unavailable"}, {status});
    }
}
