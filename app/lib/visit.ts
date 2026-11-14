import {useEffect} from "react";

// Audience of the public pages (how many people opened a photobooth QR code or an album). The visitor is a random
// id kept in this browser only, never tied to an account or an address; the API stores its hash.

const KEY = "transat-visitor";

function visitorId(): string | null {
    try {
        let id = localStorage.getItem(KEY);
        if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
            id = crypto.randomUUID();
            localStorage.setItem(KEY, id);
        }
        return id;
    } catch {
        return null; // private browsing without storage: not counted
    }
}

/** Reports one opening of the page to `path` (this site's route, which forwards it to the API). */
export function useReportVisit(path: string) {
    useEffect(() => {
        const visitor = visitorId();
        if (!visitor) return;
        fetch(path, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({visitor}),
            keepalive: true,
        }).catch(() => undefined);
    }, [path]);
}
