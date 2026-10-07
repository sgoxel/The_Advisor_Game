import { chromium } from "@playwright/test";
import webgpu from "../playwright.webgpu.config.js";
const url = process.argv[2] || "https://sgoxel.github.io/The_Advisor_Game/";
const browser = await chromium.launch(webgpu.use.launchOptions);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const response = await page.goto(url);
  if (response.status() !== 200) throw new Error(`Deployment returned ${response.status()}`);
  await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorWorld.state.settled, null, { timeout: 90000 });
  const result = await page.evaluate(() => ({ seed: window.advisorWorld.seed, state: window.advisorWorld.state, continents: window.advisorWorld.geography.continents.length, villages: window.advisorWorld.geography.villages.length }));
  if (errors.length || result.state.error || result.continents !== 3 || result.villages !== 270) throw new Error(JSON.stringify({ errors, result }));
  console.log(JSON.stringify({ url, errors, result }));
} finally { await browser.close(); }
