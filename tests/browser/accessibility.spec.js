import { test, expect } from "@playwright/test";

const viewports = [[360,800],[390,844],[844,390],[768,1024],[1024,768],[1280,720],[1440,900]];
test("S008 canonical keyboard inspect and seven viewport hit areas", async ({ page }) => {
  test.setTimeout(480000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  expect(await page.locator("meta[name=viewport]").getAttribute("content")).toContain("viewport-fit=cover");
  for (const [width,height] of viewports) {
    await page.setViewportSize({width,height});
    if (!(await page.locator("#open-travel").isVisible())) await page.locator("#toggle-region-panel").click();
    if (await page.locator("#travel-panel").isHidden()) await page.locator("#open-travel").click();
    const faults = await page.evaluate(() => {
      const roots = document.querySelectorAll(".map-controls, .bottom-bar, #travel-panel, #region-panel");
      const targets = new Set();
      roots.forEach(root => root.querySelectorAll("button, select, summary").forEach(el => targets.add(el)));
      return [...targets].flatMap(el => {
        if (el.closest("[hidden]") || !el.getClientRects().length || getComputedStyle(el).visibility === "hidden") return [];
        el.scrollIntoView({block:"center",inline:"nearest"});
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        return r.width < 43.5 || r.height < 43.5 || !(hit === el || el.contains(hit))
          ? [`${el.id || el.textContent.trim().slice(0,22)} ${r.width.toFixed(1)}x${r.height.toFixed(1)} obstructed by ${hit?.id || hit?.tagName}`] : [];
      });
    });
    expect.soft(faults, `${width}x${height}`).toEqual([]);
    await page.locator("#close-travel").click();
  }
  await page.setViewportSize({width:390,height:844});
  if (!(await page.locator("#open-travel").isVisible())) await page.locator("#toggle-region-panel").click();
  await page.locator("#open-travel").focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("#travel-panel");
  await expect(panel).toBeVisible();
  const id = await page.locator("#village-select").inputValue();
  await page.locator("#inspect-village").focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
  const popup = page.locator("#npc-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute("data-canonical-id", id);
  await expect(page.locator("#npc-popup [data-close]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  const focusTarget = await page.evaluate(() => document.getElementById("open-travel").getClientRects().length ? "#open-travel" : "#toggle-region-panel");
  await expect(page.locator(focusTarget)).toBeFocused();
  expect(errors).toEqual([]);
});
