const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const ACTIVE_NODE_IDS = ['N01','N02','N03'];
const NODE_ZONES = {N01:'West Entry',N02:'North Drift',N03:'Center Panel'};
const PAGE_SUBS = {
  command:'Live multi-node mine subsidence monitoring and early warning.',
  nodes:'Inspect node-level risk, health and continuous measurements.',
  ai:'Interpretable anomaly detection, trend analysis and spatial sensor fusion.',
  dataset:'Live prototype records, risk labels and training-ready telemetry.',
  alerts:'Risk transitions, recommended actions and Telegram delivery status.'
};
let nodes = {}, health = {}, stats = {}, selectedNode = 'N03', ws = null, reconnectTimer = null;
let activeView = 'command';

function fmt(v,d=1){const n=Number(v); return Number.isFinite(n)?n.toFixed(d):'0.0'}
function integer(v){return Math.round(Number(v)||0).toLocaleString()}
function levelClass(level){return String(level||'NORMAL').toLowerCase()}
function riskLevel(score){score=Number(score)||0; return score>=66?'CRITICAL':score>=36?'WARNING':'NORMAL'}
function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function riskColor(level){return level==='CRITICAL'?'#ff5869':level==='WARNING'?'#ffbe4d':'#42e3a0'}
function toast(message){const el=$('#toast'); if(!el)return; $('p',el).textContent=message; el.classList.add('show'); clearTimeout(el._timer); el._timer=setTimeout(()=>el.classList.remove('show'),2400)}
function showConnection(show){$('#connectionBanner')?.classList.toggle('show',!!show)}
function nowClock(){const d=new Date(); $('#clock').textContent=d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});} setInterval(nowClock,1000); nowClock();

async function api(path, options={}){
  const r=await fetch(path, options);
  if(!r.ok){let text='Request failed';try{text=await r.text()}catch{}; throw new Error(text||`${r.status}`)}
  return r.json();
}

function setView(view){
  activeView=view;
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
  const btn=$(`.nav-item[data-view="${view}"]`);
  $('#pageTitle').textContent=btn?.dataset.title||'NexGen Sentinel';
  $('#pageSubtitle').textContent=PAGE_SUBS[view]||'';
  if(view==='nodes') refreshNodeView();
  if(view==='dataset') loadDataset();
  if(view==='alerts') loadAlerts();
  if(view==='command') drawMainChart();
  requestAnimationFrame(()=>resizeVisibleCharts());
}
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));

function systemStatus(){
  $('#backendMini').textContent=health.status==='online'?'ONLINE':'OFFLINE';
  $('#backendDot').className='status-dot '+(health.status==='online'?'ok':'bad');
  const modelActive=health.model==='active';
  $('#modelMini').textContent=modelActive?'ACTIVE':'FALLBACK';
  $('#modelDot').className='status-dot '+(modelActive?'ok':'warn');
  const telegram=!!health.telegram;
  $('#telegramMini').textContent=telegram?'READY':'OPTIONAL';
  $('#telegramDot').className='status-dot '+(telegram?'ok':'warn');
  $('#modelStatus').textContent=modelActive?'ACTIVE':'FALLBACK';
  const tel=$('#telegramStatus'); if(tel){tel.textContent=telegram?'●  TELEGRAM READY':'●  TELEGRAM NOT CONFIGURED';tel.classList.toggle('ready',telegram)}
  if($('#telegramLabel')) $('#telegramLabel').textContent=telegram?'READY':'OPTIONAL';
}

function render(){
  systemStatus();
  const vals=ACTIVE_NODE_IDS.map(id=>nodes[id]).filter(Boolean).sort((a,b)=>String(a.node_id).localeCompare(String(b.node_id)));
  const maxNode=vals.slice().sort((a,b)=>(Number(b.risk_score)||0)-(Number(a.risk_score)||0))[0];
  const max=Number(maxNode?.risk_score)||0;
  const level=riskLevel(max);
  const warnings=vals.filter(n=>n.risk_level==='WARNING').length;
  const criticals=vals.filter(n=>n.risk_level==='CRITICAL').length;

  $('#mineRisk').textContent=Math.round(max);
  $('#riskBar').style.width=`${Math.min(100,max)}%`;
  $('#riskBar').style.background=riskColor(level);
  $('#riskGauge').style.background=`conic-gradient(${riskColor(level)} 0deg ${Math.min(100,max)*3.6}deg,#162739 ${Math.min(100,max)*3.6}deg 360deg)`;
  const badge=$('#mineStatusBadge'); badge.className=`status-badge ${levelClass(level)}`; badge.innerHTML=`<i></i>${level}`;
  $('#activeNodes').textContent=`${vals.length} / 3`;
  $('#activeAlerts').textContent=warnings+criticals;
  $('#recordCount').textContent=integer(stats.total);
  $('#riskHeadline').textContent=level==='CRITICAL'?'Critical deformation pattern detected':level==='WARNING'?'Elevated movement pattern detected':'Mine conditions stable';
  $('#mineSummary').textContent=level==='CRITICAL'?'Correlated high-severity movement requires immediate inspection of the affected panel.':level==='WARNING'?'Movement is above the current baseline. Increase monitoring and inspect the affected node cluster.':'All available nodes are within the current prototype operating envelope.';
  $('#recommendationText').textContent=level==='CRITICAL'?'Restrict access to the affected panel and initiate immediate physical inspection.':level==='WARNING'?'Increase monitoring frequency and verify the elevated sensor nodes.':'Continue standard monitoring.';

  $$('.map-node').forEach(el=>{
    const n=nodes[el.dataset.node];
    el.classList.remove('normal','warning','critical');
    el.classList.add(levelClass(n?.risk_level||'NORMAL'));
    const small=$('small',el); if(small && n) small.textContent=`${NODE_ZONES[n.node_id]} · ${Math.round(Number(n.risk_score)||0)}`;
  });
  $('#riskZone').classList.toggle('active',criticals>0 || warnings>=2);

  if(maxNode){
    const an=Number(maxNode.anomaly_score)||0, tr=Number(maxNode.trend_score)||0, sp=Number(maxNode.spatial_score)||0;
    $('#cAnomaly').textContent=`${fmt(an)}%`; $('#cTrend').textContent=`${fmt(tr)}%`; $('#cSpatial').textContent=`${fmt(sp)}%`;
    $('#barAnomaly').style.width=`${Math.min(100,an)}%`; $('#barTrend').style.width=`${Math.min(100,tr)}%`; $('#barSpatial').style.width=`${Math.min(100,sp)}%`;
    $('#aiInsight').innerHTML=`<div class="insight-orb"><span></span></div><div><small>ASSESSMENT · ${escapeHtml(maxNode.node_id)}</small><h3>${escapeHtml(maxNode.risk_level)} risk signature</h3><p>${escapeHtml(sentence(maxNode.explanation))} Current risk score: ${fmt(maxNode.risk_score)}/100.</p></div>`;
    renderAIExplain(maxNode);
  }
  $('#trainingSamples').textContent=integer(stats.training_samples);
  $('#networkSummary').textContent=`${vals.length} nodes reporting`;
  renderNodeCards(); renderDatasetStats();
}

function sentence(s){s=String(s||'').trim(); if(!s)return 'No dominant anomaly detected.'; return s.charAt(0).toUpperCase()+s.slice(1)+(s.endsWith('.')?'':'.')}
function renderAIExplain(n){
  const contributors=[];
  if(Number(n.sensor_severity)>=55) contributors.push('Physical sensor severity is elevated.');
  if(Number(n.trend_score)>=45) contributors.push('Recent readings show an increasing temporal trend.');
  if(Number(n.anomaly_score)>=60) contributors.push('The Isolation Forest flags the current feature vector as anomalous.');
  if(Number(n.spatial_score)>=35) contributors.push('Nearby nodes show correlated risk, strengthening the spatial evidence.');
  if(!contributors.length) contributors.push('Current measurements remain close to the learned baseline.');
  const el=$('#aiDetail');
  el.classList.add('active');
  el.innerHTML=`<span class="kicker">DOMINANT NODE · ${escapeHtml(n.node_id)}</span><div class="explain-risk" style="color:${riskColor(n.risk_level)}">${fmt(n.risk_score,0)} / 100</div><h3>${escapeHtml(n.risk_level)} · ${escapeHtml(NODE_ZONES[n.node_id]||n.node_id)}</h3><p>${escapeHtml(sentence(n.explanation))}</p><ul>${contributors.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
}

function renderNodeCards(){
  const wrap=$('#nodeCards'); if(!wrap)return;
  const ids=ACTIVE_NODE_IDS;
  wrap.innerHTML=ids.map(id=>{
    const n=nodes[id]||{}; const level=n.risk_level||'NORMAL';
    return `<article class="node-card ${selectedNode===id?'selected':''}" data-id="${id}">
      <div class="node-card-head"><div><div class="node-id">${id}</div><div class="node-zone">${NODE_ZONES[id]}</div></div><span class="status-badge ${levelClass(level)}"><i></i>${n.node_id?level:'OFFLINE'}</span></div>
      <div class="node-score" style="color:${riskColor(level)}">${fmt(n.risk_score,0)}</div><div class="node-score-label">RISK SCORE / 100</div>
      <div class="mini-sensors"><div><span>Tilt</span><b>${fmt(n.tilt,2)}°</b></div><div><span>Vibration</span><b>${fmt(n.vibration,2)}</b></div><div><span>Displacement</span><b>${fmt(n.displacement,2)} mm</b></div><div><span>Crack</span><b>${fmt(n.crack,2)} mm</b></div></div>
    </article>`;
  }).join('');
  $$('.node-card',wrap).forEach(card=>card.addEventListener('click',()=>{selectedNode=card.dataset.id;renderNodeCards();refreshNodeView()}));
}

async function refreshNodeView(){
  const n=nodes[selectedNode]||{}; const level=n.risk_level||'NORMAL';
  $('#selectedNodeSub').textContent=`${selectedNode} · ${NODE_ZONES[selectedNode]}`;
  const chip=$('#nodeStateChip'); chip.className=`status-badge ${levelClass(level)}`; chip.textContent=level;
  $('#nodeDetails').innerHTML=[
    ['Risk score',`${fmt(n.risk_score)} / 100`,'Hybrid risk engine'],['Battery',`${fmt(n.battery)}%`,'Node power health'],['ML anomaly',`${fmt(n.anomaly_score)}%`,'Isolation Forest'],['Temporal trend',`${fmt(n.trend_score)}%`,'Recent slope'],['Spatial score',`${fmt(n.spatial_score)}%`,'Neighbour fusion'],['Last update',shortTime(n.timestamp),'Live telemetry']
  ].map(([a,b,c])=>`<div class="detail-cell"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('');
  await drawNodeChart();
}
function shortTime(ts){try{return ts?new Date(ts).toLocaleTimeString():'—'}catch{return '—'}}

function renderDatasetStats(){if(!stats)return; $('#dsTotal').textContent=integer(stats.total);$('#dsNormal').textContent=integer(stats.normal);$('#dsWarning').textContent=integer(stats.warning);$('#dsCritical').textContent=integer(stats.critical)}

function sizeCanvas(canvas){
  const rect=canvas.getBoundingClientRect(); if(rect.width<10||rect.height<10)return null;
  const ratio=Math.min(window.devicePixelRatio||1,2); canvas.width=Math.floor(rect.width*ratio);canvas.height=Math.floor(rect.height*ratio);return {w:canvas.width,h:canvas.height,r:ratio};
}
function drawCanvas(canvas, rows, metric){
  if(!canvas)return; const size=sizeCanvas(canvas); if(!size)return; const {w,h,r}=size; const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,w,h); const pad={l:42*r,r:16*r,t:16*r,b:26*r}; const pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
  const values=rows.map(x=>Number(x[metric]||0)); if(!values.length){ctx.fillStyle='#61778b';ctx.font=`${9*r}px system-ui`;ctx.fillText('No telemetry yet',pad.l,pad.t+20*r);return}
  let min=Math.min(...values),max=Math.max(...values); if(max===min){max+=.5;min-=.5} const margin=Math.max((max-min)*.18,.08); min-=margin;max+=margin;
  ctx.lineWidth=r;ctx.strokeStyle='rgba(86,121,150,.16)';ctx.fillStyle='#536b80';ctx.font=`${7*r}px system-ui`;
  for(let i=0;i<=4;i++){const y=pad.t+(ph*i/4);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();const val=max-(max-min)*i/4;ctx.fillText(val.toFixed(2),3*r,y+2*r)}
  const grad=ctx.createLinearGradient(pad.l,0,w-pad.r,0);grad.addColorStop(0,'#1ab4dc');grad.addColorStop(1,'#42e3d2');ctx.strokeStyle=grad;ctx.lineWidth=2*r;ctx.beginPath();
  values.forEach((v,i)=>{const x=pad.l+(pw*i/Math.max(1,values.length-1));const y=pad.t+(max-v)/(max-min)*ph;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
  const fill=ctx.createLinearGradient(0,pad.t,0,h-pad.b);fill.addColorStop(0,'rgba(52,214,255,.13)');fill.addColorStop(1,'rgba(52,214,255,0)');ctx.lineTo(pad.l+pw,pad.t+ph);ctx.lineTo(pad.l,pad.t+ph);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  const last=values[values.length-1], lx=pad.l+pw,ly=pad.t+(max-last)/(max-min)*ph;ctx.beginPath();ctx.arc(lx,ly,3*r,0,Math.PI*2);ctx.fillStyle='#42e3d2';ctx.fill();ctx.beginPath();ctx.arc(lx,ly,6*r,0,Math.PI*2);ctx.strokeStyle='rgba(66,227,210,.22)';ctx.stroke();
  ctx.fillStyle='#6b8195';ctx.font=`${7*r}px system-ui`; const label=`${metric.toUpperCase()} · ${fmt(last,2)} · ${values.length} samples`;ctx.fillText(label,pad.l,h-7*r);
}
async function drawMainChart(){try{const metric=$('#chartMetric').value;const hist=await api(`/api/history/${selectedNode}?limit=70`);drawCanvas($('#trendChart'),hist,metric);$('#chartNodeLabel').textContent=`Node ${selectedNode} · ${metric}`;}catch(e){}}
async function drawNodeChart(){try{const metric=$('#nodeMetric').value;const hist=await api(`/api/history/${selectedNode}?limit=70`);drawCanvas($('#nodeChart'),hist,metric);}catch(e){}}
function resizeVisibleCharts(){if(activeView==='command')drawMainChart();if(activeView==='nodes')drawNodeChart()}
window.addEventListener('resize',()=>{clearTimeout(window._resize);window._resize=setTimeout(resizeVisibleCharts,120)});
$('#chartMetric').addEventListener('change',drawMainChart); $('#nodeMetric').addEventListener('change',drawNodeChart);
$$('.map-node').forEach(n=>n.addEventListener('click',()=>{selectedNode=n.dataset.node; setView('nodes')}));

async function loadDataset(){
  try{
    const [newStats, rows]=await Promise.all([api('/api/dataset/stats'),api('/api/dataset/recent?limit=80')]); stats=newStats;renderDatasetStats();
    const tbody=$('#datasetRows');
    tbody.innerHTML=rows.length?rows.map(r=>`<tr><td>${escapeHtml(shortTime(r.timestamp))}</td><td><b>${escapeHtml(r.node_id)}</b></td><td>${fmt(r.tilt,2)}</td><td>${fmt(r.vibration,2)}</td><td>${fmt(r.displacement,2)}</td><td>${fmt(r.crack,2)}</td><td>${fmt(r.anomaly_score)}%</td><td><b>${fmt(r.risk_score)}</b></td><td><span class="risk-pill ${levelClass(r.risk_level)}">${escapeHtml(r.risk_level)}</span></td></tr>`).join(''):'<tr><td colspan="9" class="table-empty">No records yet.</td></tr>';
  }catch(e){toast(`Dataset error: ${e.message}`)}
}
$('#datasetRefresh').addEventListener('click',loadDataset);
$('#csvImportBtn').addEventListener('click',()=>$('#csvInput').click());
$('#csvInput').addEventListener('change',async(e)=>{
  const file=e.target.files?.[0]; if(!file)return;
  try{
    toast(`Importing ${file.name}…`);
    const text=await file.text();
    const result=await api('/api/dataset/import.csv',{method:'POST',headers:{'Content-Type':'text/csv'},body:text});
    toast(`Imported ${result.imported} rows${result.skipped?`, skipped ${result.skipped}`:''}`);
    await refreshAll(); await loadDataset();
  }catch(err){toast(`CSV import failed: ${err.message}`)}finally{e.target.value=''}
});

async function loadAlerts(){
  try{
    const rows=await api('/api/alerts?limit=60');
    const warning=rows.filter(x=>x.risk_level==='WARNING').length, critical=rows.filter(x=>x.risk_level==='CRITICAL').length;
    $('#warningCount').textContent=warning;$('#criticalCount').textContent=critical;
    const el=$('#alertList');el.innerHTML=rows.length?rows.map(a=>`<article class="alert-event ${levelClass(a.risk_level)}"><div class="alert-icon">${a.risk_level==='CRITICAL'?'!':'▲'}</div><div><h3>${escapeHtml(a.risk_level)} · ${escapeHtml(a.node_id)} · Risk ${fmt(a.risk_score)}</h3><p>${escapeHtml(compactAlert(a.message))}</p></div><time>${escapeHtml(shortTime(a.timestamp))}</time></article>`).join(''):'<div class="empty-state">No warning or critical transitions yet. Run a demo scenario to populate this timeline.</div>';
  }catch(e){toast(`Alert error: ${e.message}`)}
}
function compactAlert(message){const lines=String(message||'').split('\n').filter(Boolean);return lines.slice(0,6).join(' · ')}
$('#alertRefresh').addEventListener('click',loadAlerts);

$('#trainBtn').addEventListener('click',async()=>{
  const btn=$('#trainBtn'), msg=$('#trainMsg');btn.disabled=true;msg.textContent='Training Isolation Forest on recent stored telemetry…';
  try{const r=await api('/api/model/train',{method:'POST'});msg.textContent=`✓ ${r.message}`;toast('AI model retrained successfully');await refreshAll()}catch(e){msg.textContent=`Training failed: ${e.message}`;toast('Model training failed')}finally{btn.disabled=false}
});

$$('.scenario-btn').forEach(btn=>btn.addEventListener('click',async()=>{
  const scenario=btn.dataset.scenario; $$('.scenario-btn').forEach(x=>x.disabled=true);toast(`Running ${scenario} scenario through the live pipeline…`);
  try{await api(`/api/simulate/${scenario}`,{method:'POST'});await refreshAll();if(activeView==='alerts')await loadAlerts(); if(scenario==='subsidence'||scenario==='critical')setTimeout(()=>loadAlerts(),300)}catch(e){toast(`Simulation error: ${e.message}`)}finally{$$('.scenario-btn').forEach(x=>x.disabled=false)}
}));

$('#refreshBtn').addEventListener('click',()=>refreshAll(true));
async function refreshAll(manual=false){
  try{
    const [h,n,s]=await Promise.all([api('/api/health'),api('/api/nodes'),api('/api/dataset/stats')]);health=h;nodes=Object.fromEntries(n.map(x=>[x.node_id,x]));stats=s;render();showConnection(false);
    if(activeView==='command')await drawMainChart(); if(activeView==='nodes')await refreshNodeView(); if(activeView==='dataset')await loadDataset(); if(activeView==='alerts')await loadAlerts();
    if(manual)toast('Live data refreshed');
  }catch(e){health={status:'offline',model:'fallback',telegram:false};systemStatus();showConnection(true);toast(`Backend unavailable: ${e.message}`)}
}

function connectWS(){
  if(ws && [WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState))return;
  const protocol=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${protocol}://${location.host}/ws`);
  ws.onopen=()=>{showConnection(false);try{ws.send('sentinel-online')}catch{}};
  ws.onmessage=(e)=>{try{const m=JSON.parse(e.data);if(m.type!=='reading'||!ACTIVE_NODE_IDS.includes(m.data.node_id))return;nodes[m.data.node_id]=m.data;stats.total=(Number(stats.total)||0)+1;const k=levelClass(m.data.risk_level);stats[k]=(Number(stats[k])||0)+1;render();if(activeView==='command')drawMainChart();if(activeView==='nodes'&&m.data.node_id===selectedNode)refreshNodeView();if(activeView==='dataset')debouncedDataset();}catch{}};
  ws.onclose=()=>{showConnection(true);clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectWS,1400)};
  ws.onerror=()=>{try{ws.close()}catch{}};
}
let dsTimer;function debouncedDataset(){clearTimeout(dsTimer);dsTimer=setTimeout(loadDataset,550)}

refreshAll().then(()=>{connectWS();loadAlerts()});
