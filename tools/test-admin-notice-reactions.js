"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const {chromium}=require("../server/node_modules/playwright-core");
const {adminConsoleHtml}=require("../server/src/routes/adminPages");
const {CATALOG,DEFAULT_IDS}=require("../miniprogram/utils/noticeReactions");
const output=path.join(__dirname,"../.local/notice-reactions-acceptance");
async function run(){
  const executablePath=[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,process.env.CHROME_PATH,"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe","/usr/bin/google-chrome","/usr/bin/chromium","/usr/bin/chromium-browser"].find(value=>value&&fs.existsSync(value));
  assert(executablePath,"browser required");fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1080}}),errors=[],writes=[];
    page.on("pageerror",error=>errors.push(error.message));
    let notice={id:"test-notice",title:"祝大家国庆快乐！",content:"假期快乐，也记得好好休息。\n用一个表情，把你的好心情分享给大家吧。",type:"success",priority:"normal",displayMode:"ticker",targetPage:"home",enabled:true,closable:true,reactionsEnabled:true,reactionEmojis:DEFAULT_IDS,version:"v1",updatedAt:"2026-10-01T04:00:00Z",reactions:{enabled:true,total:42,items:[{...CATALOG[0],count:24},{...CATALOG[1],count:12},{...CATALOG[2],count:6}]}};
    await page.route("http://fosu.test/**",async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==="/admin/content-center")return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:adminConsoleHtml});
      if(url.pathname.startsWith("/api/admin/")){
        if(request.method()==="PUT"&&url.pathname==="/api/admin/notices/test-notice"){
          const payload=request.postDataJSON();writes.push({payload,version:request.headers()["if-match"]});notice={...notice,...payload,version:"v"+(writes.length+1)};
        }
        const response=url.pathname==="/api/admin/session"?{success:true,authenticated:true,csrfToken:"test"}:url.pathname==="/api/admin/notices"?{success:true,items:[notice]}:url.pathname==="/api/admin/content-center"?{success:true,data:{modules:{announcements:{enabled:true,version:"p1"}}}}:url.pathname==="/api/admin/daily-knowledge"?{success:true,data:{policy:{enabled:false},managed:[],builtin:[],counts:{},selected:null}}:{success:true,data:{}};
        return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(response)});
      }return route.fulfill({status:404,body:""});
    });
    await page.goto("http://fosu.test/admin/content-center");
    const card=page.locator("#contentCenterNoticeList article");await card.waitFor();
    assert((await card.innerText()).includes("42 人回应"));
    await card.getByRole("button",{name:"编辑",exact:true}).click();
    assert.strictEqual(await page.locator("#contentCenterReactionChoices button[aria-pressed=true]").count(),24);
    await page.locator("#contentCenterPhoneScreen .content-center-phone-ticker").click();
    await page.locator("#contentCenterPhoneScreen").getByRole("button",{name:"选择预览表情"}).click();
    assert.strictEqual(await page.locator("#contentCenterPhoneScreen .notice-preview-picker-grid button").count(),24);
    const gridGeometry=await page.locator("#contentCenterPhoneScreen .notice-preview-picker-grid").evaluate(grid=>{
      const rows=new Map(),width=grid.getBoundingClientRect().width;
      for(const button of grid.children){const r=button.getBoundingClientRect();if(Math.abs(r.width-width/6)>1)return null;const y=Math.round(r.y);rows.set(y,(rows.get(y)||0)+1);}return [...rows.values()];
    });assert.deepStrictEqual(gridGeometry,[6,6,6,6],"admin preview must match the mini program six-column layout");
    await page.waitForTimeout(250);
    await page.locator("#contentCenterPhoneScreen .notice-preview-detail").screenshot({path:path.join(output,"notice-detail-picker.png")});
    await page.screenshot({path:path.join(output,"admin-desktop.png"),fullPage:false});
    await page.locator("#contentCenterPhoneScreen .notice-preview-picker-grid").getByRole("button",{name:"喜欢",exact:true}).click();
    assert((await page.locator("#contentCenterPhoneScreen .notice-preview-reactions").innerText()).includes("43 人回应"));
    await page.locator("#contentCenterPhoneScreen").getByRole("button",{name:"选择预览表情"}).click();
    assert.strictEqual(await page.locator("#contentCenterPhoneScreen .notice-preview-picker-grid button[aria-pressed=true]").count(),1);
    await page.locator("#contentCenterPhoneScreen").getByRole("button",{name:"收起表情",exact:true}).click();
    assert.strictEqual(await page.locator("#contentCenterPhoneScreen .notice-preview-picker-grid").count(),0);
    await page.locator("#contentCenterPhoneScreen .notice-preview-chips .selected").click();
    assert((await page.locator("#contentCenterPhoneScreen .notice-preview-reactions").innerText()).includes("42 人回应"));assert.strictEqual(writes.length,0);
    await page.locator("#contentCenterReactionChoices").getByRole("button",{name:"节日快乐",exact:true}).click();
    await page.locator("#contentCenterNoticeSave").click();await page.waitForFunction(()=>document.getElementById("contentCenterNoticeSaveState").textContent==="已保存 · 已生效");
    assert.strictEqual(writes[0].payload.reactionEmojis.length,23);assert.strictEqual(writes[0].version,"v1");
    await card.getByRole("button",{name:"编辑",exact:true}).click();assert.strictEqual(await page.locator("#contentCenterReactionChoices button[aria-pressed=true]").count(),23);
    await page.locator("#contentCenterNoticeReactionsEnabled").selectOption("false");assert.strictEqual(await page.locator("#contentCenterReactionChoices button:disabled").count(),24);
    await page.locator("#contentCenterNoticeSave").click();await page.waitForFunction(()=>document.getElementById("contentCenterNoticeSaveState").textContent==="已保存 · 已生效");
    assert.strictEqual(writes[1].payload.reactionsEnabled,false);assert.strictEqual(writes[1].version,"v2");
    await card.getByRole("button",{name:"编辑",exact:true}).click();await page.locator("#contentCenterPhoneScreen .content-center-phone-ticker").click();assert.strictEqual(await page.locator("#contentCenterPhoneScreen .notice-preview-chips button").count(),3);
    for(const width of [740,375]){
      await page.setViewportSize({width,height:1000});
      await page.locator("#contentCenterNoticeContent").fill("国庆假期公告。".repeat(180));
      await page.locator("#contentCenterPhoneScreen .notice-preview-detail").scrollIntoViewIfNeeded();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"narrow screen must not overflow horizontally");
      await page.screenshot({path:path.join(output,"admin-"+width+".png")});
    }
    await page.setViewportSize({width:740,height:1080});await page.evaluate(()=>document.documentElement.setAttribute("data-resolved-theme","dark"));
    await page.screenshot({path:path.join(output,"admin-dark.png")});
    assert.deepStrictEqual(errors,[]);console.log("test-admin-notice-reactions passed (editor persistence, If-Match, preview select/withdraw, closed mode, 1600/740/375px, long text, dark theme, no page errors)");
  }finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
