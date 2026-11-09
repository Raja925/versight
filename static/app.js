(function(){
'use strict';

/* ---------- helpers ---------- */
const $=(s,r)=>(r||document).querySelector(s);
const $$=(s,r)=>Array.from((r||document).querySelectorAll(s));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const store={
  get(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
};
const reduceMotion=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}};

const ICONS={
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  ul:'<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  outdent:'<path d="M21 6H11M21 12h-6M21 18H11"/><path d="m7 8-4 4 4 4"/>',
  indent:'<path d="M21 6H11M21 12h-6M21 18H11"/><path d="m3 8 4 4-4 4"/>',
  left:'<path d="M3 6h18M3 12h12M3 18h16"/>',
  center:'<path d="M3 6h18M6 12h12M4 18h16"/>',
  right:'<path d="M3 6h18M9 12h12M5 18h16"/>',
  justify:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  table:'<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
  hr:'<path d="M3 12h18"/>'
};
$$('[data-ico]').forEach(el=>{
  el.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICONS[el.getAttribute('data-ico')]||'')+'</svg>';
});

/* ---------- html sanitising ---------- */
const ALLOWED={P:1,H1:1,H2:1,H3:1,H4:1,H5:'H4',H6:'H4',UL:1,OL:1,LI:1,STRONG:1,B:'STRONG',EM:1,I:'EM',U:1,S:1,STRIKE:'S',DEL:'S',BR:1,TABLE:1,THEAD:1,TBODY:1,TR:1,TH:1,TD:1,BLOCKQUOTE:1,SUP:1,SUB:1,HR:1,PRE:1,CODE:1};
const BLOCK_TAGS=new Set(['P','H1','H2','H3','H4','H5','H6','UL','OL','TABLE','BLOCKQUOTE','PRE','HR']);
const STYLE_OK=new Set(['font-family','font-size','text-align']);
function safeStyle(s){
  return String(s||'').split(';').map(x=>x.trim()).filter(x=>{
    const i=x.indexOf(':'); if(i<1) return false;
    return STYLE_OK.has(x.slice(0,i).trim().toLowerCase())&&/^[\w\s.,%"'\-]+$/.test(x.slice(i+1));
  }).join('; ');
}
/* keep=true also keeps font family, font size and alignment (used for saving and reloading the draft) */
function cleanNode(n,keep){
  if(n.nodeType===3) return esc(n.nodeValue);
  if(n.nodeType!==1) return '';
  const t=n.tagName;
  if(t==='SCRIPT'||t==='STYLE'||t==='META'||t==='LINK'||t==='NOSCRIPT') return '';
  const inner=Array.from(n.childNodes).map(c=>cleanNode(c,keep)).join('');
  if(t==='SPAN'&&keep){ const st=safeStyle(n.getAttribute('style')); return st?'<span style="'+st+'">'+inner+'</span>':inner; }
  const a=ALLOWED[t];
  if(!a) return inner;
  const tag=(a===1?t:a).toLowerCase();
  if(tag==='br'||tag==='hr') return '<'+tag+'>';
  let attrs='';
  if(tag==='td'||tag==='th'){
    const cs=parseInt(n.getAttribute('colspan'),10), rs=parseInt(n.getAttribute('rowspan'),10);
    if(cs>1&&cs<30) attrs+=' colspan="'+cs+'"';
    if(rs>1&&rs<60) attrs+=' rowspan="'+rs+'"';
  }
  if(keep&&/^(p|h1|h2|h3|h4|li|td|th|blockquote)$/.test(tag)){ const st=safeStyle(n.getAttribute('style')); if(st) attrs+=' style="'+st+'"'; }
  return '<'+tag+attrs+'>'+inner+'</'+tag+'>';
}
function toBlocks(html,keep){
  const doc=new DOMParser().parseFromString('<!doctype html><body>'+html,'text/html');
  const out=[]; let inline='';
  const flush=()=>{
    if(inline.replace(/<br>/g,'').replace(/&nbsp;/g,' ').trim()) out.push('<p>'+inline.trim()+'</p>');
    inline='';
  };
  const walk=parent=>{
    Array.from(parent.childNodes).forEach(n=>{
      if(n.nodeType===3){ inline+=esc(n.nodeValue.replace(/\s+/g,' ')); return; }
      if(n.nodeType!==1) return;
      const t=n.tagName;
      if(t==='SCRIPT'||t==='STYLE'||t==='META'||t==='LINK'||t==='TITLE'||t==='HEAD') return;
      if(BLOCK_TAGS.has(t)){
        flush();
        const c=cleanNode(n,keep);
        if(t==='HR'||t==='TABLE'||norm(plain(c))) out.push(c);
      } else if(t==='DIV'||t==='SECTION'||t==='ARTICLE'||t==='MAIN'||t==='FIGURE'||t==='HEADER'||t==='FOOTER'||t==='BODY'){
        flush(); walk(n); flush();
      } else inline+=cleanNode(n,keep);
    });
  };
  walk(doc.body); flush();
  return out;
}
function plain(html){
  const tpl=document.createElement('template');
  tpl.innerHTML=String(html).replace(/<\/(td|th|p|li|h[1-6]|tr)>/gi,' </$1>');
  return norm(tpl.content.textContent);
}

/* ---------- state ---------- */
const ed=$('#editor');
let aiOk=false, healthKnown=false, mockMode=false, modelName='';
let guide=store.get('vs.guide');
let corpus=[];
let suggestions=[];
let sgSeq=0, blockSeq=0;
let chat=[];
let busy=null;
let lastRange=null;
let undoStack=[];
let baseText={};
let isSample=false;
const MAXDOCS=20;

const SAMPLE_TITLE='WI-DEMO-014 Pouch Seal Inspection';
const SAMPLE_HTML=
'<h1>WI-DEMO-014 Pouch Seal Inspection</h1>'+
'<table><tbody><tr><th>Document no.</th><td>WI-DEMO-014</td><th>Revision</th><td>C</td></tr><tr><th>Owner</th><td>Process Engineering</td><th>Effective</th><td>2026-11-02</td></tr></tbody></table>'+
'<h2>Purpose</h2><p>This work instruction describes how operators inspect the heat seal on pouch cells at the seal inspection station.</p>'+
'<h2>Scope</h2><p>Applies to operators and line leads on Line 2, shifts A and B. It does not cover rework.</p>'+
'<h2>Safety and PPE</h2><p><strong>WARNING:</strong> The sealing jaws stay hot for several minutes after a stop. Wear heat-resistant gloves and safety glasses at this station.</p>'+
'<h2>Procedure</h2><ol>'+
'<li>The operator should place the cell on the inspection fixture with the tab facing the operator.</li>'+
'<li>Visually check the seal for wrinkles and then record the result on the traveler.</li>'+
'<li>Measure the seal width at three points with the calipers. Seal width must be between 3.0mm and 4.5mm.</li>'+
'<li>Cells with voids or contamination in the seal are rejected.</li>'+
'<li>Place rejected cells in the red hold bin and notify the line lead.</li>'+
'</ol>'+
'<h2>Revision History</h2><table><tbody><tr><th>Rev</th><th>Date</th><th>Change</th></tr><tr><td>B</td><td>2026-08-14</td><td>Added seal width check</td></tr><tr><td>C</td><td>2026-11-02</td><td>Added hold bin step</td></tr></tbody></table>';

function starterGuide(){
  return {
    voice:'',
    template:[
      {section:'Purpose',required:true},{section:'Scope',required:true},{section:'Responsibilities',required:false},
      {section:'Safety and PPE',required:true},{section:'Equipment and Materials',required:false},
      {section:'Procedure',required:true},{section:'Revision History',required:true}
    ],
    rules:[
      {id:'s1',cat:'Language',text:'Start each procedure step with a verb in the imperative and give one action per step.',strength:'hard',count:0,total:0,origin:'starter',on:true},
      {id:'s2',cat:'Safety',text:'Put every WARNING or CAUTION before the step it applies to, never after it.',strength:'hard',count:0,total:0,origin:'starter',on:true},
      {id:'s3',cat:'Formatting',text:'Write a space between a number and its unit, for example 4 mm or 25 N·m.',strength:'hard',count:0,total:0,origin:'starter',on:true},
      {id:'s4',cat:'Terminology',text:'Use one name for each part, tool and station throughout the document.',strength:'soft',count:0,total:0,origin:'starter',on:true},
      {id:'s5',cat:'Structure',text:'Number steps that happen in order. Use bullets only for lists without an order.',strength:'soft',count:0,total:0,origin:'starter',on:true}
    ],
    docs:[],headStats:[],exemplars:[],learnedAt:null
  };
}
if(!guide||!Array.isArray(guide.rules)||!Array.isArray(guide.template)) guide=starterGuide();
guide.docs=guide.docs||[]; guide.headStats=guide.headStats||[]; guide.exemplars=guide.exemplars||[];
const saveGuide=()=>store.set('vs.guide',guide);

/* ---------- editor structure ---------- */
const blocks=()=>Array.from(ed.children).filter(e=>!e.classList.contains('sg-ghost'));
const findBlock=id=>blocks().find(e=>e.getAttribute('data-b')===id)||null;
function assignIds(){
  const seen=new Set();
  blocks().forEach(el=>{ const m=/^b(\d+)$/.exec(el.getAttribute('data-b')||''); if(m) blockSeq=Math.max(blockSeq,+m[1]); });
  blocks().forEach(el=>{
    let id=el.getAttribute('data-b');
    if(!id||seen.has(id)){ id='b'+(++blockSeq); el.setAttribute('data-b',id); }
    seen.add(id);
  });
}
function ensureNotEmpty(){
  if(!blocks().length){ const p=document.createElement('p'); p.innerHTML='<br>'; ed.appendChild(p); }
}
function wrapStray(){
  Array.from(ed.childNodes).forEach(n=>{
    if(n.nodeType===1&&(BLOCK_TAGS.has(n.tagName)||n.tagName==='DIV'||n.classList.contains('sg-ghost'))) return;
    if(n.nodeType===3&&!n.nodeValue.trim()) return;
    if(n.nodeType!==1&&n.nodeType!==3) return;
    const sel=getSelection();
    const hadCaret=sel&&sel.rangeCount&&n.contains(sel.anchorNode);
    const p=document.createElement('p');
    n.replaceWith(p); p.appendChild(n);
    if(hadCaret){ const r=document.createRange(); r.selectNodeContents(p); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  });
}
function cleanClone(){
  const c=ed.cloneNode(true);
  $$('.sg-ghost',c).forEach(n=>n.remove());
  $$('[data-b]',c).forEach(n=>n.removeAttribute('data-b'));
  $$('.sg-del',c).forEach(n=>{ n.classList.remove('sg-del','flash'); if(!n.getAttribute('class')) n.removeAttribute('class'); });
  c.removeAttribute('id'); c.removeAttribute('contenteditable'); c.removeAttribute('spellcheck'); c.removeAttribute('role'); c.removeAttribute('aria-multiline'); c.removeAttribute('aria-label');
  return c;
}
function docTitle(){ return norm($('#docTitle').value)||'Untitled document'; }

/* ---------- save / status ---------- */
let saveTimer=null;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    store.set('vs.doc',{title:$('#docTitle').value,html:cleanClone().innerHTML,sample:isSample});
    $('#stSave').textContent=isSample?'Sample document with made-up content':'Draft kept in this browser';
  },500);
}
function updateStatus(){
  const bl=blocks(); const words=norm(bl.map(b=>b.textContent).join(' ')); const n=words?words.split(' ').length:0;
  $('#stWords').textContent=n.toLocaleString()+(n===1?' word':' words');
  $('#stBlocks').textContent=bl.length+(bl.length===1?' block':' blocks');
  const p=suggestions.length;
  $('#stPending').textContent=p?p+' pending '+(p===1?'suggestion':'suggestions'):'';
  const b=$('#sugBadge'); b.hidden=!p; b.textContent=p;
}
let staleTimer=null;
function afterInput(){
  wrapStray(); ensureNotEmpty(); assignIds(); updateStatus();
  if(isSample){ isSample=false; }
  scheduleSave();
  clearTimeout(staleTimer); staleTimer=setTimeout(()=>{ if(suggestions.length&&staleChanged()) renderSuggestions(); renderTemplate(); },350);
}
function afterChange(){ ensureNotEmpty(); assignIds(); updateStatus(); scheduleSave(); renderSuggestions(); renderTemplate(); }

/* ---------- selection tracking ---------- */
function inEditor(node){ return !!node&&ed.contains(node); }
function restoreSel(){
  const s=getSelection();
  if(s.rangeCount&&inEditor(s.anchorNode)) return;
  if(lastRange){ try{ s.removeAllRanges(); s.addRange(lastRange); }catch(e){} }
}
function scopeBlocks(){
  if(!lastRange||lastRange.collapsed) return [];
  let r; try{ r=blocks().filter(b=>lastRange.intersectsNode(b)); }catch(e){ r=[]; }
  return r;
}
function currentBlock(){
  let n=lastRange&&lastRange.startContainer; if(!n) return null;
  while(n&&n.parentNode!==ed) n=n.parentNode;
  return n&&n.nodeType===1&&!n.classList.contains('sg-ghost')?n:null;
}
function curCell(){
  const n=lastRange&&lastRange.startContainer; if(!n) return null;
  const el=n.nodeType===1?n:n.parentElement;
  const c=el&&el.closest?el.closest('td,th'):null;
  return c&&ed.contains(c)?c:null;
}
function updateScope(){
  const sc=scopeBlocks();
  $('#scopeLbl').textContent=sc.length?'selection, '+sc.length+(sc.length===1?' block':' blocks'):'whole document';
  $('#scopeClear').hidden=!sc.length;
}
function updateRibbon(){
  ['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList'].forEach(c=>{
    const b=$('[data-cmd="'+c+'"]'); if(!b) return;
    let on=false; try{ on=document.queryCommandState(c); }catch(e){}
    b.classList.toggle('on',!!on);
  });
  try{
    let v=(document.queryCommandValue('formatBlock')||'').toLowerCase().replace(/[<>]/g,'');
    if(!['p','h1','h2','h3','blockquote'].includes(v)) v='p';
    $('#selStyle').value=v;
  }catch(e){}
  const inT=!!curCell();
  ['btnRow','btnCol','btnDelTable'].forEach(id=>{ $('#'+id).disabled=!inT; });
}
document.addEventListener('selectionchange',()=>{
  const s=getSelection();
  if(s.rangeCount&&inEditor(s.anchorNode)&&inEditor(s.focusNode)){
    lastRange=s.getRangeAt(0).cloneRange();
    updateScope(); updateRibbon();
  }
});

/* ---------- ribbon actions ---------- */
function exec(cmd,val){
  ed.focus({preventScroll:true}); restoreSel();
  try{ document.execCommand('styleWithCSS',false,cmd==='fontName'||cmd==='fontSize'); }catch(e){}
  try{ document.execCommand(cmd,false,val==null?null:val); }catch(e){}
  afterInput(); updateRibbon();
}
$$('[data-cmd]').forEach(b=>{
  b.addEventListener('mousedown',e=>e.preventDefault());
  b.addEventListener('click',()=>exec(b.getAttribute('data-cmd')));
});
$('#selStyle').addEventListener('change',e=>{ exec('formatBlock','<'+e.target.value+'>'); });
$('#selFont').addEventListener('change',e=>{ exec('fontName',e.target.value); });
$('#selSize').addEventListener('change',e=>{
  const pt=e.target.value;
  ed.focus({preventScroll:true}); restoreSel();
  try{ document.execCommand('styleWithCSS',false,true); document.execCommand('fontSize',false,'7'); }catch(err){}
  $$('span',ed).forEach(s=>{ if(/xxx-large/.test(s.style.fontSize)) s.style.fontSize=pt+'pt'; });
  $$('font[size="7"]',ed).forEach(f=>{ const sp=document.createElement('span'); sp.style.fontSize=pt+'pt'; sp.innerHTML=f.innerHTML; f.replaceWith(sp); });
  afterInput();
});
$('#btnTable').addEventListener('mousedown',e=>e.preventDefault());
$('#btnTable').addEventListener('click',()=>{
  const t=document.createElement('table');
  t.innerHTML='<tbody><tr><th>Heading</th><th>Heading</th><th>Heading</th></tr><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody>';
  const p=document.createElement('p'); p.innerHTML='<br>';
  const b=currentBlock();
  if(b) b.after(t,p); else ed.append(t,p);
  afterChange();
  const c=t.querySelector('th'); if(c){ const r=document.createRange(); r.selectNodeContents(c); const s=getSelection(); s.removeAllRanges(); s.addRange(r); }
});
$('#btnRow').addEventListener('click',()=>{
  const c=curCell(); if(!c) return;
  const tr=c.parentElement, n=tr.cells.length, nt=document.createElement('tr');
  for(let i=0;i<n;i++){ const td=document.createElement('td'); td.innerHTML='<br>'; nt.appendChild(td); }
  tr.after(nt); afterInput();
});
$('#btnCol').addEventListener('click',()=>{
  const c=curCell(); if(!c) return;
  const idx=c.cellIndex, table=c.closest('table');
  Array.from(table.rows).forEach(r=>{
    const ref=r.cells[idx]; const isH=ref&&ref.tagName==='TH';
    const nc=document.createElement(isH?'th':'td'); nc.innerHTML=isH?'Heading':'<br>';
    if(ref) ref.after(nc); else r.appendChild(nc);
  });
  afterInput();
});
$('#btnDelTable').addEventListener('click',()=>{
  const c=curCell(); if(!c) return;
  c.closest('table').remove(); lastRange=null; afterChange(); updateRibbon();
});
ed.addEventListener('input',afterInput);
ed.addEventListener('paste',e=>{
  const cd=e.clipboardData; if(!cd) return;
  e.preventDefault();
  const html=cd.getData('text/html'), text=cd.getData('text/plain');
  let ins;
  if(html){
    const bl=toBlocks(html);
    ins=(bl.length===1&&/^<p>/.test(bl[0]))?bl[0].replace(/^<p>|<\/p>$/g,''):bl.join('');
  }
  if(!ins) ins=esc(text).replace(/\n/g,'<br>');
  try{ document.execCommand('insertHTML',false,ins); }catch(err){}
  afterInput();
});
$('#docTitle').addEventListener('input',()=>{ scheduleSave(); });

/* ---------- toast ---------- */
let toastTimer=null;
function toast(msg,label,fn){
  const t=$('#toast'); t.innerHTML='';
  const s=document.createElement('span'); s.textContent=msg; t.appendChild(s);
  if(label&&fn){ const b=document.createElement('button'); b.type='button'; b.textContent=label; b.addEventListener('click',()=>{ fn(); t.hidden=true; }); t.appendChild(b); }
  t.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.hidden=true; },label?8000:4000);
}

/* ---------- tabs / views ---------- */
function setTab(name){
  const map={ai:['tabAI','paneAI'],sug:['tabSug','paneSug'],guide:['tabGuide','paneGuide']};
  Object.keys(map).forEach(k=>{
    const on=k===name;
    $('#'+map[k][0]).setAttribute('aria-selected',on?'true':'false');
    $('#'+map[k][1]).classList.toggle('on',on);
  });
}
$('#tabAI').addEventListener('click',()=>setTab('ai'));
$('#tabSug').addEventListener('click',()=>setTab('sug'));
$('#tabGuide').addEventListener('click',()=>setTab('guide'));
function setView(v){
  $('#work').setAttribute('data-view',v);
  $('#mvDoc').setAttribute('aria-pressed',v==='doc'?'true':'false');
  $('#mvAI').setAttribute('aria-pressed',v==='ai'?'true':'false');
}
$('#mvDoc').addEventListener('click',()=>setView('doc'));
$('#mvAI').addEventListener('click',()=>setView('ai'));

/* ---------- export ---------- */
function exportHTML(){
  const c=cleanClone();
  $$('table',c).forEach(t=>{ t.setAttribute('border','1'); t.setAttribute('cellspacing','0'); t.setAttribute('cellpadding','5'); });
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+esc(docTitle())+'</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.4;color:#000}h1{font-size:18pt}h2{font-size:13pt}h3{font-size:11.5pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:4px 6px;vertical-align:top;text-align:left}th{background:#e8ebf0}</style></head><body>'+c.innerHTML+'</body></html>';
}
function fileBase(){ return docTitle().replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'-').slice(0,80)||'document'; }
function saveBlob(name,blob){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),4000);
  toast('Saved '+name);
}
const menu=$('#exportMenu');
$('#btnExport').addEventListener('click',e=>{ e.stopPropagation(); menu.hidden=!menu.hidden; $('#btnExport').setAttribute('aria-expanded',String(!menu.hidden)); });
document.addEventListener('click',e=>{ if(!menu.hidden&&!menu.contains(e.target)){ menu.hidden=true; $('#btnExport').setAttribute('aria-expanded','false'); } });
$('#expHtml').addEventListener('click',()=>{
  menu.hidden=true;
  try{ saveBlob(fileBase()+'.html',new Blob([exportHTML()],{type:'text/html'})); }catch(e){ toast('Could not save the file.'); }
});
$('#expDocx').addEventListener('click',async()=>{
  menu.hidden=true;
  try{
    const res=await fetch('/api/export/docx',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:docTitle(),html:cleanClone().innerHTML})});
    if(!res.ok){ let m='Could not build the .docx file.'; try{ m=(await res.json()).error.message||m; }catch(e){} toast(m); return; }
    saveBlob(fileBase()+'.docx',await res.blob());
  }catch(e){ toast('Could not reach the Versight server to build the .docx file.'); }
});
let newArmed=false, newTimer=null;
$('#btnNew').addEventListener('click',()=>{
  const b=$('#btnNew');
  if(!newArmed){ newArmed=true; b.textContent='Click again to clear'; newTimer=setTimeout(()=>{ newArmed=false; b.textContent='New'; },3000); return; }
  clearTimeout(newTimer); newArmed=false; b.textContent='New';
  ed.innerHTML='<p><br></p>'; $('#docTitle').value='Untitled document'; suggestions=[]; undoStack=[]; isSample=false; lastRange=null;
  afterChange(); updateScope(); ed.focus();
});

/* ---------- diff ---------- */
function diffHTML(a,b){
  const A=a.match(/\S+\s*/g)||[], B=b.match(/\S+\s*/g)||[];
  const n=A.length, m=B.length;
  if(n*m>160000) return '<del>'+esc(a)+'</del> <ins>'+esc(b)+'</ins>';
  const w=m+1, L=new Uint16Array((n+1)*w);
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--)
    L[i*w+j]=A[i].trim()===B[j].trim()?L[(i+1)*w+j+1]+1:Math.max(L[(i+1)*w+j],L[i*w+j+1]);
  let i=0,j=0,out='',cur=null,buf='';
  const wrap=(t,s)=>t==='='?esc(s):(t==='-'?'<del>':'<ins>')+esc(s)+(t==='-'?'</del>':'</ins>');
  const push=(t,s)=>{ if(cur!==t){ if(buf) out+=wrap(cur,buf); buf=''; cur=t; } buf+=s; };
  while(i<n&&j<m){
    if(A[i].trim()===B[j].trim()){ push('=',B[j]); i++; j++; }
    else if(L[(i+1)*w+j]>=L[i*w+j+1]){ push('-',A[i]); i++; }
    else { push('+',B[j]); j++; }
  }
  while(i<n) push('-',A[i++]);
  while(j<m) push('+',B[j++]);
  if(buf) out+=wrap(cur,buf);
  return out;
}

/* ---------- suggestions ---------- */
const OPLABEL={replace:'Replace',insert_after:'Insert',delete:'Delete'};
function staleOf(s){
  if(s.id==='start') return false;
  const t=findBlock(s.id);
  if(!t) return true;
  if(s.op!=='insert_after') return norm(t.textContent)!==s.origText;
  return false;
}
function staleChanged(){ return suggestions.some(s=>staleOf(s)!==!!s.stale); }
function renderSuggestions(){
  $$('.sg-ghost',ed).forEach(n=>n.remove());
  $$('.sg-del',ed).forEach(n=>n.classList.remove('sg-del','flash'));
  const lastAfter=new Map();
  suggestions.forEach(s=>{
    s.stale=staleOf(s);
    const target=s.id==='start'?null:findBlock(s.id);
    if(s.id!=='start'&&!target) return;
    if(s.op!=='insert_after'&&target&&!s.stale) target.classList.add('sg-del');
    const g=document.createElement('div');
    g.className='sg-ghost'+(s.stale?' stale':''); g.setAttribute('contenteditable','false'); g.setAttribute('data-sg',s.sid);
    const tag=s.stale?'<span class="sg-tag stale">Changed</span>':'<span class="sg-tag '+(s.op==='delete'?'delete':'')+'">'+OPLABEL[s.op]+'</span>';
    const why=s.stale?'This text changed after the suggestion was made.':esc(s.why||(s.op==='delete'?'Delete this block.':''));
    g.innerHTML='<div class="sg-head">'+tag+'<span class="sg-why">'+why+'</span><span class="sg-actions">'+(s.stale?'':'<button type="button" data-act="accept">Accept</button>')+'<button type="button" data-act="reject">'+(s.stale?'Dismiss':'Reject')+'</button></span></div>'+(s.op==='delete'?'':'<div class="sg-body">'+s.blocks.join('')+'</div>');
    const key=s.id; const anchor=lastAfter.get(key)||target;
    if(anchor) anchor.after(g); else ed.prepend(g);
    lastAfter.set(key,g);
  });
  renderSugPanel(); updateStatus();
}
function renderSugPanel(){
  const list=$('#sugList'); const bar=$('#sgBar');
  bar.hidden=!suggestions.length;
  $('#sgCount').textContent=suggestions.length+(suggestions.length===1?' pending suggestion':' pending suggestions');
  if(!suggestions.length){
    list.innerHTML='<div class="empty">No suggestions yet. Ask the assistant to change the document. Its proposed edits appear here and in the document, and nothing changes until you accept it.</div>';
    return;
  }
  list.innerHTML=suggestions.map(s=>{
    const body=s.op==='replace'?diffHTML(s.origText,s.newText):s.op==='insert_after'?'<ins>'+esc(s.newText)+'</ins>':'<del>'+esc(s.origText)+'</del>';
    const tag=s.stale?'<span class="tag stale">Changed</span>':'<span class="tag '+(s.op==='delete'?'delete':'')+'">'+OPLABEL[s.op]+'</span>';
    const rule=s.rule?'<span class="pill mono">'+esc(s.rule)+'</span>':'';
    return '<div class="card sug" data-sid="'+s.sid+'"><div class="top2">'+tag+rule+'</div><div class="diff">'+body+'</div>'+
      (s.why?'<div class="why">'+esc(s.why)+'</div>':'')+
      '<div class="acts">'+(s.stale?'':'<button class="btn sm primary" type="button" data-act="accept">Accept</button>')+'<button class="btn sm" type="button" data-act="reject">'+(s.stale?'Dismiss':'Reject')+'</button><button class="btn sm" type="button" data-act="locate">Show in document</button></div></div>';
  }).join('');
}
function snapshotHTML(){
  const c=ed.cloneNode(true);
  $$('.sg-ghost',c).forEach(n=>n.remove());
  $$('.sg-del',c).forEach(n=>{ n.classList.remove('sg-del','flash'); if(!n.getAttribute('class')) n.removeAttribute('class'); });
  return c.innerHTML;
}
function pushUndo(){ undoStack.push({html:snapshotHTML(),sugs:suggestions.slice(),title:$('#docTitle').value}); if(undoStack.length>30) undoStack.shift(); }
function undoAI(){
  const e=undoStack.pop(); if(!e) return;
  ed.innerHTML=e.html; suggestions=e.sugs; if(typeof e.title==='string') $('#docTitle').value=e.title; ensureNotEmpty(); assignIds(); afterChange(); toast('Change undone.');
}
function applySuggestion(s){
  const target=s.id==='start'?null:findBlock(s.id);
  if(s.id!=='start'&&!target) return false;
  if(s.op!=='insert_after'&&norm(target.textContent)!==s.origText) return false;
  const tpl=document.createElement('template'); tpl.innerHTML=s.blocks.join('');
  const nodes=Array.from(tpl.content.childNodes);
  if(s.op==='replace'){ if(nodes.length) target.replaceWith(...nodes); else target.remove(); }
  else if(s.op==='insert_after'){ if(target) target.after(...nodes); else ed.prepend(...nodes); }
  else if(s.op==='delete'){ target.remove(); }
  suggestions=suggestions.filter(x=>x!==s);
  return true;
}
function acceptOne(sid){
  const s=suggestions.find(x=>x.sid===sid); if(!s) return;
  pushUndo();
  if(!applySuggestion(s)){ undoStack.pop(); toast('That text changed, so the suggestion could not be applied.'); renderSuggestions(); return; }
  afterChange(); toast('Suggestion applied.','Undo',undoAI);
}
function rejectOne(sid){ suggestions=suggestions.filter(x=>x.sid!==sid); renderSuggestions(); }
function locate(sid){
  const s=suggestions.find(x=>x.sid===sid); if(!s) return;
  setView('doc');
  const g=$('.sg-ghost[data-sg="'+sid+'"]',ed)||findBlock(s.id); if(!g) return;
  g.scrollIntoView({block:'center',behavior:reduceMotion()?'auto':'smooth'});
  g.classList.add('flash'); setTimeout(()=>g.classList.remove('flash'),1600);
}
$('#sugList').addEventListener('click',e=>{
  const b=e.target.closest('button[data-act]'); if(!b) return;
  const sid=b.closest('[data-sid]').getAttribute('data-sid'); const act=b.getAttribute('data-act');
  if(act==='accept') acceptOne(sid); else if(act==='reject') rejectOne(sid); else locate(sid);
});
ed.addEventListener('mousedown',e=>{ if(e.target.closest('.sg-actions button')) e.preventDefault(); });
ed.addEventListener('click',e=>{
  const b=e.target.closest('.sg-actions button'); if(!b) return;
  const sid=b.closest('.sg-ghost').getAttribute('data-sg');
  if(b.getAttribute('data-act')==='accept') acceptOne(sid); else rejectOne(sid);
});
$('#accAll').addEventListener('click',()=>{
  if(!suggestions.length) return;
  pushUndo(); let ok=0, skip=0;
  suggestions.slice().forEach(s=>{ if(applySuggestion(s)) ok++; else skip++; });
  afterChange();
  toast(ok+(ok===1?' suggestion applied':' suggestions applied')+(skip?', '+skip+' skipped because the text changed':'')+'.','Undo',undoAI);
});
$('#rejAll').addEventListener('click',()=>{ suggestions=[]; renderSuggestions(); });

/* ---------- AI plumbing (talks to the Versight server, which holds the API key) ---------- */
const SERVER_CODES=new Set(['no_api_key','invalid_api_key','rate_limited','model_not_found','upstream_error','truncated','empty_completion','invalid_json','too_large','invalid_request']);
function errCopy(e){
  if(e&&SERVER_CODES.has(e.code)&&e.message) return e.message;
  return 'Could not reach the Versight server. Check that it is still running, then try again.';
}
async function api(path,body,signal){
  let res;
  try{ res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal}); }
  catch(e){ if(e&&e.name==='AbortError') throw {code:'cancelled'}; throw {code:'network'}; }
  let data=null; try{ data=await res.json(); }catch(e){}
  if(!res.ok){ const er=(data&&data.error)||{}; throw {code:er.code||('http_'+res.status),message:er.message||''}; }
  return data;
}
function showAiNote(){
  const n=$('#aiNote'); n.classList.remove('info');
  let msg='';
  if(!healthKnown) msg='Cannot reach the Versight server. Editing and formatting still work, but the assistant, style learning and Word export need the server running.';
  else if(!aiOk) msg='The assistant is off because the server has no Anthropic API key. Set ANTHROPIC_API_KEY, restart the server and reload this page. Editing, formatting and export still work.';
  else if(mockMode){ msg='Demo mode: replies come from simple built-in rules, not an AI model. Restart the server without VERSIGHT_MOCK to use Claude.'; n.classList.add('info'); }
  n.textContent=msg; n.hidden=!msg;
  $('#stAI').textContent=healthKnown&&aiOk?(mockMode?'Demo mode':'Model: '+modelName):'';
}
const aiReady=(async()=>{
  try{
    const res=await fetch('/api/health',{cache:'no-store'});
    const h=await res.json();
    aiOk=!!h.ai; mockMode=!!h.mock; modelName=String(h.model||''); healthKnown=true;
  }catch(e){ aiOk=false; healthKnown=false; }
  showAiNote(); renderBusy(); renderGuide();
})();

function setBusy(kind,ctl){ busy=kind?{kind:kind,ctl:ctl}:null; renderBusy(); }
function renderBusy(){
  const a=busy&&busy.kind==='assist', l=busy&&busy.kind==='learn';
  const send=$('#btnSend'); send.textContent=a?'Stop':'Send'; send.disabled=!!l;
  $$('#chips .chip').forEach(c=>{ c.disabled=!!busy; });
  const lb=$('#btnLearn'); lb.textContent=l?'Stop':'Learn style guide'; lb.disabled=l?false:(!!busy||!corpus.length||!aiOk);
  renderChat();
}

/* ---------- chat ---------- */
function renderChat(){
  const box=$('#chat');
  let h='';
  if(!chat.length){
    h+='<p class="hint">Ask for changes to this document. The assistant follows the rules in the Style guide tab and proposes edits that you accept or reject. Select text first to limit it to that part.</p>';
  }
  chat.forEach(m=>{
    h+='<div class="msg '+(m.role==='user'?'user':'')+(m.error?' err':'')+'"><div class="who">'+(m.role==='user'?'You':'Assistant')+'</div><div class="txt">'+esc(m.text)+'</div>'+
      (m.n?'<div style="margin-top:6px"><button class="btn sm" type="button" data-review="1">Review '+m.n+(m.n===1?' suggestion':' suggestions')+'</button></div>':'')+'</div>';
  });
  if(busy&&busy.kind==='assist') h+='<div class="msg"><div class="who">Assistant</div><div class="txt thinking">Working on it</div></div>';
  box.innerHTML=h; box.scrollTop=box.scrollHeight;
}
$('#chat').addEventListener('click',e=>{ if(e.target.closest('[data-review]')){ setTab('sug'); } });

const QUICK={
  check:'Review the whole document against every rule in the style guide and against the template sections. Propose one edit for each violation, naming the rule id. Leave text that already follows the rules alone. If a required template section is missing, insert it with a short placeholder body in square brackets.',
  steps:'Fix the procedure steps. Each step starts with an imperative verb and contains one action. Move any warning or caution so it comes before the step it applies to. Keep every number, unit, tolerance and part name exactly as written.',
  tighten:'Tighten the wording. Make sentences shorter and clearer without changing meaning. Keep every number, unit, tolerance, part number and safety statement exactly as written.',
  source:'Update the document so it reflects the source material. Change only what the source requires. In "why", say which part of the source each edit comes from. If the source does not give a needed value, use a bracketed placeholder.'
};
function buildBody(userText,sc){
  const src=norm($('#srcText').value)?$('#srcText').value.slice(0,20000):'';
  return {
    request:userText,
    blocks:blocks().map(b=>({id:b.getAttribute('data-b'),html:cleanNode(b)||'<p></p>'})),
    scope_ids:sc.map(b=>b.getAttribute('data-b')),
    rules:guide.rules.filter(r=>r.on&&r.text).map(r=>({id:String(r.id).slice(0,16),cat:String(r.cat||'').slice(0,40),text:r.text.slice(0,600),strength:r.strength==='hard'?'hard':'soft'})),
    template:guide.template.slice(0,30).map(t=>({section:t.section.slice(0,80),required:!!t.required})),
    voice:(guide.voice||'').slice(0,600),
    exemplars:guide.exemplars.slice(0,5).map(x=>String(x).slice(0,800)),
    source:src,
    history:chat.slice(-7,-1).filter(m=>!m.error).map(m=>({role:m.role==='user'?'user':'assistant',text:m.text.slice(0,500)}))
  };
}
function normalizeEdits(r,scopeIds){
  const out=[]; let skipped=0;
  const list=Array.isArray(r.edits)?r.edits.slice(0,40):[];
  list.forEach(e=>{
    if(!e||typeof e!=='object') return;
    const op=String(e.op||'').toLowerCase(), id=String(e.id||'');
    if(op!=='replace'&&op!=='insert_after'&&op!=='delete') return;
    if(!/^[A-Za-z0-9_-]+$/.test(id)) return;
    if(scopeIds.length&&!scopeIds.includes(id)){ skipped++; return; }
    const target=id==='start'?null:findBlock(id);
    if(id!=='start'&&!target) return;
    if(op!=='insert_after'){
      if(id==='start') return;
      if(baseText[id]!==undefined&&norm(target.textContent)!==baseText[id]){ skipped++; return; }
    }
    const blocksHtml=op==='delete'?[]:toBlocks(String(e.html||''));
    if(op!=='delete'&&!blocksHtml.length) return;
    const newText=blocksHtml.map(plain).join('\n');
    if(op==='replace'){
      const sameTag=blocksHtml.length===1&&new RegExp('^<'+target.tagName.toLowerCase()+'[ >]','i').test(blocksHtml[0]);
      if(sameTag&&norm(plain(blocksHtml[0]))===norm(target.textContent)&&!/^<(table|ul|ol)/i.test(blocksHtml[0])) return;
    }
    const s={sid:'s'+(++sgSeq),op:op,id:id,origText:target?norm(target.textContent):'',blocks:blocksHtml,newText:newText,why:String(e.why||'').slice(0,240),rule:String(e.rule||'').slice(0,12),stale:false};
    if(op!=='insert_after') suggestions=suggestions.filter(o=>!(o.id===s.id&&o.op!=='insert_after'));
    out.push(s);
  });
  return {list:out,skipped:skipped};
}
async function ask(text){
  text=norm(text)?text.trim():''; if(!text) return;
  if(busy) return;
  chat.push({role:'user',text:text}); $('#ask').value=''; renderChat();
  await aiReady;
  if(!aiOk){ chat.push({role:'assistant',text:healthKnown?'The server has no Anthropic API key, so the assistant cannot run. Set ANTHROPIC_API_KEY and restart the server.':'Cannot reach the Versight server, so the assistant cannot run.',error:true}); renderChat(); return; }
  wrapStray(); ensureNotEmpty(); assignIds();
  baseText={}; blocks().forEach(b=>{ baseText[b.getAttribute('data-b')]=norm(b.textContent); });
  const sc=scopeBlocks(); const scopeIds=sc.map(b=>b.getAttribute('data-b'));
  const ctl=new AbortController(); setBusy('assist',ctl);
  try{
    let r=await api('/api/assist',buildBody(text,sc),ctl.signal);
    if(!r||typeof r!=='object') r={reply:'',edits:[]};
    const res=normalizeEdits(r,scopeIds);
    suggestions=suggestions.concat(res.list);
    let reply=String(r.reply||'').trim()||(res.list.length?'Here are the proposed edits.':'I did not find anything to change.');
    if(res.skipped) reply+='\n\n'+res.skipped+(res.skipped===1?' edit was':' edits were')+' left out because that text changed while I worked or was outside your selection.';
    if(r.dropped) reply+='\n\n'+r.dropped+(r.dropped===1?' proposed edit was':' proposed edits were')+' ignored because they pointed at text that does not exist or was outside your selection.';
    chat.push({role:'assistant',text:reply,n:res.list.length});
    renderSuggestions();
  }catch(e){
    if(e&&e.code==='cancelled') chat.push({role:'assistant',text:'Stopped.'});
    else chat.push({role:'assistant',text:errCopy(e),error:true});
  }finally{ setBusy(null); }
}
function send(){
  if(busy&&busy.kind==='assist'){ busy.ctl.abort(); return; }
  ask($('#ask').value);
}
$('#btnSend').addEventListener('click',send);
$('#ask').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });
$('#chips').addEventListener('click',e=>{
  const c=e.target.closest('[data-q]'); if(!c||busy) return;
  const q=c.getAttribute('data-q');
  if(q==='source'&&!norm($('#srcText').value)){
    $('#srcBox').open=true; $('#srcText').focus();
    chat.push({role:'assistant',text:'Paste the source material first (an ECO, ticket or notes), then choose this again.'}); renderChat(); return;
  }
  ask(QUICK[q]);
});
$('#scopeClear').addEventListener('click',()=>{ lastRange=null; const s=getSelection(); if(s.rangeCount&&inEditor(s.anchorNode)) s.removeAllRanges(); updateScope(); });

/* ---------- template check ---------- */
function normHead(t){ return String(t).toLowerCase().replace(/^[\d.\s\-–]+/,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim(); }
function templateStatus(){
  const hs=blocks().filter(b=>/^H[1-4]$/.test(b.tagName)).map(b=>({el:b,key:normHead(b.textContent)}));
  return guide.template.map(t=>{
    const k=normHead(t.section);
    const h=hs.find(h=>h.key===k||(k.length>=4&&h.key.includes(k))||(h.key.length>=4&&k.includes(h.key)));
    return {section:t.section,required:!!t.required,found:!!h,el:h?h.el:null,count:t.count,total:t.total};
  });
}
function renderTemplate(){
  const st=templateStatus();
  const box=$('#tpl');
  if(!st.length){ box.innerHTML='<div class="empty">No template sections yet. Learn a style guide to get them.</div>'; $('#btnMissing').hidden=true; return; }
  box.innerHTML=st.map(t=>'<div><span class="mk '+(t.found?'ok':'no')+'">'+(t.found?'✓':'–')+'</span><span>'+esc(t.section)+'</span><span class="rq">'+(t.count!=null&&t.total?t.count+'/'+t.total+' docs':(t.required?'required':'optional'))+'</span></div>').join('');
  const miss=st.filter(t=>!t.found).length;
  const b=$('#btnMissing'); b.hidden=!miss; b.textContent='Insert '+miss+' missing '+(miss===1?'section':'sections');
}
$('#btnMissing').addEventListener('click',()=>{
  const st=templateStatus(); if(!st.some(t=>!t.found)) return;
  pushUndo();
  st.forEach((t,i)=>{
    if(t.found) return;
    let before=null;
    for(let j=i+1;j<st.length;j++){ if(st[j].found&&st[j].el){ before=st[j].el; break; } }
    const h=document.createElement('h2'); h.textContent=t.section;
    const p=document.createElement('p'); p.innerHTML='<br>';
    if(before) before.before(h,p); else ed.append(h,p);
    t.found=true; t.el=h;
  });
  afterChange(); toast('Missing sections inserted.','Undo',undoAI);
});

/* ---------- open a file into the editor ---------- */
$('#btnOpen').addEventListener('click',()=>$('#openIn').click());
$('#openIn').addEventListener('change',async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return;
  try{
    const bl=toBlocks(await fileToHtml(f),true);
    if(!bl.length){ toast('That file has no text to open.'); return; }
    pushUndo();
    ed.innerHTML=bl.join(''); suggestions=[]; baseText={}; isSample=false; lastRange=null;
    $('#docTitle').value=f.name.replace(/\.[^.]+$/,'').slice(0,120)||'Untitled document';
    afterChange(); updateScope(); toast('Opened '+f.name+'.','Undo',undoAI);
  }catch(err){
    toast(err&&err.message==='type'?'Open a .docx, .html, .md or .txt file.':err&&err.message==='size'?'That file is over 15 MB.':'Could not read that file.');
  }
});

/* ---------- guide: files ---------- */
function textToHtml(t){
  const lines=t.replace(/\r/g,'').split('\n'); const out=[]; let list=null; let para=[];
  const fp=()=>{ if(para.length){ out.push('<p>'+esc(para.join(' '))+'</p>'); para=[]; } };
  const fl=()=>{ if(list){ out.push('<'+list.t+'>'+list.items.map(i=>'<li>'+esc(i)+'</li>').join('')+'</'+list.t+'>'); list=null; } };
  lines.forEach(raw=>{
    const l=raw.trim(); let m;
    if(!l){ fp(); fl(); return; }
    if((m=l.match(/^(#{1,4})\s+(.*)$/))){ fp(); fl(); out.push('<h'+m[1].length+'>'+esc(m[2])+'</h'+m[1].length+'>'); return; }
    if((m=l.match(/^\d+[.)]\s+(.*)$/))){ fp(); if(!list||list.t!=='ol'){ fl(); list={t:'ol',items:[]}; } list.items.push(m[1]); return; }
    if((m=l.match(/^[-*•]\s+(.*)$/))){ fp(); if(!list||list.t!=='ul'){ fl(); list={t:'ul',items:[]}; } list.items.push(m[1]); return; }
    if(/^[A-Z][A-Z0-9 \-\/&,()]{3,60}$/.test(l)){ fp(); fl(); out.push('<h2>'+esc(l)+'</h2>'); return; }
    fl(); para.push(l);
  });
  fp(); fl(); return out.join('');
}
function analyse(name,html,size){
  const doc=new DOMParser().parseFromString(html,'text/html'); const body=doc.body;
  const heads=Array.from(body.querySelectorAll('h1,h2,h3,h4')).map(h=>({lvl:+h.tagName[1],text:norm(h.textContent)})).filter(h=>h.text);
  const text=norm(body.textContent);
  const words=text?text.split(' ').length:0;
  const sents=text.match(/[^.!?]+[.!?]/g)||[];
  const avgSent=sents.length?Math.round(sents.reduce((a,s)=>a+norm(s).split(' ').length,0)/sents.length):0;
  const steps=Array.from(body.querySelectorAll('ol > li')).slice(0,6).map(li=>norm(li.textContent).slice(0,140));
  return {
    name:name,size:size,words:words,heads:heads,
    tables:body.querySelectorAll('table').length,
    ol:body.querySelectorAll('ol > li').length,
    ul:body.querySelectorAll('ul > li').length,
    callouts:(text.match(/\b(WARNING|CAUTION|DANGER|NOTE|IMPORTANT)\b/g)||[]).length,
    avgSent:avgSent,steps:steps,excerpt:text.slice(0,450)
  };
}
async function fileToHtml(f){
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(f.size>15*1024*1024) throw new Error('size');
  let html;
  if(ext==='docx'){
    if(!window.mammoth) throw new Error('docx-reader');
    const buf=await f.arrayBuffer();
    const r=await window.mammoth.convertToHtml({arrayBuffer:buf},{styleMap:["p[style-name='Title'] => h1:fresh","p[style-name='Subtitle'] => h2:fresh"]});
    html=r.value;
  } else if(ext==='html'||ext==='htm'){ html=await f.text(); }
  else if(ext==='md'||ext==='markdown'||ext==='txt'){ html=textToHtml(await f.text()); }
  else throw new Error('type');
  return html;
}
async function readFile(f){ return analyse(f.name,await fileToHtml(f),f.size); }
async function addFiles(fileList){
  const files=Array.from(fileList); const problems=[]; let over=0;
  $('#upNote').textContent='Reading files...';
  for(const f of files){
    if(corpus.length>=MAXDOCS){ over++; continue; }
    if(corpus.some(d=>d.name===f.name&&d.size===f.size)) continue;
    try{ corpus.push(await readFile(f)); }
    catch(e){
      const why=e.message==='docx-reader'?'the .docx reader did not load':e.message==='type'?'use .docx, .html, .md or .txt':e.message==='size'?'over 15 MB':'could not be read';
      problems.push(f.name+' ('+why+')');
    }
  }
  const notes=[];
  if(over) notes.push(over+' not added: the limit is '+MAXDOCS+' documents.');
  if(problems.length) notes.push('Skipped: '+problems.join('; ')+'.');
  $('#upNote').textContent=notes.join(' ');
  renderGuide(); renderBusy();
}
$('#btnPick').addEventListener('click',()=>$('#fileIn').click());
$('#fileIn').addEventListener('change',e=>{ addFiles(e.target.files); e.target.value=''; });
const drop=$('#drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('drag'); }));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop',e=>{ if(e.dataTransfer&&e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
$('#files').addEventListener('click',e=>{
  const b=e.target.closest('[data-rm]'); if(!b) return;
  corpus.splice(+b.getAttribute('data-rm'),1); renderGuide(); renderBusy();
});

function headingStats(){
  const m=new Map();
  corpus.forEach(d=>{
    const seen=new Set();
    d.heads.forEach(h=>{ const k=normHead(h.text); if(!k||seen.has(k)) return; seen.add(k); const e=m.get(k)||{label:h.text,n:0}; e.n++; m.set(k,e); });
  });
  return Array.from(m.values()).sort((a,b)=>b.n-a.n).slice(0,10);
}
async function learn(){
  if(busy&&busy.kind==='learn'){ busy.ctl.abort(); return; }
  if(busy||!corpus.length) return;
  await aiReady;
  if(!aiOk){ $('#upNote').textContent=healthKnown?'The server has no Anthropic API key, so the style guide cannot be learned. Set ANTHROPIC_API_KEY and restart the server.':'Cannot reach the Versight server.'; return; }
  const n=corpus.length;
  const docs=corpus.map(d=>({name:d.name.slice(0,200),words:d.words,tables:d.tables,ol:d.ol,ul:d.ul,callouts:d.callouts,avg_sent:d.avgSent,
    heads:d.heads.slice(0,60).map(h=>({lvl:Math.min(h.lvl,6),text:h.text.slice(0,200)})),steps:d.steps.slice(0,8).map(x=>x.slice(0,140)),excerpt:d.excerpt.slice(0,450)}));
  const ctl=new AbortController(); setBusy('learn',ctl);
  $('#upNote').textContent='Learning from '+n+(n===1?' document':' documents')+'. This can take up to a minute.';
  try{
    const r=await api('/api/learn',{docs:docs},ctl.signal);
    if(!r||typeof r!=='object'||Array.isArray(r)) throw {code:'invalid_json'};
    const valid=x=>Array.isArray(x)?Array.from(new Set(x.map(Number).filter(k=>k>=1&&k<=n))):[];
    const learned=(Array.isArray(r.rules)?r.rules:[]).slice(0,24).map((x,i)=>{
      const c=valid(x&&x.followedBy).length;
      return {id:'r'+(i+1),cat:String((x&&x.category)||'General').slice(0,24),text:String((x&&x.text)||'').slice(0,400),strength:c/n>=0.8?'hard':'soft',count:c,total:n,origin:'learned',on:true,example:String((x&&x.example)||'').slice(0,200)};
    }).filter(x=>x.text);
    if(!learned.length) throw {code:'invalid_json'};
    const tpl=(Array.isArray(r.template)?r.template:[]).slice(0,14).map(t=>{
      const c=valid(t&&t.followedBy).length;
      return {section:String((t&&t.section)||'').slice(0,60),required:c/n>=0.7,count:c,total:n};
    }).filter(t=>t.section);
    guide.rules=guide.rules.filter(x=>x.origin==='custom').concat(learned);
    if(tpl.length) guide.template=tpl;
    guide.voice=String(r.voice||'').slice(0,400);
    guide.docs=corpus.map(d=>({name:d.name,words:d.words}));
    guide.headStats=headingStats();
    guide.exemplars=corpus.slice(0,3).map(d=>d.excerpt.slice(0,300));
    guide.learnedAt=Date.now();
    saveGuide();
    $('#upNote').textContent='Learned '+learned.length+' rules from '+n+(n===1?' document.':' documents.');
    renderGuide(); renderTemplate();
  }catch(e){
    $('#upNote').textContent=(e&&e.code==='cancelled')?'Stopped.':errCopy(e);
  }finally{ setBusy(null); }
}
$('#btnLearn').addEventListener('click',learn);

/* ---------- guide: render ---------- */
function renderGuide(){
  const files=$('#files');
  const items=corpus.length?corpus:[];
  files.innerHTML=items.map((d,i)=>'<div class="file"><span class="n" title="'+esc(d.name)+'">'+esc(d.name)+'</span><span class="w">'+d.words.toLocaleString()+' words</span><button class="x" type="button" data-rm="'+i+'" aria-label="Remove '+esc(d.name)+'">×</button></div>').join('');
  if(!corpus.length&&guide.docs.length){
    files.innerHTML='<div class="muted" style="font-size:12px">The rules below were learned from '+guide.docs.length+(guide.docs.length===1?' document':' documents')+'. Add files again to learn from a new set.</div>';
  }
  const need=Math.max(0,10-corpus.length);
  $('#learnHint').textContent=corpus.length?(corpus.length+(corpus.length===1?' document':' documents')+' added'+(need?'. Rules get stronger with 10 or more.':'.')):'';
  const hs=corpus.length?headingStats():guide.headStats;
  const total=corpus.length||(guide.docs||[]).length;
  $('#secHeads').hidden=!(hs&&hs.length&&total);
  $('#heads').innerHTML=(hs||[]).map(h=>'<span class="pill">'+esc(h.label)+'<b>'+h.n+'/'+total+'</b></span>').join('');
  $('#secVoice').hidden=!guide.voice;
  $('#voice').textContent=guide.voice||'';
  const learned=guide.rules.some(r=>r.origin==='learned');
  $('#rulesNote').textContent=learned?'Learned from your documents. Edit any rule, switch it between hard and soft, or turn it off. The assistant follows the rules that are on.':'Starter rules. Learning from your documents replaces them, and rules you add yourself stay.';
  $('#rules').innerHTML=guide.rules.map(r=>{
    const meta=r.origin==='learned'?'<span title="'+esc(r.example||'')+'">'+r.count+' of '+r.total+' documents</span>':r.origin==='custom'?'<span>Yours</span>':'<span>Starter</span>';
    return '<div class="rule'+(r.on?'':' off')+'" data-rid="'+esc(r.id)+'"><input type="checkbox" '+(r.on?'checked':'')+' aria-label="Use this rule" data-f="on"><div><textarea rows="2" data-f="text" aria-label="Rule text">'+esc(r.text)+'</textarea><div class="rmeta"><span class="mono">'+esc(r.id)+'</span><span>'+esc(r.cat)+'</span><button class="str '+(r.strength==='hard'?'hard':'')+'" type="button" data-f="str" title="Switch between hard and soft">'+(r.strength==='hard'?'HARD':'SOFT')+'</button>'+meta+'</div></div><button class="x" type="button" data-f="del" aria-label="Delete rule">×</button></div>';
  }).join('')||'<div class="empty">No rules yet. Add one below or learn from your documents.</div>';
  renderTemplate();
}
$('#rules').addEventListener('change',e=>{
  const row=e.target.closest('[data-rid]'); if(!row) return;
  const r=guide.rules.find(x=>x.id===row.getAttribute('data-rid')); if(!r) return;
  const f=e.target.getAttribute('data-f');
  if(f==='on'){ r.on=e.target.checked; row.classList.toggle('off',!r.on); }
  if(f==='text'){ r.text=e.target.value.slice(0,400); }
  saveGuide();
});
$('#rules').addEventListener('click',e=>{
  const row=e.target.closest('[data-rid]'); if(!row) return;
  const id=row.getAttribute('data-rid'); const r=guide.rules.find(x=>x.id===id); if(!r) return;
  const b=e.target.closest('[data-f]'); if(!b) return;
  const f=b.getAttribute('data-f');
  if(f==='str'){ r.strength=r.strength==='hard'?'soft':'hard'; saveGuide(); renderGuide(); }
  if(f==='del'){ guide.rules=guide.rules.filter(x=>x.id!==id); saveGuide(); renderGuide(); }
});
function addRule(){
  const inp=$('#newRule'); const t=norm(inp.value); if(!t) return;
  let n=1; while(guide.rules.some(r=>r.id==='c'+n)) n++;
  guide.rules.push({id:'c'+n,cat:'Custom',text:t,strength:'hard',count:0,total:0,origin:'custom',on:true});
  inp.value=''; saveGuide(); renderGuide();
}
$('#btnAddRule').addEventListener('click',addRule);
$('#newRule').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); addRule(); } });

/* ---------- init ---------- */
(function init(){
  try{ document.execCommand('defaultParagraphSeparator',false,'p'); }catch(e){}
  const saved=store.get('vs.doc');
  if(saved&&typeof saved.html==='string'&&saved.html.trim()){
    $('#docTitle').value=saved.title||'Untitled document';
    ed.innerHTML=toBlocks(saved.html,true).join('')||'<p><br></p>';
    isSample=!!saved.sample;
  } else {
    $('#docTitle').value=SAMPLE_TITLE; ed.innerHTML=SAMPLE_HTML; isSample=true;
  }
  ensureNotEmpty(); assignIds();
  $('#stSave').textContent=isSample?'Sample document with made-up content':'Draft kept in this browser';
  renderChat(); renderGuide(); renderSuggestions(); updateStatus(); updateScope(); renderBusy();
})();
})();
