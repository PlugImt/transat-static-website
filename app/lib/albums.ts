// Shapes and paths of the public album pages, shared by the server and the browser.

export interface PublicAlbum {
    id: number;
    title: string;
    slug: string;
    event_date: string | null;
    academic_year: string;
    category: string;
    photo_count: number;
    first_taken_at: string | null;
    last_taken_at: string | null;
    cover_id: string | null;
    share_url: string;
}

export interface PublicPhoto {
    id: string;
    width: number;
    height: number;
    sort_at: string;
    has_thumbnail: boolean;
}

export interface PublicPhotosPage {
    photos: PublicPhoto[];
    next_cursor: string | null;
}

export interface PublicAlbumFiles {
    title: string;
    slug: string;
    files: { id: string; name: string; mime_type: string; size_bytes: number }[];
}

/** Canonical path of an album page. */
export const albumPath = (album: Pick<PublicAlbum, "id" | "slug">) =>
    `/albums/${album.id}${album.slug ? `-${album.slug}` : ""}`;
