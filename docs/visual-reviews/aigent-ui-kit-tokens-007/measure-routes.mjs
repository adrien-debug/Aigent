import { chromium } from 'playwright'
const BASE='http://127.0.0.1:3987'
const R=['/','/runs','/agents','/projects','/builder','/qualification','/delivery','/runtime','/runtime?tab=telemetry','/learning','/actions','/settings','/lab','/lab/visualizations','/agents/copilot-gold-trading-high-risk-copilot-draft-57917f07-bd916fd8','/delivery/copilot-market-intelligence','/qualification/copilot-agent-builder-copilot-12775a21','/projects/seed-project-lab','/builder/proj-accounting-agent']
const probe=()=>{const de=document.documentElement;const clip=[];document.querySelectorAll('section,table,ul,article').forEach(el=>{const r=el.getBoundingClientRect();if(r.height>0&&r.bottom>window.innerHeight+2){let a=el.parentElement,ok=false;while(a){const s=getComputedStyle(a);if((s.overflowY==='auto'||s.overflowY==='scroll')&&a.scrollHeight>a.clientHeight+1){ok=true;break}a=a.parentElement}if(!ok)clip.push(el.tagName)}})
// Detecte une couleur Tailwind zinc residuelle rendue a l'ecran (rgb du gris zinc)
const zinc=[];document.querySelectorAll('*').forEach(el=>{const s=getComputedStyle(el);const c=s.backgroundColor;if(/rgb\(24, 24, 27\)|rgb\(39, 39, 42\)|rgb\(63, 63, 70\)/.test(c))zinc.push((el.className||'').toString().slice(0,40))})
return{doc:de.scrollHeight,client:de.clientHeight,scrolls:de.scrollHeight>de.clientHeight+1,clip:clip.length,zincSurfaces:zinc.length}}
const b=await chromium.launch();const errs=[]
for(const vp of [{w:1440,h:900},{w:1280,h:800},{w:375,h:812}]){
const p=await b.newPage({viewport:{width:vp.w,height:vp.h}});p.on('console',m=>{if(m.type()==='error')errs.push(vp.w+' '+m.text().slice(0,90))});p.on('pageerror',e=>errs.push(vp.w+' '+String(e).slice(0,90)))
let ko=0,zinc=0
for(const r of R){try{const resp=await p.goto(BASE+r,{waitUntil:'networkidle',timeout:30000});await p.waitForTimeout(250);const m=await p.evaluate(probe);zinc+=m.zincSurfaces;if(resp.status()!==200||m.scrolls||m.clip>0){ko++;console.log(`KO ${vp.w} ${r} st=${resp.status()} doc=${m.doc}/${m.client} clip=${m.clip}`)}}catch(e){ko++;console.log(`ERR ${vp.w} ${r} ${String(e).slice(0,70)}`)}}
console.log(`${vp.w}x${vp.h}: ${R.length-ko}/${R.length} OK · surfaces zinc residuelles: ${zinc}`);await p.close()}
await b.close();console.log('console errors:',errs.length);errs.slice(0,6).forEach(e=>console.log('  ',e))
