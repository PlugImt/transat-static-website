import {useCallback, useEffect, useRef, useState} from "react";
import {data, redirect, useLoaderData} from "react-router";
import {useTranslation} from "react-i18next";
import {FaArrowLeft, FaArrowRight, FaCheck, FaDownload, FaFileArchive, FaSearchMinus, FaSearchPlus, FaShareAlt, FaTimes} from "react-icons/fa";

import {albumPath, type PublicAlbum, type PublicPhoto, type PublicPhotosPage} from "../lib/albums";
import {albumIdOf, apiJson, ApiStatusError} from "../lib/albums.server";

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
    const {photos, hasMore, loading, failed, loadMore} = useInfinitePhotos(base, page);
    const [open, setOpen] = useState<number | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    const date = formatEventDate(album, i18n.language || "fr");

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
        const id = setTimeout(() => setToast(null), 2400);
        return () => clearTimeout(id);
    }, [toast]);

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

            <main className="relative mx-auto max-w-[1600px] px-3 pb-28 pt-6 sm:px-6 sm:pt-10">
                <header className="al-reveal mx-auto mb-7 flex max-w-3xl flex-col items-center text-center sm:mb-10">
                    <a href="/" className="mb-5 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
                       style={{background: "rgba(236,127,50,0.12)", color: C.primary, border: "1px solid rgba(236,127,50,0.25)"}}>
                        <img src="/logo.png" alt="" className="h-4 w-4 rounded"/>
                        Transat · {t("albums.badge")}
                    </a>
                    <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{album.title}</h1>
                    <p className="mt-3 text-sm sm:text-base" style={{color: C.muted}}>
                        {[date, t("albums.photoCount", {count: album.photo_count}), album.category].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
                        <a
                            href={`${base}/download`}
                            download
                            className="al-press flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold text-white"
                            style={{background: C.primary, boxShadow: "0 12px 30px -12px rgba(236,127,50,0.7)"}}
                            onClick={() => setToast(t("albums.zipStarting"))}
                        >
                            <FaFileArchive aria-hidden/>
                            {t("albums.downloadAll")}
                        </a>
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
                </header>

                {photos.length === 0 ? (
                    <p className="mx-auto max-w-md rounded-2xl p-8 text-center" style={{background: C.card, color: C.muted}}>
                        {t("albums.empty")}
                    </p>
                ) : (
                    <JustifiedGrid photos={photos} base={base} title={album.title} onOpen={setOpen}/>
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

            <AppBanner hidden={open !== null}/>

            {toast && (
                <div role="status" className="al-toast fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg"
                     style={{background: C.text, color: C.page}}>
                    <FaCheck aria-hidden className="mr-2 inline"/>{toast}
                </div>
            )}

            <style>{`
                .al-grid { --row-h: 132px; }
                @media (min-width: 640px) { .al-grid { --row-h: 200px; } }
                @media (min-width: 1280px) { .al-grid { --row-h: 250px; } }
                @keyframes al-reveal { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
                .al-reveal { animation: al-reveal .55s cubic-bezier(.2,.8,.2,1) both; }
                @keyframes al-fade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes al-up { from { transform: translateY(110%); } to { transform: none; } }
                @keyframes al-toast { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
                .al-toast { animation: al-toast .25s ease-out both; }
                .al-press { transition: transform .15s ease, filter .15s ease; }
                .al-press:active { transform: scale(.97); }
                .al-press:hover { filter: brightness(1.08); }
                .al-tile img { transition: opacity .5s ease, transform .6s cubic-bezier(.2,.8,.2,1); }
                .al-tile:hover img.loaded { transform: scale(1.035); }
                .al-tile:focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; }
                @media (prefers-reduced-motion: reduce) {
                    .al-reveal, .al-toast { animation: none; }
                    .al-tile img, .al-slide { transition: none !important; }
                }
            `}</style>
        </div>
    );
}

/**
 * Rows of equal height filled edge to edge, each photo keeping its proportions. Pure CSS: every tile grows in
 * proportion to its width/height ratio, so the layout is right from the server's first paint, with no shift.
 */
function JustifiedGrid({photos, base, title, onOpen}: {
    photos: PublicPhoto[];
    base: string;
    title: string;
    onOpen: (i: number) => void;
}) {
    return (
        <ul className="al-grid flex flex-wrap gap-1 sm:gap-1.5">
            {photos.map((p, i) => {
                const r = ratioOf(p);
                return (
                    <li key={p.id} style={{flexGrow: r * 100, flexBasis: `calc(var(--row-h) * ${r})`}} className="relative">
                        <button
                            type="button"
                            onClick={() => onOpen(i)}
                            className="al-tile relative block w-full overflow-hidden rounded-md sm:rounded-lg"
                            style={{background: C.card}}
                            aria-label={`${title} · ${i + 1}`}
                        >
                            <i aria-hidden className="block" style={{paddingBottom: `${100 / r}%`}}/>
                            {p.has_thumbnail && <Thumb src={photoUrl(base, p.id, "grid")} eager={i < 8}/>}
                        </button>
                    </li>
                );
            })}
            {/* Keeps the last row at its natural height instead of stretching it across the page. */}
            <li aria-hidden style={{flexGrow: 1e6, flexBasis: 0, height: 0}}/>
        </ul>
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
            className={`absolute inset-0 h-full w-full object-cover ${loaded ? "loaded opacity-100" : "opacity-0"}`}
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
