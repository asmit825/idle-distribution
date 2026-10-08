// Stamped at build time by vite.config.ts from package.json and git.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
/** Shown in the landing footer, e.g. `v0.1.0 · 86d266b`. */
export const VERSION_LABEL = `v${APP_VERSION} · ${APP_COMMIT}`;
