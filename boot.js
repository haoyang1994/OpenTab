(function(g){
try{performance.mark('opentab:boot-start')}catch(e){}
var K='opentab.boot.v1',D='assets/default_background/default.webp',r=document.documentElement,b=document.body,L=document.getElementById('background-layer'),painted=0;
function $(i){return document.getElementById(i)}
function go(fn){if(painted){fn();return}var run=function(){painted=1;fn()};requestAnimationFrame?requestAnimationFrame(function(){requestAnimationFrame(run)}):setTimeout(run,0)}
function cl(n,a,z,d){n=Number(n);return isFinite(n)?Math.min(z,Math.max(a,n)):d}
function hue(h,el){h=Number(h)||200;(el||r).style.setProperty('--accent-hue',String(h));return h}
function op(raw,el){var v=cl(raw,12,70,32),a=v/100,s=(el||r).style,p=function(k,x){s.setProperty(k,x.toFixed(2))};p('--ui-frame-opacity',a);p('--ui-frame-opacity-strong',Math.min(a+.1,.88));p('--ui-frame-opacity-soft',Math.max(.04,a*.42));p('--ui-frame-opacity-soft-strong',Math.max(.08,a*.68));p('--ui-border-opacity',Math.min(.58,Math.max(.18,a*.95)));return v}
function bl(raw,el){var s=cl(raw,0,20,10),x=(el||r).style;x.setProperty('--ui-blur-strong',s+'px');x.setProperty('--ui-blur-medium',Math.max(0,s-2)+'px');return s}
function th(m,el){el=el||b;if(!el)return;el.classList.remove('theme-dark','theme-light');if(m==='light'||(m==='auto'&&!matchMedia('(prefers-color-scheme: dark)').matches))el.classList.add('theme-light')}
function loc(u){return typeof u==='string'&&(u.startsWith('assets/')||u.startsWith('chrome-extension://'))}
function cover(el,img){var s=el.style;s.backgroundSize='cover';s.backgroundPosition='center';s.backgroundImage=img}
function bg(x,el){el=el||L;if(!el)return;x=x||{};el.classList.remove('boot-lqip');if(x.kind==='gradient'&&x.css){el.style.backgroundImage='none';el.style.background=x.css;return}var u=x.css||x.url||D;if(x.kind==='image'&&loc(u)){var img=u.indexOf('url(')===0?u:'url('+u+')';go(function(){el.style.background='';cover(el,img)});return}var c='#05070d';try{c=getComputedStyle(r).getPropertyValue('--bg-base')||c}catch(e){}el.style.background=x.color||c;if(x.lqip){el.classList.add('boot-lqip');go(function(){cover(el,'url('+x.lqip+')')})}}
function read(){try{var raw=localStorage.getItem(K);if(!raw||raw.length>8192){if(raw)localStorage.removeItem(K);return null}var d=JSON.parse(raw);if(!d||d.v!==1){localStorage.removeItem(K);return null}return d}catch(e){try{localStorage.removeItem(K)}catch(e2){}return null}}
function write(d){try{var data=Object.assign({v:1},d||{}),json=JSON.stringify(data);if(json.length>8192&&data.bg){data.bg.lqip='';json=JSON.stringify(data)}if(json.length>8192)return;localStorage.setItem(K,json)}catch(e){}}
function def(){th('dark');hue(200);op(32);bl(10);bg({kind:'image',url:D})}
function clk(m){var t=$('time'),a=$('ampm'),d=$('date');if(!t||!a||!d)return!1;try{var z=(m&&m.tz)||Intl.DateTimeFormat().resolvedOptions().timeZone,h=!m||m.clockFormat!=='24h',n=new Date(),o={timeZone:z,hour:'2-digit',minute:'2-digit',hour12:h};if(m&&m.showSeconds)o.second='2-digit';t.textContent=new Intl.DateTimeFormat('zh-CN',o).format(n).replace(/[^0-9:]/g,'');if(h){a.textContent=n.toLocaleTimeString('zh-CN',{timeZone:z,hour:'numeric',hour12:!0}).indexOf('下午')<0?'AM':'PM';a.style.display='block'}else{a.textContent='';a.style.display='none'}d.textContent=n.toLocaleDateString('zh-CN',{timeZone:z,year:'numeric',month:'long',day:'numeric',weekday:'long'});var l=$('timezone-label');if(l)l.textContent=(m&&m.tzLabel)||z}catch(e){}return!0}
try{var m=read();if(!m)def();else{th(m.theme||'dark');hue(m.accentHue);op(m.uiOpacity);bl(m.uiBlur);if(m.minimalMode&&b)b.classList.add('minimal-mode');bg(m.bg)}if(!clk(m)){var o=new MutationObserver(function(){if(clk(m))o.disconnect()});o.observe(r,{childList:!0,subtree:!0})}}catch(e){try{def()}catch(e3){}}
try{performance.mark('opentab:boot-applied');performance.measure('opentab:boot','opentab:boot-start','opentab:boot-applied')}catch(e){}
g.OpenTabBoot={KEY:K,DEFAULT_BG:D,applyAccentHue:hue,applyUiOpacity:op,applyUiBlur:bl,applyTheme:th,readMirror:read,writeMirror:write,applyBackground:bg,isLocalAsset:loc};
})(globalThis);
