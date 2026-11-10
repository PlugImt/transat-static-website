import {photoboothApi, validLayoutType, validToken} from "../lib/photobooth.server";

const MAX_BYTES = 14 * 1024 * 1024;

const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}});

// Forwards the frame of one layout to the API (multipart, field "file"), from this server so the upload is not
// bound by the browser's CORS rules nor the API's short timeouts on slow phone connections.
export async function action({params, request}: { params: { token?: string; type?: string }; request: Request }) {
    if (request.method !== "POST" || !validToken(params.token) || !validLayoutType(params.type)) {
        return json({error: "Lien invalide"}, 404);
    }
    if (Number(request.headers.get("content-length") || 0) > MAX_BYTES + 64 * 1024) {
        return json({error: "L'image dépasse 14 Mo"}, 413);
    }
    let file: File;
    try {
        const form = await request.formData();
        const value = form.get("file");
        if (!(value instanceof File)) return json({error: "Aucun fichier reçu"}, 400);
        file = value;
    } catch {
        return json({error: "Envoi illisible"}, 400);
    }
    if (file.size > MAX_BYTES) {
        return json({error: "L'image dépasse 14 Mo"}, 413);
    }
    const body = new FormData();
    body.set("file", file, "frame.png");
    let upstream: Response;
    try {
        upstream = await fetch(`${photoboothApi()}/photobooth/frames/${params.token}/${params.type}`, {
            method: "POST",
            body,
            signal: AbortSignal.timeout(60_000),
        });
    } catch {
        return json({error: "Le serveur Transat ne répond pas, réessaie dans un instant"}, 502);
    }
    const payload = await upstream.json().catch(() => ({}));
    if (upstream.status === 404) {
        return json({error: "Ce lien a expiré : affiche un nouveau QR code sur la tablette"}, 404);
    }
    return json(payload, upstream.ok ? 201 : upstream.status >= 500 ? 502 : upstream.status);
}

export function loader() {
    return new Response("Not found", {status: 404});
}
