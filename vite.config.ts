import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The deployed page must state which release it actually is. Version, commit and
 * build time are baked in at build time from the real repository state, so the
 * badge can never drift from the bytes being served.
 */
function git(args: string, fallback: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
}

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string; repository?: string | { url?: string } };
const version = pkg.version || "0.0.0";
const fullSha = (process.env.GITHUB_SHA || git("rev-parse HEAD", "unknown")).trim();
const shortSha = /^[0-9a-f]{7,40}$/i.test(fullSha) ? fullSha.slice(0, 7) : "unknown";
const builtAt = new Date().toISOString();
const repoUrl = "https://github.com/sgoxel/The_Advisor_Game";

export default defineConfig({
  base: "./",
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
    __BUILD_SHA__: JSON.stringify(shortSha),
    __BUILD_FULL_SHA__: JSON.stringify(fullSha),
    __BUILD_TIME__: JSON.stringify(builtAt),
    __BUILD_REPO_URL__: JSON.stringify(repoUrl),
  },
  build: { target: "es2022", rollupOptions: { input: { game: 'index.html', characters: 'characters.html' } } },
});
