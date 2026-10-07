import {test,expect} from "@playwright/test";
test("missing WebGPU explains the failure without a compatibility option",async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,"gpu",{value:undefined,configurable:true}));
  await page.goto("/?renderer=webgl2");
  await expect(page.locator("#error")).toContainText("does not expose WebGPU");
  expect(await page.evaluate(()=>window.advisorRenderer.backend)).toBe("");
  expect(await page.evaluate(()=>window.advisorRenderer.requested)).toBe("webgpu");
  await expect(page.locator("#use-webgl2")).toHaveCount(0);
  await page.screenshot({path:"test-results/webgpu-unavailable.png"});
});
