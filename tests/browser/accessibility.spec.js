import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const sizes = [
  [360, 800],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [1280, 720],
  [1440, 900],
];

const outDir = "test-results/accessibility";

test("touch targets, text size, viewport meta and keyboard panel focus", async ({ page }) => {
  test.setTimeout(600000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);

  const viewport = await page.evaluate(
    () => document.querySelector("meta[name=viewport]")?.content ?? "",
  );
  expect(viewport).toContain("viewport-fit=cover");

  fs.mkdirSync(outDir, { recursive: true });
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    // The travel button lives inside #region-panel, which starts minimized.
    if (!(await page.locator("#open-travel").isVisible()))
      await page.click("#toggle-region-panel", { timeout: 15000 });
    const travelPanel = page.locator("#travel-panel");
    if (await travelPanel.isHidden()) await page.click("#open-travel", { timeout: 15000 });
    const audit = await page.evaluate(() => {
      const label = (el) => {
        const text = (el.textContent || "").trim().slice(0, 30);
        return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}${text ? ` "${text}"` : ""}`;
      };
      const visible = (el) =>
        el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
      const targets = new Set();
      for (const root of document.querySelectorAll(
        ".map-controls, .bottom-bar, .masthead, #travel-panel, #region-panel",
      ))
        root.querySelectorAll("button, select, summary, [role=button]").forEach((el) => targets.add(el));
      const measured = [];
      const failures = [];
      for (const el of targets) {
        if (!visible(el) || el.closest("[hidden]")) continue;
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const rect = `[${r.left.toFixed(1)},${r.top.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}]`;
        measured.push(`${label(el)} ${rect}`);
        if (r.width < 43.5 || r.height < 43.5)
          failures.push(`${r.width.toFixed(1)}x${r.height.toFixed(1)} ${label(el)} ${rect}`);
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === el || el.contains(hit)))
          failures.push(`obscured ${label(el)} ${rect} by ${hit ? label(hit) : "nothing"}`);
      }
      const fontSizes = [];
      const textRoots = document.querySelectorAll("#travel-panel, #travel-panel *, .bottom-bar, .bottom-bar *");
      for (const el of textRoots) {
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        if (!hasText || !visible(el) || el.closest("[hidden]")) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        fontSizes.push(`${px}px ${label(el)}`);
        if (px < 11) failures.push(`font ${px}px ${label(el)}`);
      }
      return { measured, fontSizes, failures };
    });
    const record = { viewport: `${width}x${height}`, ...audit, failures: audit.failures };
    fs.writeFileSync(path.join(outDir, `${width}x${height}.json`), JSON.stringify(record, null, 2));
    expect.soft(audit.failures, `${width}x${height}`).toEqual([]);
    await page.click("#close-travel");
    await expect(travelPanel).toBeHidden();
  }

  // Keyboard-only flow at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  if (!(await page.locator("#open-travel").isVisible()))
    await page.click("#toggle-region-panel", { timeout: 15000 });
  const panel = page.locator("#travel-panel");
  const activeId = () => page.evaluate(() => document.activeElement?.id ?? "");
  const activeInPanel = () =>
    page.evaluate(() => !!document.activeElement?.closest("#travel-panel"));

  await page.locator("#open-travel").focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  expect(await activeInPanel()).toBe(true);

  let reached = false;
  for (let i = 0; i < 15 && !reached; i++) {
    if ((await activeId()) === "visit-village") reached = true;
    else await page.keyboard.press("Tab");
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  expect(await activeId()).toBe("open-travel");

  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  expect(await activeId()).toBe("open-travel");

  // The semantic selector invokes the same SEED-owned settlement card as a
  // decorative map label. The popup is a read-only inspection, not travel.
  await page.locator("#open-travel").focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  const selectedVillageId = await page.locator("#village-select").inputValue();
  await page.locator("#inspect-village").focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  const popup = page.locator("#npc-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute("data-canonical-id", selectedVillageId);
  await expect(page.locator("#npc-popup [data-close]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(page.locator("#open-travel")).toBeFocused();

  expect(errors).toEqual([]);
});
