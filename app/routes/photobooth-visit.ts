import {photoboothApi, validToken} from "../lib/photobooth.server";

// POST /photobooth/<token>/visit: the share page was opened (its QR code scanned); forwarded to the API.
export async function action({params, request}: { params: { token?: string }; request: Request }) {
    if (request.method !== "POST" || !validToken(params.token)) {
        return new Response(null, {status: 404});
    }
    const body = (await request.text()).slice(0, 1024);
    const upstream = await fetch(`${photoboothApi()}/photobooth/shares/${params.token}/visits`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body,
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    return new Response(null, {status: upstream?.ok ? 204 : 502});
}
