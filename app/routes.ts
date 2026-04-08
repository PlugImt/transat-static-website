import {index, route, type RouteConfig} from "@react-router/dev/routes";

export default [
    index("routes/home.tsx"),
    route("/statistics", "routes/statistics.tsx"),
    route("/download", "routes/download.tsx"),
    route("/app", "routes/app.tsx"),
    route("/account-deletion", "routes/account-deletion.tsx"),
] satisfies RouteConfig;
