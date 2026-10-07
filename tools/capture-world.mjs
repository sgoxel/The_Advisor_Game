// Capture the built atlas. Start `npm run preview -- --port 4173` first.
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const url=process.argv[2]||'http://127.0.0.1:4173';
const directory='docs/evidence';await mkdir(directory,{recursive:true});
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const settle=()=>page.waitForFunction(()=>window.advisorWorld?.state.ready&&window.advisorWorld.state.settled,null,{timeout:90000});
  const shot=async name=>{await settle();await page.screenshot({path:`${directory}/${name}.png`});console.log(`Captured ${name}`);};
  await page.goto(url);await shot('village-desktop');
  await page.locator('#world').click({position:{x:840,y:470}});await shot('cell-desktop');await page.locator('#close-cell').click();
  await page.locator('#overview').click();await shot('realm-desktop');
  await page.locator('#grid').check();await shot('realm-tiles');await page.locator('#grid').uncheck();
  await page.locator('#home').click();await settle();await page.locator('#zoom-in').click();await page.locator('#zoom-in').click();await shot('street-desktop');
  await page.locator('#open-travel').click();await page.locator('#continent-select').selectOption('1');await page.locator('#visit-city').click();await shot('city-westreach');
  await page.setViewportSize({width:390,height:844});await page.goto(url);await shot('village-phone');
  await page.locator('#world').click({position:{x:275,y:485}});await shot('cell-phone');
  console.log('Final state',await page.evaluate(()=>window.advisorWorld.state));
}finally{await browser.close();}
