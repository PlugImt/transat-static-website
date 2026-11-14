// Universal Links (iOS) and App Links (Android): a phone with the Transat app opens album links in the app.
// Both files must be served as JSON, without any redirect, at these exact paths.

const IOS_APP_ID = "MNJWMF9YMG.fr.resel.transat";
const ANDROID_PACKAGE = "com.yohann69.transat2_0";

const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
        headers: {"Content-Type": "application/json", "Cache-Control": "public, max-age=3600"},
    });

export function appleAppSiteAssociation() {
    return json({
        applinks: {
            details: [
                {
                    appIDs: [IOS_APP_ID],
                    components: [{"/": "/albums/*", comment: "Photo albums"}],
                },
            ],
        },
    });
}

/**
 * The certificates that sign the Android app (public data): Google's app signing key, which signs what the Play
 * Store installs (Play Console → Test and release → App integrity → Play app signing), and the upload key (EAS
 * keystore), which signs the builds installed outside the store.
 */
const CERTS_SHA256 = [
    "3F:D7:2E:15:06:34:FA:2C:53:1B:54:53:4C:3E:23:3A:0B:D0:1D:DE:05:FE:4E:75:89:A0:B0:AE:85:08:DB:B4", // Play app signing
    "18:2B:CB:E0:63:70:EC:7B:24:9C:3B:0F:14:57:A2:38:69:E9:F1:A7:F6:A0:70:23:C1:D2:6C:83:E6:8F:95:76", // upload key
];

/**
 * The SHA-256 fingerprints of the certificates that sign the Android app; ANDROID_CERT_SHA256 (comma-separated)
 * adds more. Without the right one Android shows the web page instead of the app.
 */
export function assetLinks() {
    const fingerprints = [...CERTS_SHA256, ...(process.env.ANDROID_CERT_SHA256 ?? "").split(",")]
        .map((s) => s.trim().toUpperCase())
        .filter((s, i, all) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s) && all.indexOf(s) === i);
    return json([
        {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints},
        },
    ]);
}
