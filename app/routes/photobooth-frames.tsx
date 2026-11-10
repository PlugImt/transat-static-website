import {useEffect, useRef, useState} from "react";
import {data, useLoaderData} from "react-router";
import {FaCheckCircle, FaCloudUploadAlt, FaDownload, FaExclamationTriangle, FaFilePdf, FaRegClock} from "react-icons/fa";

import {type FrameLayout, type FrameSession, type FrameZone, photoboothApi, validToken} from "../lib/photobooth.server";

export async function loader({params}: { params: { token?: string } }) {
    const token = params.token;
    if (!validToken(token)) {
        return data({token: "", session: null}, {status: 404, headers: {"X-Robots-Tag": "noindex, nofollow"}});
    }
    const res = await fetch(`${photoboothApi()}/photobooth/frames/${token}`, {
        headers: {Accept: "application/json"},
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) {
        return data({token, session: null}, {status: 404, headers: {"X-Robots-Tag": "noindex, nofollow"}});
    }
    if (!res.ok) {
        throw data("Unavailable", {status: 503});
    }
    const session = (await res.json()) as FrameSession;
    return data({token, session}, {headers: {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}});
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

export function meta({data: d}: { data?: { session: FrameSession | null } }) {
    const title = d?.session ? `Visuels · ${d.session.event_name} · Photobooth Transat` : "Photobooth Transat";
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
    ok: "#4ade80",
    error: "#f87171",
};

const MAX_BYTES = 14 * 1024 * 1024;
const MAX_PX = 6000;
const MAX_ASPECT_DRIFT = 0.02;
/** 2 mm at 300 dpi: what the printer may trim off each edge. */
const BLEED_PX = 24;

const isStrips = (l: FrameLayout) => l.type.startsWith("STRIP_");
const fileStem = (event: string, l: FrameLayout) =>
    `${event} - ${l.title}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "_");

/** The photos' ratio, for the matching set of vector templates. */
function photoRatio(layouts: FrameLayout[]): "4-3" | "3-2" | "16-9" {
    const ratios = layouts.flatMap((l) => l.photos).map((z) => Math.max(z.w, z.h) / Math.min(z.w, z.h)).filter((r) => r > 1.05);
    if (ratios.length === 0) return "4-3";
    const median = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
    return median > 1.65 ? "16-9" : median > 1.42 ? "3-2" : "4-3";
}

/* ---------- Templates ---------- */

/**
 * The template of one layout as an SVG, at the canvas' own pixel size: the photo zones (the photos are printed over
 * them, so nothing drawn there will show), the zone kept free for the title, the trim margin and, for strips, the
 * cut line.
 */
function templateSvg(l: FrameLayout, opts: { labels: boolean } = {labels: true}): string {
    const font = Math.round(Math.min(l.width, l.height) / 26);
    const zone = (z: FrameZone) => {
        const label = opts.labels
            ? `<text x="${z.x + z.w / 2}" y="${z.y + z.h / 2}" font-size="${font}" font-family="Poppins, Arial, sans-serif" font-weight="700" fill="#be185d" text-anchor="middle" dominant-baseline="middle">Photo ${z.shot ?? 1}</text>
               <text x="${z.x + z.w / 2}" y="${z.y + z.h / 2 + font * 1.2}" font-size="${font * 0.55}" font-family="Poppins, Arial, sans-serif" fill="#be185d" text-anchor="middle" dominant-baseline="middle">${z.w} × ${z.h} px · x ${z.x}, y ${z.y}</text>`
            : "";
        return `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="#fbcfe8" stroke="#db2777" stroke-width="4"/>${label}`;
    };
    const t = l.title_zone;
    const title = t
        ? `<rect x="${t.x + 8}" y="${t.y + 8}" width="${t.w - 16}" height="${t.h - 16}" fill="none" stroke="#2563eb" stroke-width="4" stroke-dasharray="18 12"/>
           ${opts.labels ? `<text x="${t.x + t.w / 2}" y="${t.y + t.h / 2}" font-size="${font * 0.8}" font-family="Poppins, Arial, sans-serif" font-weight="600" fill="#2563eb" text-anchor="middle" dominant-baseline="middle">Zone titre / logo</text>` : ""}`
        : "";
    const cut = isStrips(l)
        ? `<line x1="${l.width / 2}" y1="0" x2="${l.width / 2}" y2="${l.height}" stroke="#111" stroke-width="3" stroke-dasharray="14 10"/>`
        : "";
    const bleed = `<rect x="${BLEED_PX}" y="${BLEED_PX}" width="${l.width - 2 * BLEED_PX}" height="${l.height - 2 * BLEED_PX}" fill="none" stroke="#dc2626" stroke-width="3" stroke-dasharray="10 8"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}">
        <rect width="${l.width}" height="${l.height}" fill="#ffffff"/>${title}${l.photos.map(zone).join("")}${cut}${bleed}</svg>`;
}

async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
    const url = URL.createObjectURL(new Blob([svg], {type: "image/svg+xml"}));
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** A white layer with transparent holes where the photos go: the starting point for a design in any editor. */
async function maskPngBlob(l: FrameLayout): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = l.width;
    canvas.height = l.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, l.width, l.height);
    for (const z of l.photos) ctx.clearRect(z.x, z.y, z.w, z.h);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
}

function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ---------- Checks done before sending, the same as the server's ---------- */

async function checkFrame(file: File, l: FrameLayout): Promise<string | null> {
    if (file.type !== "image/png" && !file.name.toLowerCase().endsWith(".png")) {
        return "Le visuel doit être un PNG (exporte-le en PNG depuis ton logiciel).";
    }
    if (file.size > MAX_BYTES) return "L'image dépasse 14 Mo : exporte-la sans métadonnées ou en compression PNG plus forte.";
    let w: number, h: number;
    try {
        const bmp = await createImageBitmap(file);
        w = bmp.width;
        h = bmp.height;
        bmp.close();
    } catch {
        return "Ce fichier n'est pas une image PNG lisible.";
    }
    const want = l.width / l.height;
    if (Math.abs(w / h - want) / want > MAX_ASPECT_DRIFT) {
        return `Ce collage attend une image de ${l.width} × ${l.height} px (ou les mêmes proportions), celle-ci fait ${w} × ${h} px.`;
    }
    if (w < l.width / 2) return `L'image est trop petite (${w} × ${h} px) : exporte-la en ${l.width} × ${l.height} px.`;
    if (w > MAX_PX || h > MAX_PX) return `L'image est trop grande (${w} × ${h} px) : exporte-la en ${l.width} × ${l.height} px.`;
    return null;
}

/* ---------- Page ---------- */

function useRemaining(expiresAt: string | undefined) {
    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);
    if (!expiresAt || now === null) return null;
    return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 60_000));
}

export default function PhotoboothFrames() {
    const {token, session} = useLoaderData<typeof loader>();
    const minutes = useRemaining(session?.expires_at);

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
                        Transat · Photobooth
                    </div>
                    {session ? (
                        <>
                            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">Visuels des collages</h1>
                            <p className="mt-2 text-base sm:text-lg">{session.event_name}</p>
                            {minutes !== null && (
                                <p className="mt-3 flex items-center gap-1.5 text-xs" style={{color: minutes < 15 ? C.error : C.muted}}>
                                    <FaRegClock aria-hidden/>
                                    {minutes > 0 ? `Lien valable encore ${minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`}` : "Lien expiré"}
                                </p>
                            )}
                        </>
                    ) : (
                        <>
                            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">Ce lien a expiré</h1>
                            <p className="mt-3 max-w-md text-sm" style={{color: C.muted}}>
                                Sur la tablette, ouvre l'admin, onglet « Layouts & frames », puis « Receive frames by QR code » pour en afficher un nouveau.
                            </p>
                        </>
                    )}
                </header>

                {session && (
                    <>
                        <Guide ratio={photoRatio(session.layouts)}/>
                        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                            {session.layouts.map((l, i) => (
                                <li key={l.type} className="pb-reveal" style={{animationDelay: `${120 + i * 60}ms`}}>
                                    <LayoutCard token={token} event={session.event_name} layout={l} uploaded={!!session.uploaded[l.type]}/>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </main>
            <style>{`
                @keyframes pb-reveal { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
                .pb-reveal { animation: pb-reveal .6s cubic-bezier(.2,.8,.2,1) both; }
                @media (prefers-reduced-motion: reduce) { .pb-reveal { animation: none; } }
            `}</style>
        </div>
    );
}

function Guide({ratio}: { ratio: string }) {
    const steps = [
        "Télécharge le gabarit du collage : les zones roses sont les photos, la zone bleue est libre pour le titre ou le logo.",
        "Crée ton visuel par-dessus dans ton logiciel (Canva, Photoshop, Figma…), aux dimensions indiquées. Les photos seront imprimées sur les zones roses : rien de ce qui s'y trouve ne sera visible.",
        "Garde le texte important à l'intérieur du cadre rouge : l'imprimante peut rogner 2 mm sur les bords.",
        "Exporte en PNG et envoie-le ici : la tablette le télécharge et l'applique toute seule en quelques secondes.",
    ];
    return (
        <section className="pb-reveal mb-8 rounded-2xl p-5 sm:p-6" style={{background: C.card, border: `1px solid ${C.border}`, animationDelay: "60ms"}}>
            <ol className="grid gap-3 text-sm sm:grid-cols-2">
                {steps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{background: C.primary}}>{i + 1}</span>
                        <span style={{color: C.muted}}>{s}</span>
                    </li>
                ))}
            </ol>
            <a
                href={`/photobooth-templates/gabarits-photos-${ratio}.pdf`}
                download
                className="mt-5 inline-flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
                style={{color: C.primary}}
            >
                <FaFilePdf aria-hidden/> Tous les gabarits en PDF vectoriel (10 × 15 cm)
            </a>
        </section>
    );
}

type Status = { kind: "idle" } | { kind: "checking" } | { kind: "sending"; progress: number } | { kind: "done" } | { kind: "error"; message: string };

function upload(token: string, type: string, file: File, onProgress: (p: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const body = new FormData();
        body.set("file", file, "frame.png");
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/photobooth/frames/${token}/upload/${type}`);
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) return resolve();
            let message = "L'envoi a échoué, réessaie.";
            try {
                const err = JSON.parse(xhr.responseText)?.error;
                if (typeof err === "string" && err) message = err;
            } catch {
                // keep the generic message
            }
            reject(new Error(message));
        };
        xhr.onerror = () => reject(new Error("Pas de connexion : réessaie quand le réseau revient."));
        xhr.send(body);
    });
}

function LayoutCard({token, event, layout: l, uploaded}: { token: string; event: string; layout: FrameLayout; uploaded: boolean }) {
    const [status, setStatus] = useState<Status>(uploaded ? {kind: "done"} : {kind: "idle"});
    const [preview, setPreview] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const portrait = l.height > l.width;
    const shots = new Set(l.photos.map((p) => p.shot ?? 1)).size;

    useEffect(() => () => {
        if (preview) URL.revokeObjectURL(preview);
    }, [preview]);

    const pick = async (file: File | undefined) => {
        if (!file) return;
        setStatus({kind: "checking"});
        const problem = await checkFrame(file, l);
        if (problem) {
            setStatus({kind: "error", message: problem});
            return;
        }
        setPreview(URL.createObjectURL(file));
        setStatus({kind: "sending", progress: 0});
        try {
            await upload(token, l.type, file, (p) => setStatus({kind: "sending", progress: p}));
            setStatus({kind: "done"});
        } catch (e) {
            setStatus({kind: "error", message: (e as Error).message});
        }
    };

    const downloadTemplate = async () => saveBlob(await svgToPngBlob(templateSvg(l), l.width, l.height), `${fileStem(event, l)}_gabarit.png`);
    const downloadMask = async () => saveBlob(await maskPngBlob(l), `${fileStem(event, l)}_masque.png`);

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-2xl" style={{background: C.card, border: `1px solid ${status.kind === "done" ? "rgba(74,222,128,0.45)" : C.border}`}}>
            <div className="flex items-center justify-between gap-2 px-4 pt-4">
                <div>
                    <h2 className="font-semibold">{l.title}</h2>
                    <p className="text-xs" style={{color: C.muted}}>
                        {l.width} × {l.height} px · {shots} photo{shots > 1 ? "s" : ""}{isStrips(l) ? ", 2 bandes" : ""}
                    </p>
                </div>
                {status.kind === "done" && (
                    <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{background: "rgba(74,222,128,0.12)", color: C.ok}}>
                        <FaCheckCircle aria-hidden/> Envoyé
                    </span>
                )}
            </div>

            <div className="flex flex-1 items-center justify-center p-4">
                <div className={portrait ? "w-2/3" : "w-full"}>
                    <Preview layout={l} image={preview}/>
                </div>
            </div>

            <div className="flex gap-2 px-4 text-xs">
                <button type="button" onClick={downloadTemplate} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 font-medium transition-colors hover:bg-white/5" style={{border: `1px solid ${C.border}`}}>
                    <FaDownload aria-hidden style={{color: C.primary}}/> Gabarit PNG
                </button>
                <button type="button" onClick={downloadMask} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 font-medium transition-colors hover:bg-white/5" style={{border: `1px solid ${C.border}`}}
                        title="Calque blanc avec des trous transparents à la place des photos">
                    <FaDownload aria-hidden style={{color: C.primary}}/> Masque PNG
                </button>
            </div>

            <div className="p-4">
                <input ref={input} type="file" accept="image/png" className="hidden" onChange={(e) => {
                    void pick(e.target.files?.[0]);
                    e.target.value = "";
                }}/>
                <button
                    type="button"
                    disabled={status.kind === "checking" || status.kind === "sending"}
                    onClick={() => input.current?.click()}
                    className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-3 font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-80"
                    style={{background: status.kind === "done" ? "#2a2020" : C.primary, border: status.kind === "done" ? `1px solid ${C.border}` : "none"}}
                >
                    {status.kind === "sending" && (
                        <span aria-hidden className="absolute inset-y-0 left-0 transition-all" style={{width: `${Math.round(status.progress * 100)}%`, background: "rgba(255,255,255,0.18)"}}/>
                    )}
                    <FaCloudUploadAlt aria-hidden className="relative"/>
                    <span className="relative">
                        {status.kind === "checking" ? "Vérification…"
                            : status.kind === "sending" ? `Envoi… ${Math.round(status.progress * 100)} %`
                                : status.kind === "done" ? "Remplacer le visuel"
                                    : "Envoyer le visuel (PNG)"}
                    </span>
                </button>
                {status.kind === "done" && (
                    <p className="mt-2 text-center text-xs" style={{color: C.muted}}>La tablette l'applique automatiquement à ce collage.</p>
                )}
                {status.kind === "error" && (
                    <p role="alert" className="mt-2 flex gap-1.5 text-xs" style={{color: C.error}}>
                        <FaExclamationTriangle aria-hidden className="mt-0.5 shrink-0"/> {status.message}
                    </p>
                )}
            </div>
        </div>
    );
}

/** The template, or the sent visual with the photo zones laid over it as they will be printed. */
function Preview({layout: l, image}: { layout: FrameLayout; image: string | null }) {
    if (!image) {
        return (
            <div
                className="overflow-hidden rounded-md shadow-lg [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{__html: templateSvg(l, {labels: false}).replace(/ width="\d+" height="\d+"/, "")}}
            />
        );
    }
    return (
        <svg viewBox={`0 0 ${l.width} ${l.height}`} className="block h-auto w-full overflow-hidden rounded-md shadow-lg">
            <image href={image} x={0} y={0} width={l.width} height={l.height} preserveAspectRatio="none"/>
            {l.photos.map((z, i) => (
                <g key={i}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="rgba(30,21,21,0.72)"/>
                    <text x={z.x + z.w / 2} y={z.y + z.h / 2} fontSize={Math.min(l.width, l.height) / 14} fill="#ffe6cc" textAnchor="middle" dominantBaseline="middle"
                          fontFamily="Poppins, sans-serif" fontWeight={600}>{z.shot ?? 1}</text>
                </g>
            ))}
        </svg>
    );
}
