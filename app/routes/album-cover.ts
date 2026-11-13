import {albumIdOf, proxyFile} from "../lib/albums.server";

// The album's cover: the image of its share cards (Open Graph) and the backdrop of its page.
export async function loader({params, request}: { params: { album?: string }; request: Request }) {
    const id = albumIdOf(params.album);
    if (!id) return new Response("Not found", {status: 404});
    return proxyFile(`/public/albums/${id}/cover`, request);
}
