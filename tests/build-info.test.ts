/**
 * The deployed page must name the exact release it is running. These tests pin
 * the label/description/link rules so the badge can never claim a version or
 * commit that does not correspond to the build.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCommitUrl,
  formatBuildDescription,
  formatBuildLabel,
  readBuildInfo,
  type BuildInfo,
} from "../src/build-info.ts";

const info = (overrides: Partial<BuildInfo> = {}): BuildInfo => ({
  version: "0.1.0",
  shortSha: "8d7f610",
  fullSha: "8d7f610c91bf88def3a52b618f23b031a7204dcd",
  builtAt: "2026-11-07T02:11:57.000Z",
  repoUrl: "https://github.com/sgoxel/The_Advisor_Game",
  ...overrides,
});

test("the badge shows the package version together with the real short commit", () => {
  assert.equal(formatBuildLabel(info()), "v0.1.0 · 8d7f610");
  assert.equal(formatBuildLabel(info({ version: "1.2.3" })), "v1.2.3 · 8d7f610");
});

test("the description names release, full commit and build time", () => {
  const text = formatBuildDescription(info(), "en-US");
  assert.match(text, /^Release 0\.1\.0 · commit 8d7f610c91bf88def3a52b618f23b031a7204dcd · built /);
});

test("an absent build timestamp never produces an empty 'built' clause", () => {
  const text = formatBuildDescription(info({ builtAt: "" }), "en-US");
  assert.equal(text, "Release 0.1.0 · commit 8d7f610c91bf88def3a52b618f23b031a7204dcd");
  assert.doesNotMatch(text, /built/);
});

test("the badge links to the exact commit that produced this build", () => {
  assert.equal(buildCommitUrl(info()), "https://github.com/sgoxel/The_Advisor_Game/commit/8d7f610c91bf88def3a52b618f23b031a7204dcd");
});

test("a missing commit falls back to the commit list instead of a broken link", () => {
  assert.equal(buildCommitUrl(info({ fullSha: "local" })), "https://github.com/sgoxel/The_Advisor_Game/commits");
  assert.equal(buildCommitUrl(info({ fullSha: "unknown" })), "https://github.com/sgoxel/The_Advisor_Game/commits");
});

test("a trailing slash in the repository URL does not produce a double slash", () => {
  assert.equal(
    buildCommitUrl(info({ repoUrl: "https://github.com/sgoxel/The_Advisor_Game/" })),
    "https://github.com/sgoxel/The_Advisor_Game/commit/8d7f610c91bf88def3a52b618f23b031a7204dcd",
  );
});

test("outside a Vite build the info degrades to explicit dev markers", () => {
  // Tests run in plain Node, so the injected constants do not exist.
  const raw = readBuildInfo();
  assert.equal(raw.version, "dev");
  assert.equal(raw.shortSha, "local");
  assert.equal(formatBuildLabel(raw), "vdev · local");
});
