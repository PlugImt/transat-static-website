// Server-only helpers for the photobooth share pages: the browser never talks to the API directly, so the
// pictures stream from this server at the visitor's pace instead of through the API's short write timeout.

const DEFAULT_API = "https://develop.transat.dev";

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

/** A rectangle of a layout in canvas pixels; shot numbers the photo shown in it (1 = first shot). */
export interface FrameZone {
    x: number;
    y: number;
    w: number;
    h: number;
    shot?: number;
}

export interface FrameLayout {
    type: string;
    title: string;
    width: number;
    height: number;
    title_zone?: FrameZone;
    photos: FrameZone[];
    has_frame?: boolean;
}

export interface FrameUpload {
    layout_type: string;
    width: number;
    height: number;
    size: number;
    uploaded_at: string;
}

/** A live link opened by the booth so the organisers can send the frame of each layout of their event. */
export interface FrameSession {
    event_name: string;
    expires_at: string;
    layouts: FrameLayout[];
    uploaded: Record<string, FrameUpload>;
}

const LAYOUT_TYPE_RE = /^[A-Z0-9_]{1,40}$/;

export function validLayoutType(type: string | undefined): type is string {
    return !!type && LAYOUT_TYPE_RE.test(type);
}
