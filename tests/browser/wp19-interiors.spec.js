import { test, expect } from "@playwright/test";

async function selectRole(page, role) {
  return page.evaluate(async (wantedRole) => {
    const geography = await import("/src/geography.ts"),
      settlements = await import("/src/settlement-layout.ts"),
      village = geography.villages[0],
      layout = settlements.settlementLayout(village),
      building = layout.buildings.find((candidate) => candidate.role === wantedRole);
    if (!building) return false;
    window.dispatchEvent(new CustomEvent("advisor:building-selected", { detail: { building } }));
    return true;
  }, role);
}

async function traverseAllRooms(page) {
  let state = await page.evaluate(() => window.advisorInteriors.state),
    visited = new Set([state.currentRoom]);
  for (let step = 0; step < state.active.rooms.length * 2 && visited.size < state.active.rooms.length; step++) {
    const next = state.availableConnections.find((connection) => !visited.has(connection.target));
    expect(next, `no unvisited canonical doorway from ${state.currentRoom}`).toBeTruthy();
    expect(await page.evaluate((code) => window.advisorInteriors.moveThrough(code), next.code)).toBe(true);
    state = await page.evaluate(() => window.advisorInteriors.state);
    visited.add(state.currentRoom);
  }
  expect(visited.size).toBe(state.active.rooms.length);
}

test("WP19 protagonist-demand interiors use, evict and reconstruct canonically", async ({ page }) => {
  test.setTimeout(240000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorInteriors?.state);

  const initial = await page.evaluate(() => window.advisorInteriors.state);
  expect(initial.active).toBeNull();
  expect(initial.cache.active).toBe(0);
  expect(initial.cache.materializations).toBe(0);

  expect(await selectRole(page, "home")).toBe(true);
  let selected = await page.evaluate(() => window.advisorInteriors.state);
  expect(selected.active).toBeNull();
  expect(selected.cache.active).toBe(0);
  await page.locator("#enter-building").click();
  await expect(page.locator("#interior-panel")).toBeVisible();
  let entered = await page.evaluate(() => window.advisorInteriors.state);
  expect(entered.active.role).toBe("home");
  expect(entered.cache.active).toBe(1);
  expect(entered.cache.materializations).toBe(1);
  const signature = entered.active.signature;
  await traverseAllRooms(page);
  expect(await page.evaluate(() => window.advisorInteriors.useAnchor())).toBe(true);
  expect((await page.evaluate(() => window.advisorInteriors.state)).lastAction).toMatch(/^Used /);

  await page.locator("#exit-interior").click();
  let exited = await page.evaluate(() => window.advisorInteriors.state);
  expect(exited.active).toBeNull();
  expect(exited.cache.active).toBe(0);
  expect(exited.cache.evictions).toBe(1);

  await page.locator("#enter-building").click();
  entered = await page.evaluate(() => window.advisorInteriors.state);
  expect(entered.active.signature).toBe(signature);
  expect(entered.reconstructed).toBe(true);
  await page.locator("#exit-interior").click();

  expect(await selectRole(page, "blacksmith")).toBe(true);
  await page.locator("#enter-building").click();
  const smith = await page.evaluate(() => window.advisorInteriors.state);
  expect(smith.active.role).toBe("blacksmith");
  expect(smith.active.signature).not.toBe(signature);
  await traverseAllRooms(page);
  expect(await page.evaluate(() => window.advisorInteriors.useAnchor())).toBe(true);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const box = await page.locator("#interior-panel").boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    for (const selector of ["#exit-interior", "#interior-use", "#interior-north", "#interior-west", "#interior-south", "#interior-east"]) {
      const control = await page.locator(selector).boundingBox();
      expect(control, `${selector} must be visible`).not.toBeNull();
      expect(control.width, `${selector} width`).toBeGreaterThanOrEqual(44);
      expect(control.height, `${selector} height`).toBeGreaterThanOrEqual(44);
    }
  }
  await page.locator("#exit-interior").click();
  expect(errors).toEqual([]);
});
