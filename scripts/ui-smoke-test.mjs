import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=resolve('.');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!path.startsWith(root+'/'))throw Error();const body=await readFile(path);res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':'text/html');res.end(body)}catch{res.statusCode=404;res.end('Not found')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.RELAY_CHROMIUM?{executablePath:process.env.RELAY_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}: {})});
let passed=0;
async function fresh(file='index.html',width=1280,setup){
 const context=await browser.newContext({viewport:{width,height:900}});
 await context.route('https://**/*',route=>route.fulfill({status:403,contentType:'application/json',body:'{"error":"Unauthorised test response"}'}));
 if(setup)await context.addInitScript(setup);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/'+file+(file.includes('?')?'&':'?')+'demo=1'); /* fictional demo flows are only reachable with ?demo=1 */ await page.getByRole('heading',{name:"Everything you've bought, in one place."}).waitFor();
 return {context,page,errors};
}
async function sample(page){await page.getByRole('button',{name:'Try a sample purchase →'}).click();await page.locator('[data-purchase]').first().click();await page.getByRole('heading',{name:'Your purchase',exact:true}).waitFor()}
async function replacement(page){await page.getByRole('button',{name:'Exchange or discover alternatives →'}).click();await page.getByRole('button',{name:/Find available replacements/}).click();await page.locator('[data-select="DEMO-NORTH-003"]').click();await page.locator('#placeSelected').waitFor()}
async function log(page){return page.evaluate(()=>JSON.parse(localStorage.getItem('relay-demo-orders-v1')||'[]'))}
async function check(name,fn){await fn();passed++;console.log('PASS',name)}
try{
 for(const file of ['index.html','relay-app-v2.html'])for(const width of [1280,390]){
  await check(`${file} ${width}px: empty wallet, refund eligibility, duplicate prevention, five tabs and identity separation`,async()=>{
   const {context,page,errors}=await fresh(file,width);
   assert.equal(await page.locator('[data-purchase]').count(),0);
   await sample(page);
   assert.match(await page.locator('.offer').innerText(),/INSTANT REFUND.*PLUS CONCEPT/s);
   assert.match(await page.locator('.offer').innerText(),/£129.99/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Horizontal overflow');
   if(process.env.RELAY_SCREENSHOTS){await mkdir(process.env.RELAY_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.RELAY_SCREENSHOTS}/purchase-${width}.png`,fullPage:true})}
   await page.getByRole('button',{name:'Review simulated refund →'}).click();
   await page.locator('#simulateRefundButton').click();await page.locator('#refundResult .error').waitFor();assert.match(await page.locator('#refundResult').innerText(),/Choose a return reason/);assert.equal((await log(page)).length,0);
   await page.getByLabel('Why are you returning it?').selectOption('Wrong size');await page.locator('#refundEligible').check();await page.locator('#simulateRefundButton').click();await page.getByText('✓ Refund advance simulated',{exact:true}).waitFor();
   assert.match(await page.locator('#refundResult').innerText(),/Refund advance simulated/);assert.match(await page.locator('#refundResult').innerText(),/Do not post anything/);
   await page.evaluate(()=>simulateDemoRefund());assert.equal((await log(page)).length,1);
   const nav=page.locator(width<760?'#foot':'#side');
   for(const [tab,title] of [['Discover','Find something better.'],['Radar','Your deals, discovered.'],['Wrapped','Your year in purchases.'],['Profile','Your Relay profile'],['Wallet',"Everything you've bought, in one place."]]){await nav.getByRole('button',{name:new RegExp(tab)}).click();await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,tab+' overflow')}
   await nav.getByRole('button',{name:/Profile/}).click();assert.match(await page.locator('#view').innerText(),/REFUND/);
   await page.locator('#demoShopper').selectOption('Ben');assert.equal(await page.locator('[data-purchase]').count(),0);
   await page.locator('#modeToggle').click();assert.doesNotMatch(await page.locator('#view').innerText(),/403|API returned/);
   assert.deepEqual(errors,[]);await context.close();
  });
  await check(`${file} ${width}px: complete Free exchange and linked wallet`,async()=>{
   const {context,page,errors}=await fresh(file,width);await sample(page);await replacement(page);
   await page.locator('#placeSelected').click();await page.getByRole('heading',{name:'✓ Coordinated exchange simulated'}).waitFor();
   let records=await log(page);assert.equal(records.length,1);assert.equal(records[0].replacementStatus,'PENDING_RETURN_RECEIPT');assert.notEqual(records[0].replacementRequestId,records[0].returnRequestId);
   await page.evaluate(()=>placeDemoOrder('DEMO-NORTH-003',true));assert.equal((await log(page)).length,1);
   // Re-open recorded request because deliberate duplicate attempt replaced the receipt with an error.
   await page.evaluate(id=>advanceDemoExchangeReturn(id),records[0].id);
   for(let i=0;i<2;i++)await page.locator('#progressReturn').click();
   records=await log(page);assert.equal(records[0].returnStatus,'RETURN_RECEIVED');assert.equal(records[0].replacementStatus,'ORDER_CREATED');
   await page.locator('#viewWalletExchange').click();assert.equal(await page.locator('[data-purchase]').count(),2);assert.match(await page.locator('#view').innerText(),/Exchanged/);
   await page.locator('[data-purchase]').first().click();assert.match(await page.locator('#view').innerText(),/Linked exchange/);
   if(process.env.RELAY_SCREENSHOTS)await page.screenshot({path:`${process.env.RELAY_SCREENSHOTS}/exchange-${width}.png`,fullPage:true});
   await page.reload();assert.equal(await page.locator('[data-purchase]').count(),2);assert.deepEqual(errors,[]);await context.close();
  });
 }
 await check('Plus exchange creates the simulated return and replacement immediately',async()=>{const {context,page}=await fresh();await sample(page);await page.evaluate(()=>setPlanPreview('plus'));await replacement(page);await page.locator('#placeSelected').click();await page.getByRole('heading',{name:'✓ Coordinated exchange simulated'}).waitFor();const r=(await log(page))[0];assert.equal(r.returnStatus,'RETURN_REQUESTED');assert.equal(r.replacementStatus,'ORDER_CREATED');await context.close()});
 await check('Stock changes before submission block an exchange',async()=>{const {context,page}=await fresh();await sample(page);await replacement(page);await page.evaluate(()=>localStorage.setItem('relay-retailer-inventory-v3',JSON.stringify({'DEMO-NORTH-003':{quantity:0}})));await page.locator('#placeSelected').click();await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/out of stock/i);assert.equal((await log(page)).length,0);await context.close()});
 await check('Storage failure rolls back the exchange record and stock',async()=>{const {context,page}=await fresh();await sample(page);await replacement(page);await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='relay-retailer-inventory-v3')throw new DOMException('Quota exceeded','QuotaExceededError');return set.call(this,k,v)}});await page.locator('#placeSelected').click();await page.getByRole('alert').waitFor();assert.equal((await log(page)).length,0);assert.equal(await page.evaluate(()=>localStorage.getItem('relay-retailer-inventory-v3')),null);assert.equal(await page.getByRole('heading',{name:'✓ Coordinated exchange simulated'}).count(),0);await context.close()});
 await check('Two tabs cannot reserve stock or exchange the same purchase twice',async()=>{const {context,page}=await fresh();await sample(page);await replacement(page);const other=await context.newPage();await other.goto(origin+'/index.html?demo=1');await other.locator('[data-purchase]').first().click();await replacement(other);await Promise.all([page.evaluate(()=>placeDemoOrder('DEMO-NORTH-003',true)),other.evaluate(()=>placeDemoOrder('DEMO-NORTH-003',true))]);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('relay-demo-orders-v1')||'[]').length===1);await other.waitForTimeout(100);assert.equal((await log(page)).length,1);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('relay-retailer-inventory-v3'))['DEMO-NORTH-003'].quantity),11);await context.close()});
 await check('Unavailable network and malformed optional storage do not blank the app',async()=>{const {context,page,errors}=await fresh('index.html',390,()=>{localStorage.setItem('relay-retailer-inventory-v3','{broken');localStorage.setItem('relay-demo-orders-v1','{broken');localStorage.setItem('relay-radar-v2','{broken')});await sample(page);assert.deepEqual(errors,[]);await context.close()});
 await check('Real shoppers never land in demo mode',async()=>{const {context}=await fresh();const page=await context.newPage();await page.goto(origin+'/index.html');await page.getByRole('heading',{name:"Everything you've bought, in one place."}).waitFor();const t=await page.locator('#view').innerText();assert.doesNotMatch(t,/Demo wallet|FICTIONAL DEMO|Try a sample purchase/);assert.equal(await page.locator('#modeToggle').isVisible(),false);await page.reload();await page.getByRole('heading',{name:"Everything you've bought, in one place."}).waitFor();assert.doesNotMatch(await page.locator('#view').innerText(),/Demo wallet/);await context.close()});
 console.log(`${passed} browser scenarios passed. Remote APIs were deliberately denied; no live integration or money movement was tested.`);
}finally{await browser.close();await new Promise(r=>server.close(r))}
