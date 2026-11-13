import {isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation,} from "react-router";
import {useTranslation} from 'react-i18next';
import {useEffect} from 'react';

import type {Route} from "./+types/root";
import {Button, Card, CardContent, CardHeader, CardTitle, Container, PageLayout, Text} from "./components";
import "./i18n"; // Import i18n configuration
import "./app.css";

export const links: Route.LinksFunction = () => [
    {rel: "preconnect", href: "https://fonts.googleapis.com"},
    {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
    },
    {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap",
    },
];

export function Layout({children}: { children: React.ReactNode }) {
    return (
        <html lang="en">
        <head>
            <meta charSet="utf-8"/>
            <meta name="viewport" content="width=device-width, initial-scale=1"/>
            <Meta/>
            <Links/>
        </head>
        <body>
        {children}
        <ScrollRestoration/>
        <Scripts/>
        </body>
        </html>
    );
}

export default function App() {
    const {i18n} = useTranslation();
    const location = useLocation();

    // Set language based on browser preference
    useEffect(() => {
        // Default behavior handled by i18next-browser-languagedetector
    }, []);

    return (
        // The photobooth and album share pages are standalone, like a screen of the app: no site header or footer.
        location.pathname.startsWith("/photobooth/") || location.pathname.startsWith("/albums/") ? <Outlet/> : (
            <PageLayout>
                <Outlet/>
            </PageLayout>
        )
    );
}

export function ErrorBoundary({error}: Route.ErrorBoundaryProps) {
    const {t} = useTranslation();
    let message = t('errors.unexpectedError');
    let details = "";
    let stack: string | undefined;

    if (isRouteErrorResponse(error)) {
        message = error.status === 404 ? t('errors.404') : "Error";
        details =
            error.status === 404
                ? t('errors.pageNotFound')
                : error.statusText || t('errors.unexpectedError');
    } else if (import.meta.env.DEV && error && error instanceof Error) {
        details = error.message;
        stack = error.stack;
    }

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <Container maxWidth="sm">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-error">
                            {message}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Text color="muted" className="mb-6">
                            {details}
                        </Text>

                        <div className="flex flex-col gap-4">
                            <Button
                                variant="primary"
                                onClick={() => window.location.href = "/"}
                            >
                                Go Home
                            </Button>

                            <Button
                                variant="outline"
                                onClick={() => window.location.reload()}
                            >
                                Try Again
                            </Button>
                        </div>

                        {stack && (
                            <pre className="mt-6 p-4 bg-card-hover rounded-md overflow-x-auto text-xs">
                <code>{stack}</code>
              </pre>
                        )}
                    </CardContent>
                </Card>
            </Container>
        </div>
    );
}
