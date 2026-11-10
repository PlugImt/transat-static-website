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
] satisfies RouteConfig;
