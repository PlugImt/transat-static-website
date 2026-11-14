import {index, route, type RouteConfig} from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("/statistics", "routes/statistics.tsx"),
    route("/download", "routes/download.tsx"),
    route("/app", "routes/app.tsx"),
    route("/account-deletion", "routes/account-deletion.tsx"),
    route("/photobooth/frames/:token", "routes/photobooth-frames.tsx"),
    route("/photobooth/frames/:token/upload/:type", "routes/photobooth-frame-upload.ts"),
    route("/photobooth/:token", "routes/photobooth.tsx"),
    route("/photobooth/:token/files/:id", "routes/photobooth-file.ts"),
    route("/photobooth/:token/visit", "routes/photobooth-visit.ts"),
    route("/albums/:album", "routes/album.tsx"),
    route("/albums/:album/photos", "routes/album-photos.ts"),
    route("/albums/:album/photos/:photo/:variant", "routes/album-file.ts"),
    route("/albums/:album/cover", "routes/album-cover.ts"),
    route("/albums/:album/download", "routes/album-download.ts"),
    route("/albums/:album/visit", "routes/album-visit.ts"),
    route("/.well-known/apple-app-site-association", "routes/apple-app-site-association.ts"),
    route("/apple-app-site-association", "routes/apple-app-site-association.ts", {id: "aasa-root"}),
    route("/.well-known/assetlinks.json", "routes/assetlinks.ts"),
] satisfies RouteConfig;
