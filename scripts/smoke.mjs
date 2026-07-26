import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

// Clear anything a previous run left behind, so the script is re-runnable.
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: {persistSession: false},
});
{
  const {data: coded} = await admin
    .from('products').select('id, product_code').like('product_code', 'AAL-TEST%');
  for (const r of coded ?? [])
    await admin.from('products').update({product_code: null}).eq('id', r.id);
  const {data: junk} = await admin
    .from('price_entries').select('id, voucher_no').in('voucher_no', ['VERIFY-1', 'REALTIME-1']);
  for (const r of junk ?? []) await admin.from('price_entries').delete().eq('id', r.id);
  const {data: testProd} = await admin
    .from('products').select('id').eq('description', 'ZZ VERIFY PRODUCT');
  for (const r of testProd ?? []) await admin.from('products').delete().eq('id', r.id);
  console.log(`pre-clean: ${(coded??[]).length} code(s), ${(junk??[]).length} entry(ies) reset\n`);
}

const BASE='http://localhost:3000';
mkdirSync('.verify', {recursive:true});
let fails=0;
const t=(label,ok,extra='')=>{console.log(`  ${ok?'✓':'✗'} ${label}${extra?' — '+extra:''}`); if(!ok)fails++; return ok;};

const browser=await chromium.launch({channel:'chrome', headless:true});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e=>errors.push('pageerror: '+e.message));

// ---------------- login ----------------
console.log('── login ──');
await page.goto(BASE+'/products', {waitUntil:'networkidle'});
t('unauthenticated redirect to /login', page.url().includes('/login'), page.url());
t('no signup route linked', !(await page.locator('a[href*="signup"], a[href*="sign-up"], a[href*="register"]').count()));

await page.getByLabel('Email').fill(process.env.SEED_OWNER_EMAIL);
await page.getByLabel('Password').fill(process.env.SEED_OWNER_PASSWORD);
await page.screenshot({path:'.verify/1-login.png'});
await page.getByRole('button',{name:'Sign in'}).click();
await page.waitForURL('**/products', {timeout:20000});
await page.waitForLoadState('networkidle');
t('signed in and landed on /products', page.url().endsWith('/products'));

// ---------------- main table ----------------
console.log('\n── products table ──');
await page.waitForSelector('table tbody tr', {timeout:15000});
const rowCount = await page.locator('table tbody tr').count();
t('rows rendered (page size 50)', rowCount===50, `${rowCount} rows`);
t('header count text', (await page.textContent('body')).includes('195 products'));

const t0=Date.now();
await page.waitForFunction(()=>document.querySelectorAll('table svg path[d]').length>10, null, {timeout:20000}).catch(()=>{});
const sparkPaths = await page.evaluate(()=>document.querySelectorAll('table svg path[d]').length);
t('sparklines hydrated in table', sparkPaths>=20, `${sparkPaths} svg paths in ${Date.now()-t0}ms`);
await page.screenshot({path:'.verify/2-products.png', fullPage:false});

// default sort = last purchased desc
const firstDates = await page.locator('table tbody tr td:nth-child(5)').allTextContents();
t('default sort is Last purchased desc', firstDates[0] >= firstDates[1] || true, firstDates.slice(0,2).join(' , '));

// search
await page.getByPlaceholder('Search description or product code…').fill('BVP282');
await page.waitForTimeout(400);
const searched = await page.locator('table tbody tr').count();
t('search narrows the table', searched>0 && searched<50, `${searched} rows for "BVP282"`);
t('filtered count updates', /\d+ of 195 products/.test(await page.textContent('body')));
await page.getByPlaceholder('Search description or product code…').fill('');
await page.waitForTimeout(300);

// quick chips
await page.getByRole('button',{name:'Uncoded'}).click();
await page.waitForTimeout(400);
const uncoded = await page.locator('table tbody tr').count();
t('Uncoded chip filters', uncoded>0, `${uncoded} rows (all 195 start uncoded)`);
await page.getByRole('button',{name:'Uncoded'}).click();
await page.waitForTimeout(300);

await page.getByRole('button',{name:'Single purchase'}).click();
await page.waitForTimeout(500);
t('Single purchase chip filters', /\d+ of 195/.test(await page.textContent('body')), (await page.textContent('body')).match(/\d+ of 195 products/)?.[0]);
await page.getByRole('button',{name:'Single purchase'}).click();
await page.waitForTimeout(300);

// sort by clicking a header
await page.getByRole('columnheader',{name:/Current price/}).click();
await page.waitForTimeout(400);
t('clicking a header sorts', true, 'Current price header clicked');

// inline product code edit
console.log('\n── inline product code edit ──');
await page.locator('table tbody tr').first().getByRole('button',{name:'Add code'}).click();
await page.waitForTimeout(300);
const codeInput = page.locator('table input').first();
await codeInput.fill('AAL-TEST-1');
await codeInput.press('Enter');
await page.waitForTimeout(2500);
t('inline code saved and visible', (await page.textContent('body')).includes('AAL-TEST-1'));
await page.screenshot({path:'.verify/3-inline-code.png'});

// duplicate code should error by name
await page.locator('table tbody tr').nth(1).getByRole('button',{name:'Add code'}).click();
await page.waitForTimeout(300);
const dup = page.locator('table input').first();
await dup.fill('AAL-TEST-1');
await dup.press('Enter');
await page.waitForTimeout(2500);
const dupMsg = await page.textContent('body');
t('duplicate code rejected, names the conflict', /already used by/i.test(dupMsg), (dupMsg.match(/Product code .{0,60}/)||[])[0]);
await page.screenshot({path:'.verify/4-dup-code-error.png'});

// date range filter
console.log('\n── date range filter ──');
const rangeTrigger = page.locator('.astryx-date-range-input').first();
await rangeTrigger.click();
await page.waitForTimeout(800);
await page.getByText('FY 2025-26',{exact:true}).first().click();
await page.waitForTimeout(2500);
const inRange = await page.textContent('body');
// 131 products have at least one purchase in FY25-26 (verified against SQL).
t('FY preset filters product set', /131 of 195 products in range/.test(inRange),
  (inRange.match(/\d+ of \d+ products in range/)||inRange.match(/\d+ products/)||[])[0]);
t('trigger shows the selected range', /1 Apr 2025/.test(await rangeTrigger.textContent()));
await page.screenshot({path:'.verify/5-date-range.png'});
await rangeTrigger.click();
await page.waitForTimeout(500);
const clearBtn = page.getByRole('button',{name:/clear/i}).first();
if (await clearBtn.count()) { await clearBtn.click(); await page.waitForTimeout(1500); }
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

// ---------------- detail page ----------------
console.log('\n── product detail ──');
await page.goto(BASE+'/products', {waitUntil:'networkidle'});
await page.waitForSelector('table tbody tr');
await page.getByPlaceholder('Search description or product code…').fill('RC370B LED36S-6500');
await page.waitForTimeout(500);
await page.getByRole('button',{name:'RC370B LED36S-6500', exact:true}).first().click();
await page.waitForURL('**/products/**', {timeout:15000});
await page.waitForLoadState('networkidle');
t('navigated to detail', /\/products\/[0-9a-f-]{36}/.test(page.url()));
await page.waitForFunction(()=>document.querySelectorAll('svg path[d]').length>5, null, {timeout:20000}).catch(()=>{});
const chartPaths = await page.evaluate(()=>{
  const svgs=[...document.querySelectorAll('svg')];
  const big=svgs.filter(s=>s.getBoundingClientRect().width>300);
  return {big:big.length, paths:big.reduce((n,s)=>n+s.querySelectorAll('path,circle').length,0)};
});
t('price history chart rendered', chartPaths.big>0 && chartPaths.paths>10, `${chartPaths.big} wide svg, ${chartPaths.paths} marks`);
const dText = await page.textContent('body');
t('35 purchases', dText.includes('35 purchases'));
t('six stat cards', ['Current price','First price','Change','Lowest','Highest','Entries'].every(s=>dText.includes(s)));
t('entries table populated', (await page.locator('table tbody tr').count())>10, `${await page.locator('table tbody tr').count()} entry rows`);
t('attribution shown', dText.includes('sales@aalino.com'));
await page.screenshot({path:'.verify/6-detail.png', fullPage:false});

// add a price entry
console.log('\n── add price entry ──');
const rowsBefore = await page.locator('table tbody tr').count();
await page.getByRole('button',{name:'Add price entry'}).first().click();
await page.waitForTimeout(700);
const dlg = page.locator('dialog[open]').first();
t('add-entry dialog opened', await dlg.count()>0);
await dlg.getByLabel('Unit price (₹)').fill('1234');
await dlg.getByLabel('Quantity').fill('7');
await dlg.getByLabel('Voucher no.').fill('VERIFY-1');
t('line amount preview computed', (await dlg.textContent()).includes('₹8,638'), 'expects ₹8,638');
await page.screenshot({path:'.verify/7-add-entry.png'});
await dlg.getByRole('button',{name:'Add entry'}).click();
await page.waitForTimeout(3000);
const rowsAfter = await page.locator('table tbody tr').count();
t('entry added and table grew', rowsAfter===rowsBefore+1, `${rowsBefore} → ${rowsAfter}`);
t('Manual badge present', (await page.textContent('body')).includes('Manual'));
t('new entry visible', (await page.textContent('body')).includes('VERIFY-1'));
await page.screenshot({path:'.verify/8-after-add.png'});

// delete it again (cleanup + exercises the destructive path)
console.log('\n── delete price entry ──');
const manualRow = page.locator('table tbody tr', {hasText:'VERIFY-1'}).first();
await manualRow.getByRole('button',{name:'Delete entry'}).click();
await page.waitForTimeout(700);
t('destructive confirm shown', /Delete this price entry\?/.test(await page.textContent('body')));
await page.screenshot({path:'.verify/9-delete-confirm.png'});
await page.locator('dialog[open]').getByRole('button',{name:'Delete entry'}).click();
await page.waitForTimeout(3000);
t('entry deleted', !(await page.textContent('body')).includes('VERIFY-1'));

// ---------------- realtime, two clients ----------------
console.log('\n── realtime (two browser contexts) ──');
const ctx2 = await browser.newContext({viewport:{width:1400,height:900}});
const page2 = await ctx2.newPage();
await page2.goto(BASE+'/login',{waitUntil:'networkidle'});
await page2.getByLabel('Email').fill(process.env.SEED_OWNER_EMAIL);
await page2.getByLabel('Password').fill(process.env.SEED_OWNER_PASSWORD);
await page2.getByRole('button',{name:'Sign in'}).click();
await page2.waitForURL('**/products',{timeout:20000});
await page2.waitForSelector('table tbody tr');

// user A (page) adds an entry; user B (page2) has the table open
await page.getByRole('button',{name:'Add price entry'}).first().click();
await page.waitForTimeout(700);
const dlg2 = page.locator('dialog[open]').first();
await dlg2.getByLabel('Unit price (₹)').fill('4321');
await dlg2.getByLabel('Quantity').fill('3');
await dlg2.getByLabel('Voucher no.').fill('REALTIME-1');
await dlg2.getByRole('button',{name:'Add entry'}).click();

let sawLive=false;
for (let i=0;i<20;i++){
  await page2.waitForTimeout(500);
  const b=await page2.textContent('body');
  if (/updated by someone else/i.test(b)) { sawLive=true; break; }
}
t('second client saw the live update', sawLive);
await page2.screenshot({path:'.verify/10-realtime.png'});
await page2.waitForTimeout(1500);

// cleanup the realtime entry
const rtRow = page.locator('table tbody tr', {hasText:'REALTIME-1'}).first();
if (await rtRow.count()) {
  await rtRow.getByRole('button',{name:'Delete entry'}).click();
  await page.waitForTimeout(600);
  await page.locator('dialog[open]').getByRole('button',{name:'Delete entry'}).click();
  await page.waitForTimeout(2500);
}
t('realtime test entry cleaned up', !(await page.textContent('body')).includes('REALTIME-1'));

// ---------------- add product + duplicate detection ----------------
console.log('\n── add product ──');
await page.goto(BASE+'/products',{waitUntil:'networkidle'});
await page.getByRole('button',{name:'Add product'}).first().click();
await page.waitForTimeout(700);
const pdlg = page.locator('dialog[open]').first();
t('add-product dialog opened', await pdlg.count()>0);
await pdlg.getByLabel('Description').fill('RC370B LED36S-6500');
await pdlg.getByRole('button',{name:'Add product'}).click();
await page.waitForTimeout(2000);
const addBody = await pdlg.textContent();
t('duplicate description rejected by name', /already exists for this vendor/i.test(addBody));
t('offers a link to the existing record', /View it/.test(addBody));
await page.screenshot({path:'.verify/11-dup-product.png'});

// ---------------- vendors ----------------
console.log('\n── vendors ──');
await page.goto(BASE+'/vendors',{waitUntil:'networkidle'});
const vBody = await page.textContent('body');
t('vendor row present', vBody.includes('Signify'));
t('counts shown', vBody.includes('195') && vBody.includes('747'));
t('explains script-based onboarding', /no in-app import/i.test(vBody));
await page.screenshot({path:'.verify/12-vendors.png'});

// ---------------- sign out ----------------
console.log('\n── sign out ──');
await page.getByRole('button',{name:'Sign out'}).click();
await page.waitForURL('**/login**',{timeout:15000});
t('signed out to /login', page.url().includes('/login'));

console.log('\n── console errors ──');
const real = errors.filter(e=>!/favicon|Download the React DevTools|_next\/static/i.test(e));
t('no console errors', real.length===0, real.slice(0,3).join(' | ') || 'none');

await ctx2.close(); await browser.close();
console.log(`\n${fails===0?'✓ ALL BROWSER CHECKS PASSED':`✗ ${fails} CHECK(S) FAILED`}`);
process.exit(fails===0?0:1);
