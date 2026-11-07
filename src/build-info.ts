/**
 * Build/release identity for the deployed page.
 *
 * Vite replaces these identifiers at build time with the real package version,
 * the actual commit that produced the bundle and the build timestamp. The page
 * therefore always shows the release it truly is, instead of a hand-maintained
 * string that could drift from the deployed bytes.
 */

declare const __BUILD_VERSION__: string | undefined;
declare const __BUILD_SHA__: string | undefined;
declare const __BUILD_FULL_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;
declare const __BUILD_REPO_URL__: string | undefined;

export type BuildInfo = {
  readonly version: string;
  readonly shortSha: string;
  readonly fullSha: string;
  readonly builtAt: string;
  readonly repoUrl: string;
};

/** Reads the injected constants; safe when they are absent (unit tests, plain Node). */
export function readBuildInfo(): BuildInfo {
  const pick = (value: string | undefined, fallback: string) =>
    typeof value === "string" && value.length > 0 ? value : fallback;
  return {
    version: pick(typeof __BUILD_VERSION__ === "undefined" ? undefined : __BUILD_VERSION__, "dev"),
    shortSha: pick(typeof __BUILD_SHA__ === "undefined" ? undefined : __BUILD_SHA__, "local"),
    fullSha: pick(typeof __BUILD_FULL_SHA__ === "undefined" ? undefined : __BUILD_FULL_SHA__, "local"),
    builtAt: pick(typeof __BUILD_TIME__ === "undefined" ? undefined : __BUILD_TIME__, ""),
    repoUrl: pick(typeof __BUILD_REPO_URL__ === "undefined" ? undefined : __BUILD_REPO_URL__, "https://github.com/sgoxel/The_Advisor_Game"),
  };
}

/** Short human label, e.g. "v0.1.0 · 8d7f610". */
export function formatBuildLabel(info: BuildInfo): string {
  return `v${info.version} · ${info.shortSha}`;
}

/** Full accessible description used for the tooltip and screen readers. */
export function formatBuildDescription(info: BuildInfo, locale?: string): string {
  const parts = [`Release ${info.version}`, `commit ${info.fullSha}`];
  if (info.builtAt) {
    const date = new Date(info.builtAt);
    if (!Number.isNaN(date.getTime())) {
      parts.push(`built ${date.toLocaleString(locale)}`);
    }
  }
  return parts.join(" · ");
}

/** Where the badge should point: the exact commit that produced this build. */
export function buildCommitUrl(info: BuildInfo): string {
  const base = info.repoUrl.replace(/\/+$/, "");
  return /^[0-9a-f]{7,40}$/i.test(info.fullSha) ? `${base}/commit/${info.fullSha}` : `${base}/commits`;
}

/** Injects the release identity into the masthead badge (no-op if absent). */
export function mountBuildBadge(doc: Document = document, info: BuildInfo = readBuildInfo()): void {
  const badge = doc.getElementById("build-badge");
  if (!badge) return;
  badge.textContent = formatBuildLabel(info);
  badge.setAttribute("title", formatBuildDescription(info));
  badge.setAttribute("aria-label", `Current release: ${formatBuildDescription(info)}`);
  const href = buildCommitUrl(info);
  if (badge instanceof HTMLAnchorElement) badge.href = href;
  else badge.setAttribute("data-href", href);
  badge.hidden = false;
}
