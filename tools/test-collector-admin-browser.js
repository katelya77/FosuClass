"use strict";
const assert=require("assert/strict"),fs=require("fs"),path=require("path");
const {chromium}=require("../server/node_modules/playwright-core"),fixture=require("./test-helpers/collector-admin-harness");
async function main(){
 const h=await fixture.start();let browser;const output=path.resolve('.local/collector-admin-browser');fs.mkdirSync(output,{recursive:true});let checks=0;
 try {
  const executable=[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
  browser=await chromium.launch(executable?{executablePath:executable,headless:true}:{headless:true});
  const session=await h.login();
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
   h.collector.resetForTests();
   const context=await browser.newContext({viewport});await context.addCookies([{name:'fosu_admin_session',value:session.cookie.split('=')[1],url:h.baseUrl,httpOnly:true,sameSite:'Strict'}]);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.request().url().startsWith(h.baseUrl)?route.continue():route.abort());
   await page.goto(h.baseUrl+'/admin/schedule-collector');await page.locator('#scNotice').filter({hasText:'证据更新于'}).waitFor();
   assert.ok(await page.locator('#scHealth').innerText().then(t=>t.includes('未验证')));checks++;
   assert.ok((await page.locator('#scSources').innerText()).includes('未上报'));checks++;
   assert.equal(await page.locator('#scFullBtn').isVisible(),false);checks++;
   await page.locator('#scTerm').fill('2026-2027-1');await page.locator('#scSampleBtn').waitFor({state:'visible'});
   await page.waitForFunction(()=>!document.getElementById('scSampleBtn').disabled);
   page.on('dialog',d=>d.type()==='prompt'?d.accept('REVIEW SAMPLE'):d.accept());await page.locator('#scSampleBtn').click();
   await page.locator('#scRuns').filter({hasText:'sample / class'}).waitFor();assert.equal(h.collector.snapshot().current.mode,'sample');checks++;
   const task=h.collector.snapshot().current.id;await page.reload();await page.locator('#scNotice').filter({hasText:'证据更新于'}).waitFor();assert.equal(h.collector.snapshot().current.id,task);checks++;
   await page.locator('#scPauseBtn').click();await page.locator('#scReadiness').filter({hasText:'队列暂停'}).waitFor();assert.equal(h.collector.snapshot().enabled,false);checks++;
   await page.locator('#scResumeBtn').click();await page.locator('#scReadiness').filter({hasText:'队列准入开启'}).waitFor();checks++;
   const id=await fixture.seedSample(h);await page.locator('#scRefreshBtn').click();await page.locator('#scRuns').filter({hasText:id}).waitFor();
   await page.locator('#scRuns button').first().click();await page.locator('#scReviewFacts').filter({hasText:'规范化校验通过'}).waitFor();assert.ok((await page.locator('#scReview').textContent()).includes('NOT_EVALUATED_BOUNDED_TARGETS'));checks++;
   await page.locator('#scCompared').check();await page.locator('#scApproveReview').click();await page.locator('#scRuns').filter({hasText:'人工对照已确认'}).waitFor();assert.equal(h.collector.adminRun(id).sampleHumanReview.comparisonAttested,true);checks++;
   assert.equal(h.collector.adminRun(id).publishable,false);checks++;
   await page.screenshot({path:path.join(output,'collector-'+viewport.width+'.png'),fullPage:true});
   const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('#section-schedule-collector *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,id:e.id,class:e.className,right:e.getBoundingClientRect().right}))}));
   assert.ok(overflow.scroll<=viewport.width+1,JSON.stringify(overflow));checks++;
   await page.screenshot({path:path.join(output,'collector-'+viewport.width+'.png'),fullPage:true});
   await page.route('**/api/admin/schedule-collector/overview',route=>route.abort());await page.locator('#scRefreshBtn').click();await page.locator('#scNotice').filter({hasText:'证据加载失败'}).waitFor();assert.equal(await page.locator('#scSampleBtn').isDisabled(),true);checks++;
   assert.deepEqual(errors,[]);checks++;await context.close();
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'PASS',checks,viewports:[1440,390],backend:'actual Express admin + real fixture worker',schoolRequests:0,productionWrites:0},null,2));
  console.log('collector-admin-browser: '+checks+' checks PASS; actual full admin HTML and localhost API; schoolRequests=0; productionWrites=0');
 }finally{if(browser)await browser.close();await h.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
