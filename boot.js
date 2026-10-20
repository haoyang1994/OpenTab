(function(g){
try{performance.mark('opentab:boot-start')}catch(e){}
var K='opentab.boot.v1',D='assets/default_background/default.webp';
var r=document.documentElement,b=document.body,L=document.getElementById('background-layer');
var painted=0;
function go(fn){if(painted){fn();return}var run=function(){painted=1;fn()};typeof requestAnimationFrame==='function'?requestAnimationFrame(function(){requestAnimationFrame(run)}):setTimeout(run,0)}
function cl(n,a,z,d){n=Number(n);return isFinite(n)?Math.min(z,Math.max(a,n)):d}
function hue(h,el){h=Number(h)||200;(el||r).style.setProperty('--accent-hue',String(h));return h}
function op(raw,el){
  var v=cl(raw,12,70,32),a=v/100,s=(el||r).style;
  s.setProperty('--ui-frame-opacity',a.toFixed(2));
  s.setProperty('--ui-frame-opacity-strong',Math.min(a+.1,.88).toFixed(2));
  s.setProperty('--ui-frame-opacity-soft',Math.max(.04,a*.42).toFixed(2));
  s.setProperty('--ui-frame-opacity-soft-strong',Math.max(.08,a*.68).toFixed(2));
  s.setProperty('--ui-border-opacity',Math.min(.58,Math.max(.18,a*.95)).toFixed(2));
  return v;
}
function bl(raw,el){
  var s=cl(raw,0,20,10),x=(el||r).style;
  x.setProperty('--ui-blur-strong',s+'px');
  x.setProperty('--ui-blur-medium',Math.max(0,s-2)+'px');
  return s;
}
function th(m,el){
  el=el||b;if(!el)return;el.classList.remove('theme-dark','theme-light');
  if(m==='light'||(m==='auto'&&!matchMedia('(prefers-color-scheme: dark)').matches))el.classList.add('theme-light');
}
function loc(u){return typeof u==='string'&&(u.indexOf('assets/')===0||u.indexOf('/assets/')!==-1)}
function cover(el,img){var s=el.style;s.backgroundSize='cover';s.backgroundPosition='center';s.backgroundImage=img}
function bg(x,el){
  el=el||L;if(!el)return;x=x||{};el.classList.remove('boot-lqip');
  if(x.kind==='gradient'&&x.css){el.style.backgroundImage='none';el.style.background=x.css;return}
  var u=x.css||x.url||D;
  if(x.kind==='image'&&loc(u)){var img=u.indexOf('url(')===0?u:'url('+u+')';go(function(){el.style.background='';cover(el,img)});return}
  var c='#05070d';
  try{c=getComputedStyle(r).getPropertyValue('--bg-base')||c}catch(e){}
  el.style.background=x.color||c;
  if(x.lqip){el.classList.add('boot-lqip');go(function(){cover(el,'url('+x.lqip+')')})}
}
function read(){
  try{
    var raw=localStorage.getItem(K);
    if(!raw||raw.length>8192){if(raw)localStorage.removeItem(K);return null}
    var d=JSON.parse(raw);
    if(!d||d.v!==1){localStorage.removeItem(K);return null}
    return d;
  }catch(e){try{localStorage.removeItem(K)}catch(e2){}return null}
}
function write(d){
  try{
    var data=Object.assign({v:1},d||{}),json=JSON.stringify(data);
    if(json.length>8192&&data.bg){data.bg.lqip='';json=JSON.stringify(data)}
    if(json.length>8192)return;localStorage.setItem(K,json);
  }catch(e){}
}
function def(){th('dark');hue(200);op(32);bl(10);bg({kind:'image',url:D})}
function clk(m){
  var t=document.getElementById('time');if(!t)return!1;
  try{
    var z=(m&&m.tz)||Intl.DateTimeFormat().resolvedOptions().timeZone,h=!m||m.clockFormat!=='24h';
    t.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:z,hour:'2-digit',minute:'2-digit',hour12:h}).formatToParts(new Date()).filter(function(p){return p.type!=='dayPeriod'}).map(function(p){return p.value}).join('').trim();
    var l=document.getElementById('timezone-label');if(l)l.textContent=(m&&m.tzLabel)||z;
  }catch(e){}
  return!0;
}
try{
  var m=read();
  if(!m)def();
  else{
    th(m.theme||'dark');hue(m.accentHue);op(m.uiOpacity);bl(m.uiBlur);
    if(m.minimalMode&&b)b.classList.add('minimal-mode');
    bg(m.bg);
  }
  if(!clk(m)){var o=new MutationObserver(function(){if(clk(m))o.disconnect()});o.observe(r,{childList:!0,subtree:!0})}
}catch(e){try{def()}catch(e3){}}
try{performance.mark('opentab:boot-applied');performance.measure('opentab:boot','opentab:boot-start','opentab:boot-applied')}catch(e){}
g.OpenTabBoot={KEY:K,DEFAULT_BG:D,applyAccentHue:hue,applyUiOpacity:op,applyUiBlur:bl,applyTheme:th,readMirror:read,writeMirror:write,applyBackground:bg,isLocalAsset:loc};
})(globalThis);
