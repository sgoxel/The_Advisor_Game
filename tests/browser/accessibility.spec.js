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


test("S008 real touch-dispatched settlement inspection and accessible close", async ({ browser }) => {
  test.setTimeout(240000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
      window.__s008Touch = [];
      document.addEventListener("pointerdown", event => {
        if (event.pointerType === "touch")
          window.__s008Touch.push(event.target?.id || event.target?.closest?.("button")?.id || "");
      }, { capture: true });
    });
    await page.goto("http://127.0.0.1:4180/");
    await page.waitForFunction(() => window.advisorWorld?.state.ready);
    const regionToggle = page.locator("#toggle-region-panel");
    if (!(await page.locator("#open-travel").isVisible())) await regionToggle.tap();
    await page.locator("#open-travel").tap();
    await expect(page.locator("#travel-panel")).toBeVisible();
    const selectedId = await page.locator("#village-select").inputValue();
    const selectedName = await page.locator("#village-select option:checked").textContent();
    expect(selectedId).toBeTruthy();
    await page.locator("#inspect-village").tap();
    const popup = page.locator("#npc-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toHaveAttribute("data-canonical-id", selectedId);
    await expect(popup.locator("h2")).toHaveText(selectedName.trim());
    await page.locator("#npc-popup [data-close]").tap();
    await expect(popup).toBeHidden();
    const visibleOpener = await page.locator("#open-travel").isVisible() ? "#open-travel" : "#toggle-region-panel";
    await expect(page.locator(visibleOpener)).toBeFocused();
    expect(await page.evaluate(() => window.__s008Touch)).toEqual(
      expect.arrayContaining(["open-travel", "inspect-village"]),
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
