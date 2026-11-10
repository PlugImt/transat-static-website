import {photoboothApi, validFileId, validToken} from "../lib/photobooth.server";

const PASS_HEADERS = ["content-type", "content-length", "content-disposition", "cache-control", "etag", "last-modified"];

// Streams one picture of a share from the API: ?size=preview for the page, ?download=1 for the original file.
export async function loader({params, request}: { params: { token?: string; id?: string }; request: Request }) {
    if (!validToken(params.token) || !validFileId(params.id)) {
        return new Response("Not found", {status: 404});
    }
    const incoming = new URL(request.url).searchParams;
    const query = new URLSearchParams();
    if (incoming.get("size") === "preview") query.set("size", "preview");
    if (incoming.get("download") === "1") query.set("download", "1");
    const qs = query.toString();

    const upstream = await fetch(`${photoboothApi()}/photobooth/shares/${params.token}/files/${params.id}${qs ? `?${qs}` : ""}`, {
        signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) {
        return new Response(upstream.status === 404 ? "Not found" : "Unavailable", {
            status: upstream.status === 404 ? 404 : 502,
        });
    }
    const headers = new Headers({"X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff"});
    for (const name of PASS_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
    }
    return new Response(upstream.body, {status: 200, headers});
}
