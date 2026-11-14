import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {data, redirect, useLoaderData} from "react-router";
import {useTranslation} from "react-i18next";
import {FaArrowLeft, FaArrowRight, FaCheck, FaDownload, FaExpand, FaHandPointer, FaRegCheckCircle, FaSearchMinus, FaSearchPlus, FaShareAlt, FaTimes} from "react-icons/fa";

import {albumPath, type PublicAlbum, type PublicPhoto, type PublicPhotosPage} from "../lib/albums";
import {albumIdOf, apiJson, ApiStatusError} from "../lib/albums.server";
import {mosaicBlocks, type MosaicTile} from "../lib/mosaic";
import {useReportVisit} from "../lib/visit";

export async function loader({params}: { params: { album?: string } }) {
    const id = albumIdOf(params.album);
    if (!id) throw data("Not found", {status: 404});
    let album: PublicAlbum;
    let page: PublicPhotosPage;
    try {
        [album, page] = await Promise.all([
            apiJson<PublicAlbum>(`/public/albums/${id}`),
            apiJson<PublicPhotosPage>(`/public/albums/${id}/photos?limit=60`),
        ]);
    } catch (e) {
        if (e instanceof ApiStatusError && e.status === 404) throw data("Not found", {status: 404});
        throw data("Unavailable", {status: 503});
    }
    // One address per album: an old or truncated slug leads to the current one.
    const canonical = albumPath(album);
    if (`/albums/${params.album}` !== canonical) throw redirect(canonical, 301);
    return data({album, page}, {headers: {"Cache-Control": "public, max-age=60", "X-Robots-Tag": "noindex"}});
}

export function headers({loaderHeaders}: { loaderHeaders: Headers }) {
    return loaderHeaders;
}

export function links() {
    return [
        {rel: "preconnect", href: "https://fonts.googleapis.com"},
        {rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous"},
        {rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap"},
    ];
}

function formatEventDate(album: PublicAlbum, lang: string): string {
    const opts: Intl.DateTimeFormatOptions = {day: "numeric", month: "long", year: "numeric", timeZone: "UTC"};
    if (album.event_date) return new Date(`${album.event_date}T12:00:00Z`).toLocaleDateString(lang, opts);
    if (album.first_taken_at) return new Date(album.first_taken_at).toLocaleDateString(lang, opts);
    return "";
}

export function meta({data: d}: { data?: { album: PublicAlbum } }) {
    if (!d) return [{title: "Album introuvable · Transat"}, {name: "robots", content: "noindex"}];
    const {album} = d;
    const origin = new URL(album.share_url).origin;
    const date = formatEventDate(album, "fr");
    const title = `${album.title} · Photos Transat`;
    const description = [`${album.photo_count} photo${album.photo_count > 1 ? "s" : ""}`, date, album.category]
        .filter(Boolean)
        .join(" · ");
    const tags: Record<string, string>[] = [
        {title},
        {name: "description", content: description},
        // Photos of students: shareable by link, never listed by search engines.
        {name: "robots", content: "noindex, nofollow"},
        {name: "theme-color", content: "#070402"},
        {property: "og:type", content: "website"},
        {property: "og:site_name", content: "Transat"},
        {property: "og:title", content: album.title},
        {property: "og:description", content: description},
        {property: "og:url", content: album.share_url},
        {property: "og:locale", content: "fr_FR"},
        {name: "twitter:card", content: album.cover_id ? "summary_large_image" : "summary"},
        {name: "twitter:title", content: album.title},
        {name: "twitter:description", content: description},
        {tagName: "link", rel: "canonical", href: album.share_url},
    ];
    if (album.cover_id) {
        const image = `${origin}${albumPath(album)}/cover`;
        tags.push(
            {property: "og:image", content: image},
            {property: "og:image:alt", content: album.title},
            {name: "twitter:image", content: image},
        );
    }
    return tags;
}

/* Transat colours: orange, blue, beige, and the app's dark backgrounds. */
const C = {
    page: "#070402",
    card: "#1e1515",
    border: "rgba(255,230,204,0.12)",
    text: "#ffe6cc",
    muted: "rgba(255,230,204,0.6)",
    primary: "#ec7f32",
    blue: "#0049a8",
};

const photoUrl = (base: string, id: string, variant: "grid" | "preview" | "original", download = false) =>
    `${base}/photos/${id}/${variant}${download ? "?download=1" : ""}`;

/** Width / height, kept within bounds so a panorama or a sliver never breaks a row. */
const ratioOf = (p: PublicPhoto) => {
    const r = p.width > 0 && p.height > 0 ? p.width / p.height : 1.5;
    return Math.min(Math.max(r, 0.5), 2.6);
};

function useInfinitePhotos(base: string, first: PublicPhotosPage) {
    const [photos, setPhotos] = useState(first.photos);
    const [cursor, setCursor] = useState(first.next_cursor);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const inFlight = useRef(false);

    const loadMore = useCallback(async () => {
        if (!cursor || inFlight.current) return;
        inFlight.current = true;
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch(`${base}/photos?cursor=${encodeURIComponent(cursor)}`);
            if (!res.ok) throw new Error(String(res.status));
            const page = (await res.json()) as PublicPhotosPage;
            setPhotos((prev) => {
                const seen = new Set(prev.map((p) => p.id));
                return [...prev, ...page.photos.filter((p) => !seen.has(p.id))];
            });
            setCursor(page.next_cursor);
        } catch {
            setFailed(true);
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }, [base, cursor]);

    return {photos, hasMore: cursor !== null, loading, failed, loadMore};
}

/**
 * Saves a photo the way the phone expects: the share sheet ("Enregistrer l'image") where the browser can share
 * files, a plain download elsewhere. Always the original file.
 */
async function savePhoto(url: string, name: string) {
    const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    try {
        if (coarse && typeof navigator !== "undefined" && "canShare" in navigator) {
            const blob = await (await fetch(url)).blob();
            const file = new File([blob], name, {type: blob.type || "image/jpeg"});
            if (navigator.canShare({files: [file]})) {
                await navigator.share({files: [file]});
                return;
            }
        }
    } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return; // the visitor closed the share sheet
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

export default function AlbumPage() {
    const {album, page} = useLoaderData<typeof loader>();
    const {t, i18n} = useTranslation();
    const base = albumPath(album);
    useReportVisit(`${base}/visit`);
    const {photos, hasMore, loading, failed, loadMore} = useInfinitePhotos(base, page);
    const [open, setOpen] = useState<number | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [saving, setSaving] = useState(false);
    const sentinel = useRef<HTMLDivElement>(null);
    const titleRef = useRef<HTMLHeadingElement>(null);
    const date = formatEventDate(album, i18n.language || "fr");
    const countLabel = t("albums.photoCount", {count: album.photo_count});

    // Next page well before the end of the grid.
    useEffect(() => {
        const el = sentinel.current;
        if (!el || !hasMore) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) void loadMore();
        }, {rootMargin: "1200px 0px"});
        io.observe(el);
        return () => io.disconnect();
    }, [hasMore, loadMore]);

    useEffect(() => {
        if (!toast) return;
        const id = setTimeout(() => setToast(null), 2600);
        return () => clearTimeout(id);
    }, [toast]);

    const stopSelecting = useCallback(() => {
        setSelecting(false);
        setSelected(new Set());
    }, []);

    // Escape leaves the selection (the lightbox handles its own Escape).
    useEffect(() => {
        if (!selecting || open !== null) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") stopSelecting();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [selecting, open, stopSelecting]);

    const toggle = useCallback((id: string) => {
        setSelecting(true);
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else if (next.size >= MAX_SELECTION) {
                setToast(t("albums.selectionLimit", {count: MAX_SELECTION}));
                return prev;
            } else next.add(id);
            return next;
        });
    }, [t]);

    const [menu, setMenu] = useState<{ photo: PublicPhoto; index: number } | null>(null);
    const slug = album.slug || `album-${album.id}`;

    const downloadOne = useCallback(async (photo: PublicPhoto, index: number) => {
        setToast(t("albums.downloading"));
        await savePhoto(photoUrl(base, photo.id, "original", true), `${slug}-${index + 1}.jpg`);
    }, [base, slug, t]);

    const downloadSelected = async () => {
        // Grid order, not the order of the clicks.
        const ids = photos.filter((p) => selected.has(p.id)).map((p) => p.id);
        if (ids.length === 0 || saving) return;
        setSaving(true);
        try {
            const result = await saveSelection(base, slug, ids);
            if (result === "zip") setToast(t("albums.zipStarting"));
            if (result !== "cancelled") stopSelecting();
        } finally {
            setSaving(false);
        }
    };

    const shareAlbum = async () => {
        try {
            if (navigator.share) {
                await navigator.share({title: album.title, url: album.share_url});
                return;
            }
            await navigator.clipboard.writeText(album.share_url);
            setToast(t("albums.linkCopied"));
        } catch {
            // closed by the visitor
        }
    };

    return (
        <div className="min-h-screen" style={{background: C.page, color: C.text, fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"}}>
            {album.cover_id && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
                    <img src={`${base}/cover`} alt="" className="h-full w-full scale-110 object-cover opacity-30 blur-3xl"/>
                    <div className="absolute inset-0" style={{background: `linear-gradient(to bottom, rgba(7,4,2,0.2), ${C.page})`}}/>
                </div>
            )}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
                style={{background: "radial-gradient(60% 70% at 50% 0%, rgba(236,127,50,0.20), transparent 70%)"}}
            />

            <StickyBar
                titleRef={titleRef}
                title={album.title}
                count={countLabel}
                selecting={selecting}
                onSelect={() => (selecting ? stopSelecting() : setSelecting(true))}
                onShare={shareAlbum}
            />

            <main className="relative mx-auto max-w-[1600px] px-2 pb-32 pt-6 sm:px-6 sm:pt-10">
                <header className="al-reveal mx-auto mb-7 flex max-w-3xl flex-col items-center text-center sm:mb-10">
                    <a href="/" className="mb-5 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
                       style={{background: "rgba(236,127,50,0.12)", color: C.primary, border: "1px solid rgba(236,127,50,0.25)"}}>
                        <img src="/logo.png" alt="" className="h-4 w-4 rounded"/>
                        Transat · {t("albums.badge")}
                    </a>
                    <h1 ref={titleRef} className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{album.title}</h1>
                    <p className="mt-3 text-sm sm:text-base" style={{color: C.muted}}>
                        {[date, countLabel, album.category].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-6 grid w-full grid-cols-2 gap-2.5 px-2 sm:flex sm:w-auto sm:px-0">
                        <button
                            type="button"
                            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                            aria-pressed={selecting}
                            className="al-press flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-white"
                            style={selecting
                                ? {background: C.card, border: `1px solid ${C.primary}`, color: C.primary}
                                : {background: C.primary, border: `1px solid ${C.primary}`, boxShadow: "0 12px 30px -12px rgba(236,127,50,0.7)"}}
                        >
                            <FaRegCheckCircle aria-hidden/>
                            {selecting ? t("albums.cancel") : t("albums.select")}
                        </button>
                        <button
                            type="button"
                            onClick={shareAlbum}
                            className="al-press flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold"
                            style={{background: C.card, border: `1px solid ${C.border}`}}
                        >
                            <FaShareAlt aria-hidden/>
                            {t("albums.share")}
                        </button>
                    </div>
                    {/* How to get a photo: the hover controls and the long press are not visible until used. */}
                    <p className="al-hint-hover mt-4 items-center justify-center gap-2 text-xs" style={{color: C.muted}}>
                        <FaDownload aria-hidden style={{color: C.primary}}/> {t("albums.hintHover")}
                    </p>
                    <p className="al-hint-touch mt-4 items-center justify-center gap-2 text-xs" style={{color: C.muted}}>
                        <FaHandPointer aria-hidden style={{color: C.primary}}/> {t("albums.hintTouch")}
                    </p>
                </header>

                {photos.length === 0 ? (
                    <p className="mx-auto max-w-md rounded-2xl p-8 text-center" style={{background: C.card, color: C.muted}}>
                        {t("albums.empty")}
                    </p>
                ) : (
                    <MosaicGrid
                        photos={photos}
                        complete={!hasMore}
                        base={base}
                        title={album.title}
                        selecting={selecting}
                        selected={selected}
                        onOpen={setOpen}
                        onToggle={toggle}
                        onDownload={downloadOne}
                        onMenu={(photo, index) => setMenu({photo, index})}
                    />
                )}

                <div ref={sentinel} aria-hidden className="h-px"/>
                {loading && (
                    <div className="mt-8 flex justify-center" aria-live="polite">
                        <span className="h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" style={{borderColor: C.primary, borderTopColor: "transparent"}}/>
                    </div>
                )}
                {failed && (
                    <div className="mt-8 flex justify-center">
                        <button type="button" onClick={() => void loadMore()} className="rounded-xl px-4 py-2 text-sm"
                                style={{background: C.card, border: `1px solid ${C.border}`}}>
                            {t("albums.retry")}
                        </button>
                    </div>
                )}

                <footer className="mt-14 text-center text-xs" style={{color: C.muted}}>
                    <p>{t("albums.fullQuality")}</p>
                </footer>
            </main>

            {open !== null && photos[open] && (
                <Lightbox
                    photos={photos}
                    index={open}
                    base={base}
                    title={album.title}
                    hasMore={hasMore}
                    onNeedMore={loadMore}
                    onIndex={setOpen}
                    onClose={() => setOpen(null)}
                />
            )}

            <SelectionBar
                visible={selecting && open === null}
                count={selected.size}
                saving={saving}
                onCancel={stopSelecting}
                onClear={() => setSelected(new Set())}
                onDownload={downloadSelected}
            />

            <PhotoSheet
                item={menu}
                base={base}
                isSelected={!!menu && selected.has(menu.photo.id)}
                onClose={() => setMenu(null)}
                onDownload={(m) => {
                    setMenu(null);
                    void downloadOne(m.photo, m.index);
                }}
                onToggle={(m) => {
                    setMenu(null);
                    toggle(m.photo.id);
                }}
                onOpen={(m) => {
                    setMenu(null);
                    setOpen(m.index);
                }}
            />

            <AppBanner hidden={open !== null || selecting || menu !== null}/>

            {toast && (
                <div role="status" className="al-toast fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg"
                     style={{background: C.text, color: C.page}}>
                    <FaCheck aria-hidden className="mr-2 inline"/>{toast}
                </div>
            )}

            <style>{`
                @keyframes al-reveal { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
                .al-reveal { animation: al-reveal .55s cubic-bezier(.2,.8,.2,1) both; }
                @keyframes al-fade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes al-up { from { transform: translateY(110%); } to { transform: none; } }
                @keyframes al-toast { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
                @keyframes al-pulse { 0%, 100% { opacity: .55; } 50% { opacity: .9; } }
                .al-toast { animation: al-toast .25s ease-out both; }
                .al-press { transition: transform .15s ease, filter .15s ease; }
                .al-press:active { transform: scale(.97); }
                .al-press:hover { filter: brightness(1.08); }
                .al-tile .al-img { transition: opacity .5s ease, transform .25s cubic-bezier(.2,.8,.2,1), border-radius .25s ease; }
                .al-tile .al-check, .al-tile .al-dl { opacity: 0; transition: opacity .15s ease, transform .15s ease, background-color .15s ease; }
                .al-tile.selecting .al-check, .al-tile.selected .al-check { opacity: 1; }
                .al-tile.selecting .al-dl { display: none; }
                .al-tile:focus-within .al-check, .al-tile:not(.selecting):focus-within .al-dl, .al-tile:focus-within .al-shade { opacity: 1; }
                .al-hint-hover, .al-hint-touch { display: none; }
                @media (hover: hover) and (pointer: fine) {
                    .al-hint-hover { display: flex; }
                    .al-tile:hover .al-check, .al-tile:hover .al-dl, .al-tile:hover .al-shade { opacity: 1; }
                    .al-tile:not(.selecting):hover .al-img.loaded { transform: scale(1.03); }
                    .al-check:hover, .al-dl:hover { transform: scale(1.1); }
                    .al-dl:hover { background-color: ${C.primary} !important; }
                }
                @media (hover: none), (pointer: coarse) {
                    .al-hint-touch { display: flex; }
                    .al-tile .al-dl { display: none; }
                }
                @keyframes al-sheet { from { transform: translateY(100%); } to { transform: none; } }
                .al-tile.selected .al-img { transform: scale(.88); border-radius: 10px; }
                .al-tile:focus-within { outline: 2px solid ${C.primary}; outline-offset: 1px; }
                .al-skeleton { animation: al-pulse 1.4s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) {
                    .al-reveal, .al-toast, .al-skeleton { animation: none; }
                    .al-tile .al-img, .al-slide, .al-bar { transition: none !important; }
                }
            `}</style>
        </div>
    );
}

/**
 * Saves the selected originals the way the device expects: one photo as a file, a few photos on a phone through
 * the share sheet (which offers "Save N images" to the photo library), anything else as one zip built by the server.
 */
async function saveSelection(base: string, slug: string, ids: string[]): Promise<"file" | "shared" | "zip" | "cancelled"> {
    if (ids.length === 1) {
        await savePhoto(photoUrl(base, ids[0], "original", true), `${slug}.jpg`);
        return "file";
    }
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && ids.length <= SHARE_SHEET_MAX && "canShare" in navigator) {
        try {
            const files: File[] = [];
            for (const [i, id] of ids.entries()) {
                const blob = await (await fetch(photoUrl(base, id, "original"))).blob();
                files.push(new File([blob], `${slug}-${i + 1}.jpg`, {type: blob.type || "image/jpeg"}));
            }
            if (navigator.canShare({files})) {
                await navigator.share({files});
                return "shared";
            }
        } catch (e) {
            if ((e as DOMException)?.name === "AbortError") return "cancelled";
        }
    }
    // A plain form post: the browser saves the archive the response carries and stays on the page.
    const form = document.createElement("form");
    form.method = "post";
    form.action = `${base}/download`;
    form.style.display = "none";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "ids";
    input.value = ids.join(",");
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
    return "zip";
}

/** Above this many photos, a phone gets a zip rather than a share sheet holding every original in memory. */
const SHARE_SHEET_MAX = 12;

/** Most photos downloaded at once: the server builds the zip from the originals. Same limit in album-download.ts. */
const MAX_SELECTION = 30;

/**
 * The album's title and photo count, pinned at the top once the page title has scrolled away. On a phone it steps
 * aside while the visitor scrolls down through the photos and comes back as soon as they scroll up a little.
 */
function StickyBar({titleRef, title, count, selecting, onSelect, onShare}: {
    titleRef: React.RefObject<HTMLHeadingElement | null>;
    title: string;
    count: string;
    selecting: boolean;
    onSelect: () => void;
    onShare: () => void;
}) {
    const {t} = useTranslation();
    const [pastTitle, setPastTitle] = useState(false);
    const [scrollingUp, setScrollingUp] = useState(true);
    const [wide, setWide] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia("(min-width: 768px)");
        const update = () => setWide(mq.matches);
        update();
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
    }, []);

    // Direction of the scroll, with a small dead zone so a finger resting on the screen does not flicker the bar.
    // Setting the same state again is free: React skips the render.
    useEffect(() => {
        let last = window.scrollY;
        const onScroll = () => {
            const y = window.scrollY;
            const el = titleRef.current;
            setPastTitle(!!el && y > el.offsetTop + el.offsetHeight);
            if (y < last - 6) setScrollingUp(true);
            else if (y > last + 10) setScrollingUp(false);
            else return;
            last = y;
        };
        onScroll();
        window.addEventListener("scroll", onScroll, {passive: true});
        return () => window.removeEventListener("scroll", onScroll);
    }, [titleRef]);

    const visible = pastTitle && (wide || scrollingUp || selecting);

    return (
        <div
            className="al-bar fixed inset-x-0 top-0 z-30"
            aria-hidden={!visible}
            style={{
                transform: visible ? "none" : "translateY(-110%)",
                transition: "transform .3s cubic-bezier(.2,.8,.2,1)",
                background: "rgba(7,4,2,0.82)",
                borderBottom: `1px solid ${C.border}`,
                backdropFilter: "blur(14px) saturate(140%)",
                WebkitBackdropFilter: "blur(14px) saturate(140%)",
                paddingTop: "env(safe-area-inset-top)",
            }}
        >
            <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-3 sm:px-6">
                <img src="/logo.png" alt="" className="h-7 w-7 shrink-0 rounded-lg"/>
                <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-sm font-semibold sm:text-base">{title}</p>
                    <p className="truncate text-xs" style={{color: C.muted}}>{count}</p>
                </div>
                <button
                    type="button"
                    tabIndex={visible ? 0 : -1}
                    onClick={onSelect}
                    aria-pressed={selecting}
                    className="al-press flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium"
                    style={selecting ? {background: "rgba(236,127,50,0.16)", color: C.primary} : {background: C.primary, color: "white"}}
                >
                    <FaRegCheckCircle aria-hidden/>
                    <span className="hidden sm:inline">{selecting ? t("albums.cancel") : t("albums.select")}</span>
                </button>
                <button
                    type="button"
                    tabIndex={visible ? 0 : -1}
                    onClick={onShare}
                    aria-label={t("albums.share")}
                    title={t("albums.share")}
                    className="al-press flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-medium"
                >
                    <FaShareAlt aria-hidden/>
                    <span className="hidden sm:inline">{t("albums.share")}</span>
                </button>
            </div>
        </div>
    );
}

/** Actions on the selected photos, at the bottom like the app's selection bar. */
function SelectionBar({visible, count, saving, onCancel, onClear, onDownload}: {
    visible: boolean;
    count: number;
    saving: boolean;
    onCancel: () => void;
    onClear: () => void;
    onDownload: () => void;
}) {
    const {t} = useTranslation();
    return (
        <div
            className="al-bar fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 sm:bottom-5"
            aria-hidden={!visible}
            style={{
                paddingBottom: "max(12px, env(safe-area-inset-bottom))",
                transform: visible ? "none" : "translateY(140%)",
                transition: "transform .35s cubic-bezier(.2,.8,.2,1)",
                pointerEvents: visible ? "auto" : "none",
            }}
        >
            <div className="flex w-full max-w-xl items-center gap-2 rounded-2xl p-2 shadow-2xl"
                 style={{background: "rgba(30,21,21,0.94)", border: `1px solid ${C.border}`, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)"}}>
                <button type="button" onClick={onCancel} aria-label={t("albums.cancel")} title={t("albums.cancel")} tabIndex={visible ? 0 : -1}
                        className="shrink-0 rounded-full p-2.5 transition-colors hover:bg-white/10">
                    <FaTimes/>
                </button>
                <div className="min-w-0 flex-1 leading-tight" aria-live="polite">
                    <p className="truncate text-sm font-semibold">
                        {count > 0 ? t("albums.selectedCount", {count}) : t("albums.selectHint")}
                    </p>
                    <p className="truncate text-[11px]" style={{color: C.muted}}>{t("albums.selectionMax", {count: MAX_SELECTION})}</p>
                </div>
                {count > 0 && (
                    <button type="button" onClick={onClear} tabIndex={visible ? 0 : -1}
                            className="hidden shrink-0 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/10 sm:block" style={{color: C.muted}}>
                        {t("albums.deselectAll")}
                    </button>
                )}
                <button type="button" onClick={onDownload} disabled={count === 0 || saving} tabIndex={visible ? 0 : -1}
                        className="al-press flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                        style={{background: C.primary}}>
                    {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"/> : <FaDownload aria-hidden/>}
                    {t("albums.download")}
                </button>
            </div>
        </div>
    );
}

/**
 * What a long press on a photo offers on a phone: download it, select it, or see it larger. A sheet from the bottom
 * with the photo itself, so it is clear which one the actions apply to.
 */
function PhotoSheet({item, base, isSelected, onClose, onDownload, onToggle, onOpen}: {
    item: { photo: PublicPhoto; index: number } | null;
    base: string;
    isSelected: boolean;
    onClose: () => void;
    onDownload: (item: { photo: PublicPhoto; index: number }) => void;
    onToggle: (item: { photo: PublicPhoto; index: number }) => void;
    onOpen: (item: { photo: PublicPhoto; index: number }) => void;
}) {
    const {t} = useTranslation();
    useEffect(() => {
        if (!item) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [item, onClose]);
    if (!item) return null;
    const r = ratioOf(item.photo);
    const action = "al-press flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[15px] font-semibold";
    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={t("albums.photoActions")}>
            <button type="button" aria-label={t("albums.close")} onClick={onClose} className="absolute inset-0 cursor-default"
                    style={{background: "rgba(7,4,2,0.6)", animation: "al-fade .2s ease-out", backdropFilter: "blur(2px)"}}/>
            <div className="relative w-full max-w-md rounded-t-3xl p-3 pb-2 sm:rounded-3xl"
                 style={{background: C.card, border: `1px solid ${C.border}`, animation: "al-sheet .3s cubic-bezier(.2,.8,.2,1) both", paddingBottom: "max(8px, env(safe-area-inset-bottom))"}}>
                <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full sm:hidden" style={{background: "rgba(255,230,204,0.25)"}}/>
                <div className="mx-auto mb-3 overflow-hidden rounded-2xl" style={{aspectRatio: `${r}`, maxHeight: "34vh", maxWidth: `calc(34vh * ${r})`, background: C.page}}>
                    {item.photo.has_thumbnail && <img src={photoUrl(base, item.photo.id, "grid")} alt="" className="h-full w-full object-cover"/>}
                </div>
                <button type="button" onClick={() => onDownload(item)} className={`${action} justify-center text-white`} style={{background: C.primary}}>
                    <FaDownload aria-hidden/> {t("albums.downloadPhoto")}
                </button>
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => onToggle(item)} className={`${action} justify-center`} style={{background: "rgba(255,230,204,0.06)"}}>
                        <FaRegCheckCircle aria-hidden style={{color: C.primary}}/> {isSelected ? t("albums.deselect") : t("albums.select")}
                    </button>
                    <button type="button" onClick={() => onOpen(item)} className={`${action} justify-center`} style={{background: "rgba(255,230,204,0.06)"}}>
                        <FaExpand aria-hidden style={{color: C.primary}}/> {t("albums.view")}
                    </button>
                </div>
                <button type="button" onClick={onClose} className="mt-1 w-full rounded-xl py-3 text-sm font-medium" style={{color: C.muted}}>
                    {t("albums.cancel")}
                </button>
            </div>
        </div>
    );
}

/**
 * The app's mosaic: justified rows with, now and then, a large photo beside two small ones or a wide photo across
 * the page. Its geometry depends on the width, so it is laid out once the container is measured; the server sends
 * placeholders of the same rhythm.
 */
function MosaicGrid({photos, complete, base, title, selecting, selected, onOpen, onToggle, onDownload, onMenu}: {
    photos: PublicPhoto[];
    complete: boolean;
    base: string;
    title: string;
    selecting: boolean;
    selected: Set<string>;
    onOpen: (i: number) => void;
    onToggle: (id: string) => void;
    onDownload: (photo: PublicPhoto, index: number) => void;
    onMenu: (photo: PublicPhoto, index: number) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const gap = width >= 640 ? 4 : 2;
    const blocks = useMemo(() => (width > 0 ? mosaicBlocks(photos, width, gap, complete) : []), [photos, width, gap, complete]);

    return (
        <div ref={ref} className="flex flex-col" style={{gap}}>
            {width === 0 && <MosaicSkeleton/>}
            {blocks.map((b) => (
                <div
                    key={b.key}
                    className="relative"
                    // Blocks far from the screen skip rendering; their height is known, so the page never jumps.
                    style={{height: b.height, contentVisibility: "auto", containIntrinsicSize: `auto ${b.height}px`}}
                >
                    {b.tiles.map((tile) => (
                        <Tile
                            key={tile.photo.id}
                            tile={tile}
                            base={base}
                            label={`${title} · ${tile.index + 1}`}
                            selecting={selecting}
                            isSelected={selected.has(tile.photo.id)}
                            onOpen={onOpen}
                            onToggle={onToggle}
                            onDownload={onDownload}
                            onMenu={onMenu}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

function MosaicSkeleton() {
    const rows = [[1.5, 1, 0.7], [2], [1.3, 1.3], [0.8, 1.5, 1]];
    return (
        <>
            {rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                <div key={r} className="flex gap-0.5 sm:gap-1" style={{height: row.length === 1 ? "38vw" : "min(26vw, 280px)"}}>
                    {row.map((grow, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                        <div key={i} className="al-skeleton h-full rounded-[3px]" style={{flexGrow: grow, flexBasis: 0, background: C.card}}/>
                    ))}
                </div>
            ))}
        </>
    );
}

const LONG_PRESS_MS = 450;

function Tile({tile, base, label, selecting, isSelected, onOpen, onToggle, onDownload, onMenu}: {
    tile: MosaicTile<PublicPhoto>;
    base: string;
    label: string;
    selecting: boolean;
    isSelected: boolean;
    onOpen: (i: number) => void;
    onToggle: (id: string) => void;
    onDownload: (photo: PublicPhoto, index: number) => void;
    onMenu: (photo: PublicPhoto, index: number) => void;
}) {
    const {t} = useTranslation();
    const {photo, index} = tile;
    const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);

    const cancelPress = () => {
        if (press.current) window.clearTimeout(press.current.timer);
    };

    // A long press on a phone offers to download or select the photo; while selecting, it simply toggles it.
    const onPointerDown = (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        cancelPress();
        const state = {x: e.clientX, y: e.clientY, fired: false, timer: 0};
        state.timer = window.setTimeout(() => {
            state.fired = true;
            navigator.vibrate?.(12);
            if (selecting) onToggle(photo.id);
            else onMenu(photo, index);
        }, LONG_PRESS_MS);
        press.current = state;
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
    };

    const onClick = () => {
        if (press.current?.fired) {
            press.current = null;
            return;
        }
        if (selecting) onToggle(photo.id);
        else onOpen(index);
    };

    return (
        <div
            className={`al-tile absolute overflow-hidden ${selecting ? "selecting" : ""} ${isSelected ? "selected" : ""}`}
            style={{left: tile.x, top: tile.y, width: tile.width, height: tile.height, background: isSelected ? "rgba(236,127,50,0.14)" : undefined}}
        >
            <button
                type="button"
                onClick={onClick}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(e) => {
                    if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === "touch") e.preventDefault();
                }}
                aria-label={label}
                aria-pressed={selecting ? isSelected : undefined}
                className="absolute inset-0 block h-full w-full select-none outline-none"
                style={{WebkitTouchCallout: "none", background: isSelected ? "transparent" : C.card}}
            >
                {photo.has_thumbnail && <Thumb src={photoUrl(base, photo.id, "grid")} eager={index < 10}/>}
                <span aria-hidden className="al-shade pointer-events-none absolute inset-x-0 top-0 h-14 opacity-0 transition-opacity"
                      style={{background: "linear-gradient(to bottom, rgba(0,0,0,0.45), transparent)", opacity: selecting ? 1 : undefined}}/>
            </button>
            <button
                type="button"
                onClick={() => onToggle(photo.id)}
                aria-label={t("albums.selectPhoto")}
                title={isSelected ? t("albums.deselect") : t("albums.selectPhoto")}
                aria-pressed={isSelected}
                className="al-check absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full sm:left-2 sm:top-2"
                style={{
                    background: isSelected ? C.primary : "rgba(7,4,2,0.25)",
                    border: isSelected ? `2px solid ${C.primary}` : "2px solid rgba(255,255,255,0.9)",
                    color: "white",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                }}
            >
                {isSelected && <FaCheck size={12} aria-hidden/>}
            </button>
            <button
                type="button"
                onClick={() => onDownload(photo, index)}
                aria-label={t("albums.downloadPhoto")}
                title={t("albums.downloadPhoto")}
                className="al-dl absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full sm:right-2 sm:top-2"
                style={{background: "rgba(7,4,2,0.55)", color: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.4)", backdropFilter: "blur(6px)"}}
            >
                <FaDownload size={13} aria-hidden/>
            </button>
        </div>
    );
}

function Thumb({src, eager}: { src: string; eager?: boolean }) {
    const ref = useRef<HTMLImageElement>(null);
    const [loaded, setLoaded] = useState(false);
    // An image served with the page can finish loading before React attaches onLoad.
    useEffect(() => {
        if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
    }, []);
    return (
        <img
            ref={ref}
            src={src}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={`al-img absolute inset-0 h-full w-full object-cover ${loaded ? "loaded opacity-100" : "opacity-0"}`}
        />
    );
}

// ---- lightbox ----------------------------------------------------------------------------------------------

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

type View = { scale: number; x: number; y: number };
const NO_ZOOM: View = {scale: 1, x: 0, y: 0};

function Lightbox({photos, index, base, title, hasMore, onNeedMore, onIndex, onClose}: {
    photos: PublicPhoto[];
    index: number;
    base: string;
    title: string;
    hasMore: boolean;
    onNeedMore: () => void;
    onIndex: (i: number) => void;
    onClose: () => void;
}) {
    const {t} = useTranslation();
    const stage = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<View>(NO_ZOOM);
    // Horizontal offset of the strip while swiping, vertical one while pulling down to close.
    const [drag, setDrag] = useState({x: 0, y: 0});
    const [animating, setAnimating] = useState(false);
    const [saving, setSaving] = useState(false);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const gesture = useRef<{
        kind: "none" | "swipe" | "pan" | "pinch";
        startX: number; startY: number; startT: number;
        startView: View; startDist: number; mid: { x: number; y: number };
        axis: "x" | "y" | null;
    }>({kind: "none", startX: 0, startY: 0, startT: 0, startView: NO_ZOOM, startDist: 0, mid: {x: 0, y: 0}, axis: null});
    const lastTap = useRef(0);

    const photo = photos[index];
    const count = photos.length;
    const canPrev = index > 0;
    const canNext = index < count - 1;

    // Near the end of what is loaded, the gallery fetches more so the visitor can keep going.
    useEffect(() => {
        if (hasMore && index >= count - 6) onNeedMore();
    }, [index, count, hasMore, onNeedMore]);

    useEffect(() => setView(NO_ZOOM), [index]);

    const size = () => {
        const r = stage.current?.getBoundingClientRect();
        return {w: r?.width ?? window.innerWidth, h: r?.height ?? window.innerHeight, left: r?.left ?? 0, top: r?.top ?? 0};
    };

    /** Keeps a zoomed photo covering the stage: it can be panned to its edges, not beyond. */
    const clamp = useCallback((v: View): View => {
        const scale = Math.min(Math.max(v.scale, 1), MAX_ZOOM);
        if (scale === 1) return NO_ZOOM;
        const {w, h} = size();
        const r = ratioOf(photo);
        // The photo's displayed size at scale 1 (object-contain in the stage).
        const fitW = Math.min(w, h * r), fitH = fitW / r;
        const maxX = Math.max(0, (fitW * scale - w) / 2), maxY = Math.max(0, (fitH * scale - h) / 2);
        return {scale, x: Math.min(Math.max(v.x, -maxX), maxX), y: Math.min(Math.max(v.y, -maxY), maxY)};
    }, [photo]);

    /** Zooms to scale keeping the point under (cx, cy) in place. */
    const zoomAt = useCallback((scale: number, cx: number, cy: number, from: View = view) => {
        const {w, h, left, top} = size();
        const px = cx - left - w / 2, py = cy - top - h / 2;
        const s = Math.min(Math.max(scale, 1), MAX_ZOOM);
        const k = s / from.scale;
        setView(clamp({scale: s, x: px - (px - from.x) * k, y: py - (py - from.y) * k}));
    }, [view, clamp]);

    const go = useCallback((dir: 1 | -1) => {
        if ((dir === 1 && !canNext) || (dir === -1 && !canPrev) || animating) return;
        const {w} = size();
        setAnimating(true);
        setDrag({x: -dir * w, y: 0});
        window.setTimeout(() => {
            setAnimating(false);
            setDrag({x: 0, y: 0});
            onIndex(index + dir);
        }, 260);
    }, [canNext, canPrev, animating, index, onIndex]);

    const save = async () => {
        setSaving(true);
        try {
            await savePhoto(photoUrl(base, photo.id, "original", true), `${title} ${index + 1}.jpg`.replace(/[\\/:*?"<>|]/g, "_"));
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft") go(-1);
            else if (e.key === "ArrowRight") go(1);
            else if (e.key === "+" || e.key === "=") setView((v) => clamp({...v, scale: v.scale * 1.5}));
            else if (e.key === "-") setView((v) => clamp({...v, scale: v.scale / 1.5}));
            else if (e.key === "0") setView(NO_ZOOM);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [go, onClose, clamp]);

    useEffect(() => {
        const overflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = overflow;
        };
    }, []);

    // Wheel zooms around the cursor (a non-passive listener, so the page does not scroll behind).
    useEffect(() => {
        const el = stage.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            setView((v) => {
                const {w, h, left, top} = size();
                const s = Math.min(Math.max(v.scale * Math.exp(-e.deltaY * 0.0022), 1), MAX_ZOOM);
                const px = e.clientX - left - w / 2, py = e.clientY - top - h / 2;
                const k = s / v.scale;
                return clamp({scale: s, x: px - (px - v.x) * k, y: py - (py - v.y) * k});
            });
        };
        el.addEventListener("wheel", onWheel, {passive: false});
        return () => el.removeEventListener("wheel", onWheel);
    }, [clamp]);

    const distance = () => {
        const [a, b] = [...pointers.current.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest("button,a")) return;
        try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
            // a pointer the browser no longer tracks: follow it without capture
        }
        pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
        const g = gesture.current;
        if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            Object.assign(g, {kind: "pinch", startView: view, startDist: distance(), mid: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}});
            setDrag({x: 0, y: 0});
            return;
        }
        Object.assign(g, {
            kind: view.scale > 1 ? "pan" : "swipe", startX: e.clientX, startY: e.clientY, startT: performance.now(),
            startView: view, axis: null,
        });
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
        const g = gesture.current;
        if (g.kind === "pinch" && pointers.current.size === 2) {
            zoomAt(g.startView.scale * (distance() / g.startDist), g.mid.x, g.mid.y, g.startView);
            return;
        }
        const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
        if (g.kind === "pan") {
            setView(clamp({...g.startView, x: g.startView.x + dx, y: g.startView.y + dy}));
        } else if (g.kind === "swipe") {
            if (!g.axis && Math.hypot(dx, dy) > 8) g.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
            if (g.axis === "x") {
                // Resistance past the first and last photo.
                const edge = (dx > 0 && !canPrev) || (dx < 0 && !canNext);
                setDrag({x: edge ? dx / 3 : dx, y: 0});
            } else if (g.axis === "y" && dy > 0) {
                setDrag({x: 0, y: dy});
            }
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.delete(e.pointerId);
        const g = gesture.current;
        if (g.kind === "pinch") {
            // Lifting one finger of a pinch hands over to a pan with the other one.
            const rest = [...pointers.current.values()][0];
            if (rest) Object.assign(g, {kind: "pan", startX: rest.x, startY: rest.y, startView: view});
            else g.kind = "none";
            return;
        }
        const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
        const dt = Math.max(1, performance.now() - g.startT);
        const tap = Math.hypot(dx, dy) < 8 && dt < 300;
        if (tap) {
            const now = performance.now();
            if (now - lastTap.current < 300) {
                lastTap.current = 0;
                if (view.scale > 1) setView(NO_ZOOM);
                else zoomAt(DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
            } else {
                lastTap.current = now;
            }
        } else if (g.kind === "swipe" && g.axis === "x") {
            const {w} = size();
            const fast = Math.abs(dx) / dt > 0.45;
            if ((Math.abs(dx) > w * 0.2 || fast) && dx < 0 && canNext) return go(1);
            if ((Math.abs(dx) > w * 0.2 || fast) && dx > 0 && canPrev) return go(-1);
        } else if (g.kind === "swipe" && g.axis === "y" && (dy > 140 || dy / dt > 0.6)) {
            return onClose();
        }
        g.kind = "none";
        setDrag({x: 0, y: 0});
    };

    const settle = drag.x === 0 && drag.y === 0 ? "transform .3s cubic-bezier(.2,.8,.2,1)" : "none";
    const stripTransition = animating ? "transform .26s cubic-bezier(.25,.8,.25,1)" : settle;
    const pull = Math.min(drag.y / 400, 1);
    const neighbours = [-1, 0, 1].filter((d) => photos[index + d]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={`${title} · ${index + 1}/${count}`}
            className="fixed inset-0 z-50 flex select-none flex-col"
            style={{
                background: `rgba(7,4,2,${0.97 - pull * 0.6})`,
                animation: "al-fade .2s ease-out",
                paddingTop: "env(safe-area-inset-top)",
                paddingBottom: "env(safe-area-inset-bottom)",
            }}
        >
            <div className="relative z-10 flex items-center justify-between gap-3 px-3 py-2 sm:px-5 sm:py-3" style={{opacity: 1 - pull}}>
                <span className="min-w-0 truncate text-sm font-medium">
                    {title} <span style={{color: C.muted}}>· {index + 1}/{count}{hasMore ? "+" : ""}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setView((v) => (v.scale > 1 ? NO_ZOOM : clamp({...v, scale: DOUBLE_TAP_ZOOM})))}
                            aria-label={view.scale > 1 ? t("albums.zoomOut") : t("albums.zoomIn")}
                            className="hidden rounded-full p-2.5 transition-colors hover:bg-white/10 sm:block">
                        {view.scale > 1 ? <FaSearchMinus/> : <FaSearchPlus/>}
                    </button>
                    <button type="button" onClick={save} aria-label={t("albums.download")}
                            className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition-colors hover:bg-white/10">
                        {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"/> : <FaDownload/>}
                        <span className="hidden sm:inline">{t("albums.download")}</span>
                    </button>
                    <button type="button" onClick={onClose} aria-label={t("albums.close")} className="rounded-full p-2.5 transition-colors hover:bg-white/10">
                        <FaTimes/>
                    </button>
                </div>
            </div>

            <div
                ref={stage}
                className="relative min-h-0 flex-1 overflow-hidden"
                style={{touchAction: "none", cursor: view.scale > 1 ? "grab" : "default"}}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={(e) => e.preventDefault()}
            >
                <div
                    className="al-slide absolute inset-0"
                    style={{
                        transform: `translate3d(${drag.x}px, ${drag.y}px, 0) scale(${1 - pull * 0.25})`,
                        transition: stripTransition,
                    }}
                >
                    {neighbours.map((d) => {
                        const p = photos[index + d];
                        return (
                            <div key={p.id} className="absolute inset-0 flex items-center justify-center p-1 sm:px-16 sm:py-2"
                                 style={{transform: `translateX(${d * 100}%)`}}>
                                <Slide
                                    base={base}
                                    photo={p}
                                    view={d === 0 ? view : NO_ZOOM}
                                    zooming={d === 0 && gesture.current.kind !== "pinch" && gesture.current.kind !== "pan"}
                                    alt={`${title} · ${index + d + 1}`}
                                />
                            </div>
                        );
                    })}
                </div>

                {canPrev && (
                    <button type="button" onClick={() => go(-1)} aria-label={t("albums.previous")}
                            className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full p-3.5 transition-colors hover:bg-white/10 sm:block"
                            style={{background: "rgba(30,21,21,0.6)"}}>
                        <FaArrowLeft/>
                    </button>
                )}
                {canNext && (
                    <button type="button" onClick={() => go(1)} aria-label={t("albums.next")}
                            className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full p-3.5 transition-colors hover:bg-white/10 sm:block"
                            style={{background: "rgba(30,21,21,0.6)"}}>
                        <FaArrowRight/>
                    </button>
                )}
            </div>
            <p className="pb-2 pt-1 text-center text-[11px] sm:hidden" style={{color: C.muted, opacity: 1 - pull}}>
                {t("albums.gestures")}
            </p>
        </div>
    );
}

/** One photo of the lightbox: the grid thumbnail at once (already cached), the sharp preview over it once loaded. */
function Slide({base, photo, view, zooming, alt}: {
    base: string;
    photo: PublicPhoto;
    view: View;
    zooming: boolean;
    alt: string;
}) {
    const [sharp, setSharp] = useState(false);
    const r = ratioOf(photo);
    return (
        <div
            className="relative max-h-full max-w-full"
            style={{
                aspectRatio: `${r}`,
                width: `min(100%, calc((100vh - 120px) * ${r}))`,
                transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
                transition: zooming ? "transform .25s cubic-bezier(.2,.8,.2,1)" : "none",
                willChange: "transform",
            }}
        >
            {photo.has_thumbnail ? (
                <>
                    <img src={photoUrl(base, photo.id, "grid")} alt="" draggable={false}
                         className="absolute inset-0 h-full w-full rounded-lg object-contain" style={{filter: sharp ? "none" : "blur(2px)"}}/>
                    <img src={photoUrl(base, photo.id, "preview")} alt={alt} draggable={false} onLoad={() => setSharp(true)}
                         className="absolute inset-0 h-full w-full rounded-lg object-contain transition-opacity duration-300"
                         style={{opacity: sharp ? 1 : 0}}/>
                </>
            ) : (
                <div className="absolute inset-0 rounded-lg" style={{background: C.card}}/>
            )}
        </div>
    );
}

// ---- app suggestion ----------------------------------------------------------------------------------------

const BANNER_KEY = "transat.albums.appBanner";
const BANNER_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Suggests the app to visitors who reached the web page. On a phone that has it, the link opens the app instead
 * of this page (Universal Links / App Links), so whoever sees this either has no app or chose the browser.
 */
function AppBanner({hidden}: { hidden: boolean }) {
    const {t} = useTranslation();
    const [show, setShow] = useState(false);

    useEffect(() => {
        let dismissed = 0;
        try {
            dismissed = Number(localStorage.getItem(BANNER_KEY) ?? 0);
        } catch {
            // storage blocked: show it, it can still be closed for this visit
        }
        if (Date.now() - dismissed < BANNER_SNOOZE_MS) return;
        const id = setTimeout(() => setShow(true), 1500);
        return () => clearTimeout(id);
    }, []);

    const dismiss = () => {
        setShow(false);
        try {
            localStorage.setItem(BANNER_KEY, String(Date.now()));
        } catch {
            // nothing to remember it with
        }
    };

    const visible = show && !hidden;
    if (!show) return null;

    return (
        <aside
            aria-label={t("albums.app.title")}
            className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 sm:bottom-5"
            style={{
                paddingBottom: "max(12px, env(safe-area-inset-bottom))",
                transform: visible ? "none" : "translateY(130%)",
                transition: "transform .45s cubic-bezier(.2,.8,.2,1)",
                animation: "al-up .5s cubic-bezier(.2,.8,.2,1) both",
            }}
        >
            <div className="flex w-full max-w-xl items-center gap-3 rounded-2xl p-3 pr-2 shadow-2xl sm:p-4"
                 style={{background: "rgba(30,21,21,0.92)", border: `1px solid ${C.border}`, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)"}}>
                <img src="/logo.png" alt="" className="h-11 w-11 shrink-0 rounded-xl"/>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{t("albums.app.title")}</p>
                    <p className="mt-0.5 text-xs leading-snug" style={{color: C.muted}}>{t("albums.app.body")}</p>
                </div>
                <a href="/download" className="al-press shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{background: C.blue}}>
                    {t("albums.app.cta")}
                </a>
                <button type="button" onClick={dismiss} aria-label={t("albums.close")} className="shrink-0 rounded-full p-2 transition-colors hover:bg-white/10"
                        style={{color: C.muted}}>
                    <FaTimes/>
                </button>
            </div>
        </aside>
    );
}
