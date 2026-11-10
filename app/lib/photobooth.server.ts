// Server-only helpers for the photobooth share pages: the browser never talks to the API directly, so the
// pictures stream from this server at the visitor's pace instead of through the API's short write timeout.

const DEFAULT_API = "https://api.transat.dev";

export function photoboothApi(): string {
    return (process.env.PHOTOBOOTH_API_URL || DEFAULT_API).replace(/\/+$/, "");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const ID_RE = /^[1-9][0-9]{0,17}$/;

export function validToken(token: string | undefined): token is string {
    return !!token && TOKEN_RE.test(token);
}

export function validFileId(id: string | undefined): id is string {
    return !!id && ID_RE.test(id);
}

export interface ShareFile {
    id: number;
    kind: "photo" | "collage";
    number: number;
    name: string;
    size_bytes: number;
    width?: number;
    height?: number;
}

export interface Share {
    event_name: string;
    event_date: string;
    taken_at: string;
    files: ShareFile[];
}
