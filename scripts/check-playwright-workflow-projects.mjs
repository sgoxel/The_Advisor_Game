import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const workflowRoot = path.join(repoRoot, '.github', 'workflows');
const configPath = path.join(repoRoot, 'playwright.config.mjs');

function isDynamicSelector(selector) {
  return selector.includes('${{') || selector.includes('${') || selector.includes('$(') || /[*?]/.test(selector);
}

function extractLiteralSelectors(text) {
  const selectors = [];
  const regex = /--project(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const selector = match[1] ?? match[2] ?? match[3] ?? '';
    if (selector && !isDynamicSelector(selector)) selectors.push(selector);
  }
  return selectors;
}

function validateWorkflowText(text, configuredProjects, source = '<memory>') {
  return extractLiteralSelectors(text)
    .filter((selector) => !configuredProjects.has(selector))
    .map((selector) => ({ source, selector }));
}

function collectWorkflowFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) return collectWorkflowFiles(absolute);
      return /\.ya?ml$/i.test(entry.name) ? [absolute] : [];
    });
}

async function configuredProjectNames() {
  const imported = await import(`${pathToFileURL(configPath).href}?guard=${Date.now()}`);
  const config = imported.default;
  const projects = Array.isArray(config?.projects) ? config.projects : [];
  const names = new Set(projects.map((project) => project?.name).filter(Boolean));
  if (names.size === 0) throw new Error('No Playwright projects were found in playwright.config.mjs.');
  return names;
}

function runSelfTest() {
  const configured = new Set(['desktop', 'tablet', 'phone-portrait', 'phone-landscape']);
  const valid = validateWorkflowText('run: npx playwright test smoke.spec.mjs --project=desktop', configured);
  const invalid = validateWorkflowText('run: npx playwright test smoke.spec.mjs --project=chromium', configured, 'fixture.yml');
  const dynamic = validateWorkflowText('run: npx playwright test smoke.spec.mjs --project=${{ matrix.project }}', configured);

  if (valid.length !== 0) throw new Error('Self-test failed: configured literal selector was rejected.');
  if (invalid.length !== 1 || invalid[0].selector !== 'chromium') {
    throw new Error('Self-test failed: known invalid literal selector was not rejected.');
  }
  if (dynamic.length !== 0) throw new Error('Self-test failed: dynamic selector was treated as a literal.');
  console.log('Self-test PASS: valid literal accepted, invalid literal rejected, dynamic selector ignored.');
}

async function main() {
  if (process.argv.includes('--self-test')) runSelfTest();

  const configured = await configuredProjectNames();
  const failures = [];
  for (const file of collectWorkflowFiles(workflowRoot)) {
    const text = fs.readFileSync(file, 'utf8');
    const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');
    failures.push(...validateWorkflowText(text, configured, relative));
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Invalid Playwright project selector '${failure.selector}' in ${failure.source}. Configured projects: ${Array.from(configured).join(', ')}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Playwright workflow selector guard PASS. Configured projects: ${Array.from(configured).join(', ')}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

export { extractLiteralSelectors, validateWorkflowText };
