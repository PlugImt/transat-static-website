import {useCallback, useEffect, useRef, useState} from "react";
import {data, useLoaderData} from "react-router";
import {useTranslation} from "react-i18next";
import {FaArrowLeft, FaArrowRight, FaDownload, FaShareAlt, FaTimes} from "react-icons/fa";

import {photoboothApi, type Share, type ShareFile, validToken} from "../lib/photobooth.server";
import {useReportVisit} from "../lib/visit";

export async function loader({params}: { params: { token?: string } }) {
    const token = params.token;
    if (!validToken(token)) {
        throw data("Not found", {status: 404});
    }
    const res = await fetch(`${photoboothApi()}/photobooth/shares/${token}`, {
        headers: {Accept: "application/json"},
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
        throw data("Not found", {status: 404});
    }
    if (!res.ok) {
        throw data("Unavailable", {status: 503});
    }
    const share = (await res.json()) as Share;
    return data({token, share}, {headers: {"Cache-Control": "private, max-age=60", "X-Robots-Tag": "noindex, nofollow"}});
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

export function meta({data: d}: { data?: { share: Share } }) {
    const title = d ? `${d.share.event_name} · Photobooth Transat` : "Photobooth Transat";
    return [
        {title},
        {name: "robots", content: "noindex, nofollow"},
        {name: "referrer", content: "no-referrer"},
        {name: "theme-color", content: "#070402"},
    ];
}

/* Colours of the Transat app's dark theme. */
const C = {
    page: "#070402",
    card: "#1e1515",
    border: "#403D3D",
    text: "#ffe6cc",
    muted: "#A1A1AA",
    primary: "#ec7f32",
};

const formatSize = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

const fileUrl = (token: string, f: ShareFile, kind: "preview" | "download") =>
    `/photobooth/${token}/files/${f.id}${kind === "preview" ? "?size=preview" : "?download=1"}`;

/**
 * Saves a picture the way the phone expects: the share sheet ("Enregistrer l'image") where the browser can share
 * files, a plain download elsewhere.
 */
async function savePicture(token: string, f: ShareFile) {
    const url = fileUrl(token, f, "download");
    try {
        if (typeof navigator !== "undefined" && "canShare" in navigator) {
            const blob = await (await fetch(url)).blob();
            const file = new File([blob], f.name, {type: blob.type || "image/jpeg"});
            if (navigator.canShare({files: [file]})) {
                await navigator.share({files: [file]});
                return;
            }
        }
    } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return; // the guest closed the share sheet
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function Img({src, alt, className = "", eager, natural}: {
    src: string;
    alt: string;
    className?: string;
    eager?: boolean;
    /** Keep the picture's own proportions instead of filling a fixed frame. */
    natural?: boolean;
}) {
    const [loaded, setLoaded] = useState(false);
    const ref = useRef<HTMLImageElement>(null);
    // A picture served with the page can finish loading before React attaches onLoad.
    useEffect(() => {
        if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
    }, []);
    return (
        <div className={`relative overflow-hidden ${natural && !loaded ? "aspect-[4/3]" : ""} ${className}`} style={{background: "#140d0c"}}>
            {!loaded && <div className="absolute inset-0 animate-pulse" style={{background: "#1e1515"}}/>}
            <img
                ref={ref}
                src={src}
                alt={alt}
                loading={eager ? "eager" : "lazy"}
                onLoad={() => setLoaded(true)}
                className={`${natural ? "block h-auto w-full" : "h-full w-full object-cover"} transition-all duration-700 ${loaded ? "scale-100 opacity-100" : "scale-[1.03] opacity-0"}`}
            />
        </div>
    );
}

export default function PhotoboothShare() {
    const {token, share} = useLoaderData<typeof loader>();
    const {t, i18n} = useTranslation();
    useReportVisit(`/photobooth/${token}/visit`);
    const collage = share.files.find((f) => f.kind === "collage");
    const photos = share.files.filter((f) => f.kind === "photo");
    const gallery = collage ? [collage, ...photos] : photos;
    const [open, setOpen] = useState<number | null>(null);
    const [saving, setSaving] = useState<number | null>(null);

    const date = new Date(`${share.event_date}T12:00:00Z`).toLocaleDateString(i18n.language || "fr", {
        day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });

    const save = useCallback(async (f: ShareFile) => {
        setSaving(f.id);
        try {
            await savePicture(token, f);
        } finally {
            setSaving(null);
        }
    }, [token]);

    const shareLink = async () => {
        const url = window.location.href;
        try {
            if (navigator.share) await navigator.share({title: share.event_name, url});
            else await navigator.clipboard.writeText(url);
        } catch {
            // closed by the guest
        }
    };

    return (
        <div className="min-h-screen" style={{background: C.page, color: C.text, fontFamily: "Poppins, ui-sans-serif, system-ui, sans-serif"}}>
            <div
                aria-hidden
                className="pointer-events-none fixed inset-x-0 top-0 h-[60vh]"
                style={{background: "radial-gradient(60% 60% at 50% 0%, rgba(236,127,50,0.22), transparent 70%)"}}
            />

            <main className="relative mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
                <header className="pb-reveal mb-8 flex flex-col items-center text-center">
                    <div className="mb-5 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
                         style={{background: "rgba(236,127,50,0.12)", color: C.primary, border: "1px solid rgba(236,127,50,0.25)"}}>
                        <img src="/logo.png" alt="" className="h-4 w-4 rounded"/>
                        Transat · {t("photobooth.subtitle")}
                    </div>
                    <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{share.event_name}</h1>
                    <p className="mt-2 text-sm sm:text-base" style={{color: C.muted}}>{date}</p>
                </header>

                {share.files.length === 0 && (
                    <p className="rounded-2xl p-8 text-center" style={{background: C.card, border: `1px solid ${C.border}`, color: C.muted}}>
                        {t("photobooth.empty")}
                    </p>
                )}

                {collage && (
                    <section className="pb-reveal mx-auto mb-10 max-w-2xl" style={{animationDelay: "80ms"}}>
                        <button
                            type="button"
                            onClick={() => setOpen(0)}
                            className="group block w-full overflow-hidden rounded-3xl p-2 text-left transition-transform duration-300 hover:-translate-y-1"
                            style={{background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 30px 80px -30px rgba(236,127,50,0.35)"}}
                        >
                            <Img
                                src={fileUrl(token, collage, "preview")}
                                alt={t("photobooth.collage")}
                                eager
                                natural
                                className="rounded-2xl"
                            />
                        </button>
                        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                            <button
                                type="button"
                                onClick={() => save(collage)}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold text-white transition-all active:scale-[0.98]"
                                style={{background: C.primary}}
                            >
                                <FaDownload aria-hidden/>
                                {saving === collage.id ? "…" : t("photobooth.downloadCollage")}
                                <span className="text-sm font-normal opacity-80">{formatSize(collage.size_bytes)}</span>
                            </button>
                            <button
                                type="button"
                                onClick={shareLink}
                                className="flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold transition-colors"
                                style={{background: C.card, border: `1px solid ${C.border}`}}
                            >
                                <FaShareAlt aria-hidden/>
                                {t("photobooth.shareLink")}
                            </button>
                        </div>
                    </section>
                )}

                {photos.length > 0 && (
                    <section className="pb-reveal" style={{animationDelay: "160ms"}}>
                        <h2 className="mb-4 text-lg font-semibold">{t("photobooth.photos")} <span style={{color: C.muted}}>· {photos.length}</span></h2>
                        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                            {photos.map((p, i) => (
                                <li key={p.id} className="pb-reveal" style={{animationDelay: `${220 + i * 60}ms`}}>
                                    <div className="overflow-hidden rounded-2xl" style={{background: C.card, border: `1px solid ${C.border}`}}>
                                        <button type="button" onClick={() => setOpen(gallery.indexOf(p))} className="block w-full">
                                            <Img
                                                src={fileUrl(token, p, "preview")}
                                                alt={t("photobooth.photoN", {n: p.number})}
                                                className="aspect-[4/3] transition-transform duration-500 hover:scale-[1.04]"
                                            />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => save(p)}
                                            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
                                        >
                                            <span>{t("photobooth.downloadPhoto", {n: p.number})}</span>
                                            <span className="flex items-center gap-1.5 text-xs" style={{color: C.muted}}>
                                                {saving === p.id ? "…" : formatSize(p.size_bytes)}
                                                <FaDownload aria-hidden style={{color: C.primary}}/>
                                            </span>
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                <footer className="mt-14 text-center text-xs" style={{color: C.muted}}>
                    <p>{t("photobooth.fullQuality")}</p>
                    <a href="/download" className="mt-3 inline-block underline-offset-4 hover:underline" style={{color: C.primary}}>
                        {t("photobooth.getApp")}
                    </a>
                </footer>
            </main>

            {open !== null && gallery[open] && (
                <Lightbox
                    token={token}
                    files={gallery}
                    index={open}
                    onIndex={setOpen}
                    onClose={() => setOpen(null)}
                    onSave={save}
                    saving={saving}
                    label={(f) => (f.kind === "collage" ? t("photobooth.collage") : t("photobooth.photoN", {n: f.number}))}
                    downloadLabel={t("photobooth.download")}
                />
            )}

            <style>{`
                @keyframes pb-reveal { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
                .pb-reveal { animation: pb-reveal .6s cubic-bezier(.2,.8,.2,1) both; }
                @keyframes pb-fade { from { opacity: 0; } to { opacity: 1; } }
                @media (prefers-reduced-motion: reduce) { .pb-reveal { animation: none; } }
            `}</style>
        </div>
    );
}

function Lightbox({token, files, index, onIndex, onClose, onSave, saving, label, downloadLabel}: {
    token: string;
    files: ShareFile[];
    index: number;
    onIndex: (i: number) => void;
    onClose: () => void;
    onSave: (f: ShareFile) => void;
    saving: number | null;
    label: (f: ShareFile) => string;
    downloadLabel: string;
}) {
    const f = files[index];
    const prev = () => onIndex((index - 1 + files.length) % files.length);
    const next = () => onIndex((index + 1) % files.length);
    const [touchX, setTouchX] = useState<number | null>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowLeft") prev();
            if (e.key === "ArrowRight") next();
        };
        document.addEventListener("keydown", onKey);
        const overflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = overflow;
        };
    });

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={label(f)}
            className="fixed inset-0 z-50 flex flex-col"
            style={{background: "rgba(7,4,2,0.985)", animation: "pb-fade .2s ease-out", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)"}}
            onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
            onTouchEnd={(e) => {
                if (touchX === null) return;
                const dx = e.changedTouches[0].clientX - touchX;
                if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
                setTouchX(null);
            }}
        >
            <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium">{label(f)} <span style={{color: C.muted}}>· {index + 1}/{files.length}</span></span>
                <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-full p-2.5 hover:bg-white/10">
                    <FaTimes/>
                </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
                <img
                    key={f.id}
                    src={fileUrl(token, f, "preview")}
                    alt={label(f)}
                    className="max-h-full max-w-full rounded-xl object-contain"
                    style={{animation: "pb-fade .25s ease-out"}}
                />
                {files.length > 1 && (
                    <>
                        <button type="button" onClick={prev} aria-label="Précédente"
                                className="absolute left-3 hidden rounded-full p-3 hover:bg-white/10 sm:block"><FaArrowLeft/></button>
                        <button type="button" onClick={next} aria-label="Suivante"
                                className="absolute right-3 hidden rounded-full p-3 hover:bg-white/10 sm:block"><FaArrowRight/></button>
                    </>
                )}
            </div>
            <div className="flex justify-center px-4 py-4">
                <button
                    type="button"
                    onClick={() => onSave(f)}
                    className="flex items-center gap-2 rounded-xl px-6 py-3 font-semibold text-white"
                    style={{background: C.primary}}
                >
                    <FaDownload aria-hidden/>
                    {saving === f.id ? "…" : downloadLabel}
                    <span className="text-sm font-normal opacity-80">{formatSize(f.size_bytes)}</span>
                </button>
            </div>
        </div>
    );
}
