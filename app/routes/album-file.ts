import {albumIdOf, proxyFile, validPhotoId} from "../lib/albums.server";

const VARIANTS = new Set(["grid", "preview", "original"]);

// One image of an album: /albums/<album>/photos/<photo>/grid|preview|original (?download=1 to save it).
export async function loader({params, request}: {
    params: { album?: string; photo?: string; variant?: string };
    request: Request;
}) {
    const id = albumIdOf(params.album);
    if (!id || !validPhotoId(params.photo) || !params.variant || !VARIANTS.has(params.variant)) {
        return new Response("Not found", {status: 404});
    }
    const download = params.variant === "original" && new URL(request.url).searchParams.get("download") === "1";
    return proxyFile(`/public/albums/${id}/photos/${params.photo}/${params.variant}${download ? "?download=1" : ""}`, request);
}
