import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
const BASE=process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
mkdirSync('.verify/responsive',{recursive:true});
let fails=0;
const t=(l,ok,x='')=>{console.log(`  ${ok?'✓':'✗'} ${l}${x?' — '+x:''}`); if(!ok)fails++;};

const VIEWPORTS=[
  {name:'mobile-390',  w:390,  h:844},
  {name:'tablet-834',  w:834,  h:1112},
  {name:'laptop-1280', w:1280, h:800},
  {name:'desk-1600',   w:1600, h:1000},
];

const b=await chromium.launch({channel:'chrome',headless:true});

for (const v of VIEWPORTS) {
  console.log(`\n══ ${v.name} (${v.w}×${v.h}) ══`);
  const ctx=await b.newContext({viewport:{width:v.w,height:v.h}, deviceScaleFactor:2});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});

  await p.goto(BASE+'/login',{waitUntil:'networkidle'});
  await p.getByLabel('Email').fill(process.env.SEED_OWNER_EMAIL);
  await p.getByLabel('Password').fill(process.env.SEED_OWNER_PASSWORD);
  await p.screenshot({path:`.verify/responsive/${v.name}-0-login.png`});
  await p.getByRole('button',{name:'Sign in'}).click();
  await p.waitForURL('**/products',{timeout:25000});
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(1200);

  // ---- no horizontal page overflow, anywhere ----
  const overflow = await p.evaluate(()=>({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    bodyW: document.body.scrollWidth,
  }));
  t('no horizontal page overflow', overflow.docW <= overflow.winW+1,
    `doc ${overflow.docW} vs win ${overflow.winW}`);

  // Documented contract: table at >=1024px, rows below.
  const wantsTable = v.w >= 1024;
  const isTable = await p.locator('table').count() > 0;
  t(wantsTable ? 'table layout used' : 'row layout used (no table)',
    wantsTable ? isTable : !isTable, isTable?'table':'rows');

  if (isTable) {
    // ---- description must be truncated, never *painted* over the next cell ----
    // A descendant's bounding rect legitimately extends past its cell when an
    // ancestor clips it (overflow:hidden), so only content with no clipping
    // ancestor between it and the cell counts as a real overlap.
    const collide = await p.evaluate(()=>{
      const clips = el => {
        const cs = getComputedStyle(el);
        return cs.overflowX === 'hidden' || cs.overflowX === 'clip' ||
               cs.overflowX === 'auto'   || cs.overflowX === 'scroll';
      };
      let worst=null;
      for (const r of [...document.querySelectorAll('table tbody tr')].slice(0,25)) {
        const tds=[...r.querySelectorAll('td')];
        for (let i=0;i<tds.length-1;i++){
          const cell=tds[i], cellRect=cell.getBoundingClientRect();
          for (const e of cell.querySelectorAll('*')) {
            const b=e.getBoundingClientRect();
            if (b.width<=0) continue;
            const spill=b.right-cellRect.right;
            if (spill<=2) continue;
            let clipped=false;
            for (let a=e.parentElement; a && a!==cell.parentElement; a=a.parentElement) {
              if (clips(a)) {clipped=true; break;}
            }
            if (!clipped && (!worst||spill>worst.spill))
              worst={col:i, spill:Math.round(spill), text:(e.textContent||'').slice(0,24)};
          }
        }
      }
      return worst;
    });
    t('no cell content painted over the next column', collide===null,
      collide?`col ${collide.col} spills ${collide.spill}px ("${collide.text}")`:'clean');

    // The clamp must be in force. Asserting that clamping is *currently
    // happening* would be brittle: given two lines, every Signify description
    // happens to fit at these widths — which is the desired outcome, not a
    // failure. What matters is that an over-long one would be contained.
    const clamp = await p.evaluate(()=>{
      const a=document.querySelector('table tbody tr td:first-child a');
      if (!a) return null;
      const cs=getComputedStyle(a);
      return {lines:cs.webkitLineClamp, overflow:cs.overflow};
    });
    t('description cell clamps to 2 lines',
      clamp?.lines==='2' && clamp.overflow==='hidden', JSON.stringify(clamp));

    const cols = await p.locator('table thead th').allTextContents();
    t('column set matches width', v.w>=1200
        ? cols.some(c=>/Entries/.test(c))
        : !cols.some(c=>/Entries/.test(c)),
      cols.map(c=>c.replace(/\s+/g,' ').trim()).join(' | '));

    // ---- table must not need horizontal scrolling ----
    const hscroll = await p.evaluate(()=>{
      const w=document.querySelector('table')?.closest('[class*=scroll-wrapper]') ?? document.querySelector('table')?.parentElement;
      return w ? {sw:w.scrollWidth, cw:w.clientWidth} : null;
    });
    if (hscroll) t('table fits without horizontal scroll', hscroll.sw<=hscroll.cw+2, `${hscroll.sw} vs ${hscroll.cw}`);
  } else {
    const rows = await p.locator('ul li, ol li').count();
    t('rows rendered', rows>0, `${rows} rows`);
    // description must wrap/clamp, not overflow
    const spill = await p.evaluate(()=>{
      const items=[...document.querySelectorAll('li')].slice(0,15);
      let worst=0;
      for(const li of items){
        const r=li.getBoundingClientRect();
        for(const e of li.querySelectorAll('*')){
          const b=e.getBoundingClientRect();
          if(b.width>0) worst=Math.max(worst, b.right-r.right);
        }
      }
      return Math.round(worst);
    });
    t('row content stays inside the row', spill<=2, `${spill}px spill`);
    // Nav drawer and content layout share the 1024px breakpoint, so wherever
    // rows are used the hamburger must be there too.
    const burger = await p.locator('button[aria-label*="avigation" i], button[aria-label*="menu" i], header button[aria-expanded]').count();
    t('mobile nav toggle present', burger>0, `${burger} candidate(s)`);
    const sidebarVisible = await p.locator('nav a[href="/vendors"]').first().isVisible().catch(()=>false);
    t('side nav is not taking content width', !sidebarVisible, sidebarVisible?'sidebar visible':'collapsed to drawer');
  }

  // sparklines render at every width (SSR-safe inline svg now)
  const sparks = await p.evaluate(()=>document.querySelectorAll('svg[role=img]').length);
  t('sparklines rendered', sparks>0, `${sparks}`);

  await p.screenshot({path:`.verify/responsive/${v.name}-1-products.png`});
  await p.screenshot({path:`.verify/responsive/${v.name}-1-products-full.png`, fullPage:true});

  // ---- vertical scroll sanity: the content region should scroll, once ----
  const scrollers = await p.evaluate(()=>[...document.querySelectorAll('*')]
    .filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+4;})
    .map(e=>e.className?.toString().slice(0,44)||e.tagName));
  t('exactly one vertical scroll container', scrollers.length<=1, scrollers.join(' , ')||'none');

  await p.mouse.wheel(0,1200);
  await p.waitForTimeout(500);
  const moved = await p.evaluate(()=>{
    const cands=[document.scrollingElement,...document.querySelectorAll('*')]
      .filter(e=>e&&e.scrollTop>0);
    return cands.length>0;
  });
  t('wheel scrolls the list', moved);

  // ---- detail page ----
  const link = p.locator(isTable ? 'table tbody tr a' : 'li a').first();
  await link.click();
  await p.waitForURL('**/products/**',{timeout:20000});
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(2000);
  const dOverflow = await p.evaluate(()=>({d:document.documentElement.scrollWidth,w:window.innerWidth}));
  t('detail: no horizontal overflow', dOverflow.d<=dOverflow.w+1, `${dOverflow.d} vs ${dOverflow.w}`);
  const chart = await p.evaluate(()=>{
    const svgs=[...document.querySelectorAll('svg')].filter(s=>s.getBoundingClientRect().width>200);
    return svgs.length;
  });
  t('detail: chart rendered', chart>0, `${chart} wide svg`);
  const titleWrap = await p.evaluate(()=>{
    const h=document.querySelector('h1'); if(!h) return null;
    const r=h.getBoundingClientRect();
    return {right:Math.round(r.right), win:window.innerWidth, ok:r.right<=window.innerWidth+1};
  });
  t('detail: long title does not overflow', titleWrap?.ok, `h1 right ${titleWrap?.right} / ${titleWrap?.win}`);
  await p.screenshot({path:`.verify/responsive/${v.name}-2-detail.png`});
  await p.screenshot({path:`.verify/responsive/${v.name}-2-detail-full.png`, fullPage:true});

  const real=errs.filter(e=>!/favicon|DevTools|_next\/static/i.test(e));
  t('no console/page errors', real.length===0, real.slice(0,2).join(' | ')||'none');

  await ctx.close();
}
await b.close();
console.log(`\n${fails===0?'✓ ALL RESPONSIVE CHECKS PASSED':`✗ ${fails} CHECK(S) FAILED`}`);
process.exit(fails===0?0:1);
