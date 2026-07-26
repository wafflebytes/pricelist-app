import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const BASE=process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
mkdirSync('.verify',{recursive:true});
let fails=0; const t=(l,ok,x='')=>{console.log(`  ${ok?'✓':'✗'} ${l}${x?' — '+x:''}`); if(!ok)fails++;};

const admin=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
{ const {data}=await admin.from('price_entries').select('id').in('voucher_no',['UX-1','UX-2']);
  for(const r of data??[]) await admin.from('price_entries').delete().eq('id',r.id); }

const b=await chromium.launch({channel:'chrome',headless:true});
const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(BASE+'/login',{waitUntil:'networkidle'});
await p.getByLabel('Email').fill(process.env.SEED_OWNER_EMAIL);
await p.getByLabel('Password').fill(process.env.SEED_OWNER_PASSWORD);
await p.getByRole('button',{name:'Sign in'}).click();
await p.waitForURL('**/products'); await p.waitForSelector('table tbody tr'); await p.waitForTimeout(1200);

console.log('── primary action ──');
const primary = p.locator('header button, [class*=layout-header] button').filter({hasText:'New price entry'});
t('"New price entry" is present', await primary.count()>0);
const addProd = p.locator('button').filter({hasText:'Add product'});
t('"Add product" is present as secondary', await addProd.count()>0);

console.log('\n── first-wheel scroll ──');
// Regression guard. Two separate causes made the first wheel over the table do
// nothing (the "I have to scroll twice" bug):
//   1. .astryx-table-scroll-wrapper was a vertical scroll container with
//      nothing to scroll, so Chrome latched the event to it.
//   2. A Tooltip per cell put 150+ fixed-position nodes in a 50-row table;
//      hovering in made Chrome drop the following wheel event.
// Positions outside the scrolling region (side nav, page header) legitimately
// do not scroll it, so they are not tested.
const sc = await p.evaluateHandle(()=>[...document.querySelectorAll('*')]
  .find(e=>e.scrollHeight>e.clientHeight+2 && /auto|scroll/.test(getComputedStyle(e).overflowY)));
const scrollTop = () => sc.evaluate(e=>e.scrollTop);

const tips = await p.evaluate(()=>document.querySelectorAll('.astryx-tooltip').length);
t('table does not carry a tooltip per cell', tips<=8, `${tips} tooltip nodes`);
const wrapperOverflow = await p.evaluate(()=>{
  const w=document.querySelector('.astryx-table-scroll-wrapper');
  const cs=getComputedStyle(w); return {y:cs.overflowY, x:cs.overflowX};
});
t('table wrapper is not a vertical scroller', wrapperOverflow.y==='visible', JSON.stringify(wrapperOverflow));

for (const [label,x,y] of [['without moving the pointer',null,null],['over the description',400,500],['over the product code',760,500],['over the price',980,500],['over the sparkline',1330,500]]) {
  await sc.evaluate(e=>{e.scrollTop=0}); await p.waitForTimeout(250);
  if (x) await p.mouse.move(x,y);
  const a=await scrollTop(); await p.mouse.wheel(0,300); await p.waitForTimeout(400);
  const c=await scrollTop();
  t(`first wheel scrolls ${label}`, c>a, `${a} → ${c}`);
}
await sc.evaluate(e=>{e.scrollTop=0});

console.log('\n── new price entry: fuzzy dropdown ──');
await p.locator('button').filter({hasText:'New price entry'}).first().click();
await p.waitForTimeout(700);
const dlg = p.locator('dialog[open]').first();
t('dialog opened', await dlg.count()>0);
const picker = dlg.getByLabel('Product');
await picker.click();
await p.waitForTimeout(500);
const onFocus = await p.locator('[role=option], [role=listbox] li').count();
t('shows recent products on focus', onFocus>0, `${onFocus} options`);
await picker.fill('dn296');
await p.waitForTimeout(600);
const opts = await p.locator('[role=option], [role=listbox] li').allTextContents();
t('fuzzy dropdown lists matches', opts.length>0, `${opts.length}: ${opts[0]?.slice(0,44)}`);
t('options carry last price context', /₹/.test(opts.join(' ')), (opts.join(' ').match(/₹[\d,]+/)||[])[0]);
await p.screenshot({path:'.verify/16-entry-dropdown.png'});

// select via keyboard — fast entry should not require the mouse
await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
await p.waitForTimeout(500);
const picked = await dlg.textContent();
t('selecting fills the product', /Last paid/.test(picked ?? ''), (picked??'').match(/Last paid [^·]{0,26}/)?.[0]);
t('no navigation happened', p.url().endsWith('/products'), p.url().split('/').pop());

await dlg.getByLabel('Unit price (₹)').fill('640');
await dlg.getByLabel('Quantity').fill('12');
await dlg.getByLabel('Voucher no.').fill('UX-1');
t('line amount previewed', /₹7,680/.test(await dlg.textContent() ?? ''));
await p.screenshot({path:'.verify/17-entry-filled.png'});

await dlg.getByRole('button',{name:'Save and add another'}).click();
await p.waitForTimeout(2500);
const after = await p.locator('dialog[open]').first().textContent();
t('save-and-add-another keeps the dialog open', await p.locator('dialog[open]').count()>0);
t('confirms the save', /Saved ₹640/.test(after ?? ''), (after??'').match(/Saved [^.]{0,30}/)?.[0]);
t('clears product and price for the next line', !/Last paid/.test(after ?? ''));
t('keeps the voucher number', (await p.locator('dialog[open]').first().getByLabel('Voucher no.').inputValue())==='UX-1');

console.log('\n── backdrop click closes ──');
await p.mouse.click(30, 30);
await p.waitForTimeout(700);
t('clicking outside closes the dialog', await p.locator('dialog[open]').count()===0);

console.log('\n── add-product suggestions ──');
await p.locator('button').filter({hasText:'Add product'}).first().click();
await p.waitForTimeout(700);
const pd = p.locator('dialog[open]').first();
await pd.getByLabel('Description').fill('rc370b led36s');
await p.waitForTimeout(700);
t('suggestions appear', /look similar|may already exist/.test(await pd.textContent() ?? ''));
const box = await pd.boundingBox();
const vh = p.viewportSize().height;
t('dialog does not overflow the viewport', box.height <= vh, `${Math.round(box.height)}px vs ${vh}px`);
const scrollable = await pd.evaluate(el=>{
  const list=[...el.querySelectorAll('*')].find(e=>{const cs=getComputedStyle(e);return cs.overflowY==='auto'&&e.scrollHeight>e.clientHeight});
  return list?{sh:list.scrollHeight,ch:list.clientHeight}:null;
});
t('suggestion list scrolls inside the dialog', scrollable!==null, scrollable?`${scrollable.sh}>${scrollable.ch}`:'not scrollable (may fit)');
await p.screenshot({path:'.verify/18-add-product-suggestions.png'});

// "Use this" must hand off, not navigate
const useThis = pd.getByRole('button',{name:'Use this'}).first();
t('offers "Use this" instead of navigating', await useThis.count()>0);
await useThis.click();
await p.waitForTimeout(900);
t('hands off to the price-entry dialog', /New price entry/.test(await p.locator('dialog[open]').first().textContent() ?? ''));
t('still on the products page', p.url().endsWith('/products'));

// cleanup
{ const {data}=await admin.from('price_entries').select('id').in('voucher_no',['UX-1','UX-2']);
  for(const r of data??[]) await admin.from('price_entries').delete().eq('id',r.id);
  t('test entries cleaned up', true, `${(data??[]).length} removed`); }

const real=errs.filter(e=>!/favicon|DevTools/i.test(e));
t('no page errors', real.length===0, real.slice(0,2).join(' | ')||'none');
await b.close();
console.log(`\n${fails===0?'✓ ALL ENTRY-UX CHECKS PASSED':`✗ ${fails} CHECK(S) FAILED`}`);
process.exit(fails===0?0:1);
