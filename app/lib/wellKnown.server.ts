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
 * The SHA-256 fingerprints of the certificate that signs the Android app (Play Console → App integrity → App
 * signing key certificate), comma-separated in ANDROID_CERT_SHA256. Without them Android shows the web page.
 */
export function assetLinks() {
    const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
    return json([
        {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints},
        },
    ]);
}
