import {data, useLoaderData} from "react-router";
import {useTranslation} from "react-i18next";
import {FaDownload} from "react-icons/fa";

import {Container, Section, Text} from "../components";
import {photoboothApi, type Share, type ShareFile, validToken} from "../lib/photobooth.server";

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

export function meta({data: d}: { data?: { share: Share } }) {
    const title = d ? `Photobooth · ${d.share.event_name} - Transat` : "Photobooth - Transat";
    return [
        {title},
        {name: "robots", content: "noindex, nofollow"},
        {name: "referrer", content: "no-referrer"},
    ];
}

function formatSize(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function DownloadLink({token, file, label}: { token: string; file: ShareFile; label: string }) {
    return (
        <a
            href={`/photobooth/${token}/files/${file.id}?download=1`}
            download={file.name}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ec7f32] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[#d96e22]"
        >
            <FaDownload aria-hidden/>
            {label}
            <span className="font-normal opacity-80">({formatSize(file.size_bytes)})</span>
        </a>
    );
}

export default function PhotoboothShare() {
    const {token, share} = useLoaderData<typeof loader>();
    const {t, i18n} = useTranslation();
    const collage = share.files.find((f) => f.kind === "collage");
    const photos = share.files.filter((f) => f.kind === "photo");
    const date = new Date(`${share.event_date}T12:00:00Z`).toLocaleDateString(i18n.language || "fr", {
        day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
    const preview = (f: ShareFile) => `/photobooth/${token}/files/${f.id}?size=preview`;

    return (
        <Section title={share.event_name} subtitle={`${t("photobooth.subtitle")} · ${date}`} spacing="lg">
            <Container maxWidth="lg">
                {share.files.length === 0 && <Text className="text-center">{t("photobooth.empty")}</Text>}

                {collage && (
                    <figure className="mx-auto mb-12 flex max-w-3xl flex-col items-center gap-4">
                        <img
                            src={preview(collage)}
                            alt={t("photobooth.collage")}
                            width={collage.width}
                            height={collage.height}
                            className="h-auto max-h-[75vh] w-auto max-w-full rounded-xl shadow-2xl"
                        />
                        <DownloadLink token={token} file={collage} label={t("photobooth.downloadCollage")}/>
                    </figure>
                )}

                {photos.length > 0 && (
                    <>
                        <h2 className="mb-6 text-center text-2xl font-semibold">{t("photobooth.photos")}</h2>
                        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {photos.map((p) => (
                                <li key={p.id} className="flex flex-col items-center gap-3">
                                    <img
                                        src={preview(p)}
                                        alt={t("photobooth.photoN", {n: p.number})}
                                        loading="lazy"
                                        width={p.width}
                                        height={p.height}
                                        className="h-auto w-full rounded-lg object-cover shadow-lg"
                                    />
                                    <DownloadLink token={token} file={p} label={t("photobooth.downloadPhoto", {n: p.number})}/>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
                <Text className="mt-12 text-center text-sm opacity-70">{t("photobooth.fullQuality")}</Text>
            </Container>
        </Section>
    );
}
