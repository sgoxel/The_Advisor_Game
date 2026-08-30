/*
  R04 / #316: local debug-log export with public build/deployment identity.
  Presentation/diagnostic only. No log or game data is uploaded.
*/
(function installDebugLogExport(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-debug-log-export-v1';
  const REPOSITORY = 'sgoxel/The_Advisor_Game';
  const EXPECTED_BRANCH = 'main';
  const PUBLIC_URL = 'https://sgoxel.github.io/The_Advisor_Game/';
  const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
  const INSTALL_RETRY_MS = 50;
  const INSTALL_RETRY_LIMIT = 400;
  let attempts = 0;
  let installed = false;
  let metadataPromise = null;
  let lastMetadata = null;

  function text(value) {
    return value === undefined || value === null ? '' : String(value).trim();
  }

  function safeIso(value) {
    const input = text(value);
    if (!input) return null;
    const date = new Date(input);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function shortSha(value) {
    const sha = text(value);
    return sha ? sha.slice(0, 12) : 'unknown';
  }

  async function fetchJson(url) {
    const response = await global.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`GitHub metadata request failed (${response.status}).`);
    return response.json();
  }

  async function resolveSuccessfulDeployment() {
    const deployments = await fetchJson(`${API_ROOT}/deployments?per_page=20`);
    if (!Array.isArray(deployments)) return null;

    const candidates = deployments
      .filter((deployment) => deployment && deployment.sha)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    for (const deployment of candidates) {
      const environment = text(deployment.environment).toLowerCase();
      if (environment && !environment.includes('page') && environment !== 'production') continue;
      try {
        const statusesUrl = text(deployment.statuses_url);
        const statuses = statusesUrl ? await fetchJson(`${statusesUrl}?per_page=20`) : [];
        const success = Array.isArray(statuses)
          ? statuses.find((status) => text(status?.state).toLowerCase() === 'success')
          : null;
        if (!success && statusesUrl) continue;
        return {
          sha: text(deployment.sha),
          ref: text(deployment.ref) || EXPECTED_BRANCH,
          environment: text(deployment.environment) || 'github-pages',
          deployedAt: safeIso(success?.updated_at || success?.created_at || deployment.updated_at || deployment.created_at),
          deploymentId: deployment.id ?? null,
          statusId: success?.id ?? null,
          source: success ? 'github-deployments-success-status' : 'github-deployment-record'
        };
      } catch (_) {
        // Try the next public deployment record rather than inventing a timestamp.
      }
    }
    return null;
  }

  async function resolveLatestCommit() {
    try {
      const commit = await fetchJson(`${API_ROOT}/commits/${encodeURIComponent(EXPECTED_BRANCH)}`);
      return {
        sha: text(commit?.sha),
        committedAt: safeIso(commit?.commit?.committer?.date || commit?.commit?.author?.date)
      };
    } catch (_) {
      return { sha: '', committedAt: null };
    }
  }

  async function resolveReleaseVersion() {
    try {
      const release = await fetchJson(`${API_ROOT}/releases/latest`);
      return text(release?.tag_name || release?.name);
    } catch (_) {
      return '';
    }
  }

  function currentGameTime() {
    try {
      const capture = Game.GameTime?.capture?.();
      if (!capture) return null;
      return JSON.parse(JSON.stringify(capture));
    } catch (_) {
      return null;
    }
  }

  async function resolveMetadata(options = {}) {
    if (options.refresh === true) metadataPromise = null;
    if (metadataPromise) return metadataPromise;

    metadataPromise = (async () => {
      const [deployment, commit, releaseVersion] = await Promise.all([
        resolveSuccessfulDeployment().catch(() => null),
        resolveLatestCommit(),
        resolveReleaseVersion()
      ]);
      const buildSha = text(deployment?.sha || commit.sha);
      const gameVersion = releaseVersion || (buildSha ? `development-${shortSha(buildSha)}` : 'development-unknown');
      const metadata = Object.freeze({
        exporterVersion: VERSION,
        gameVersion,
        buildSha: buildSha || 'unavailable',
        buildShortSha: shortSha(buildSha),
        lastDeploy: deployment?.deployedAt || null,
        deployEnvironment: deployment?.environment || 'unavailable',
        deployedBranch: deployment?.ref || EXPECTED_BRANCH,
        publicUrl: PUBLIC_URL,
        repository: REPOSITORY,
        deploymentRecordSource: deployment?.source || 'unavailable',
        deploymentId: deployment?.deploymentId ?? null,
        deploymentStatusId: deployment?.statusId ?? null,
        latestCommitDateFallback: commit.committedAt,
        seed: text(Game.State?.world?.seed) || 'unavailable',
        gameTime: currentGameTime(),
        userAgent: text(global.navigator?.userAgent) || 'unavailable',
        viewport: {
          width: Number(global.innerWidth) || 0,
          height: Number(global.innerHeight) || 0,
          devicePixelRatio: Number(global.devicePixelRatio) || 1
        },
        exportedAt: new Date().toISOString()
      });
      lastMetadata = metadata;
      return metadata;
    })();

    return metadataPromise;
  }

  function structuredEvents() {
    try {
      if (Game.ActivityLog?.snapshot) return Game.ActivityLog.snapshot();
    } catch (_) {}
    return Array.isArray(Game.State?.log?.events) ? Game.State.log.events.map((event) => ({ ...event })) : [];
  }

  function rawLines() {
    return Array.isArray(Game.State?.log?.lines) ? Game.State.log.lines.map((line) => String(line)) : [];
  }

  function formatGameTime(value) {
    if (!value) return 'unavailable';
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function buildText(metadataInput, dataInput = {}) {
    const metadata = metadataInput || lastMetadata || {};
    const events = Array.isArray(dataInput.events) ? dataInput.events : structuredEvents();
    const lines = Array.isArray(dataInput.lines) ? dataInput.lines : rawLines();
    const out = [
      'THE ADVISOR GAME - DEBUG LOG',
      '',
      `Game Version: ${text(metadata.gameVersion) || 'unavailable'}`,
      `Build SHA: ${text(metadata.buildSha) || 'unavailable'}`,
      `Last Deploy: ${text(metadata.lastDeploy) || 'unavailable (no successful public deployment record resolved)'}`,
      `Deploy Environment: ${text(metadata.deployEnvironment) || 'unavailable'}`,
      `Deployed Branch: ${text(metadata.deployedBranch) || EXPECTED_BRANCH}`,
      `Public URL: ${text(metadata.publicUrl) || PUBLIC_URL}`,
      `Repository: ${text(metadata.repository) || REPOSITORY}`,
      `Deployment Metadata Source: ${text(metadata.deploymentRecordSource) || 'unavailable'}`,
      `Seed: ${text(metadata.seed) || 'unavailable'}`,
      `Game Time: ${formatGameTime(metadata.gameTime)}`,
      `Viewport: ${Number(metadata.viewport?.width) || 0}x${Number(metadata.viewport?.height) || 0} @ DPR ${Number(metadata.viewport?.devicePixelRatio) || 1}`,
      `Browser: ${text(metadata.userAgent) || 'unavailable'}`,
      `Exported At: ${text(metadata.exportedAt) || new Date().toISOString()}`,
      '',
      '----------------------------------------',
      'STRUCTURED ACTIVITY EVENTS',
      '----------------------------------------'
    ];

    if (!events.length) out.push('(none)');
    for (const event of events) {
      out.push(JSON.stringify(event));
    }

    out.push('', '----------------------------------------', 'RAW COMPATIBILITY LOG', '----------------------------------------');
    if (!lines.length) out.push('(none)');
    else out.push(...lines);
    out.push('');
    return out.join('\n');
  }

  function filenameFor(metadata) {
    const stamp = text(metadata?.exportedAt || new Date().toISOString()).replace(/[.:]/g, '-');
    const sha = shortSha(metadata?.buildSha).replace(/[^a-z0-9_-]/gi, '_');
    return `advisor-game-debug-${sha}-${stamp}.txt`;
  }

  function triggerDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function download() {
    const button = document.getElementById('downloadLogsBtn');
    if (button) button.disabled = true;
    try {
      const metadata = await resolveMetadata({ refresh: true });
      const content = buildText(metadata);
      const filename = filenameFor(metadata);
      triggerDownload(content, filename);
      return { filename, metadata, content };
    } finally {
      if (button) button.disabled = false;
    }
  }

  function ensureButton() {
    const footer = document.querySelector('#logModal .activity-log-footer');
    if (!footer) return false;
    let button = document.getElementById('downloadLogsBtn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'downloadLogsBtn';
      button.type = 'button';
      button.className = 'secondary-btn';
      button.textContent = 'Download Logs';
      button.setAttribute('aria-label', 'Download debug logs');
      const close = document.getElementById('closeLogBtn');
      if (close) footer.insertBefore(button, close);
      else footer.appendChild(button);
    }
    if (button.dataset.debugLogExportBound !== 'true') {
      button.dataset.debugLogExportBound = 'true';
      button.addEventListener('click', () => {
        download().catch((error) => {
          Game.UI?.addLog?.('Debug log export failed.', error?.message || String(error), {
            category: 'system', severity: 'error', source: 'debug-log-export'
          });
        });
      });
    }
    return true;
  }

  function install() {
    if (installed) return true;
    attempts += 1;
    if (!Game.State || !Game.ActivityLog || !ensureButton()) {
      if (attempts < INSTALL_RETRY_LIMIT) global.setTimeout(install, INSTALL_RETRY_MS);
      return false;
    }
    installed = true;
    return true;
  }

  Game.DebugLogExport = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    publicUrl: PUBLIC_URL,
    repository: REPOSITORY,
    resolveMetadata,
    buildText,
    filenameFor,
    download,
    install,
    snapshotLastMetadata() { return lastMetadata ? { ...lastMetadata } : null; }
  });

  install();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})(typeof window !== 'undefined' ? window : globalThis);
