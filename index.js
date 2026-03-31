const express=require('express');
const axios=require('axios');
const app=express();
const PORT=process.env.PORT||3000;
const GHL_API_KEY=process.env.GHL_API_KEY||'';
const GHL_LOCATION_ID=process.env.GHL_LOCATION_ID||'';

const ALLOWED_PIPELINE_IDS=['EWGmXwXP63Da5eBMNiDU','jfhZWICxnmISGllte9Rv'];
const INSTALL_DATE_FIELD_ID='j3gHe7eeXd2yfujzpln8';
const REVENUE_FIELD_ID='dScpoYWZbeghBsAMBR4o';
const PIPELINE_NAMES={'EWGmXwXP63Da5eBMNiDU':'Knocking Pipeline','jfhZWICxnmISGllte9Rv':'Estimator Pipeline'};
const STAGE_NAMES={
  '7ee61ae8-7b86-4300-bdf7-d7a0fa4d8471':'Change Order',
  '7f686159-9e37-4ffb-9311-3f10106cf250':'Closed',
  '9f6304dd-c1c7-4720-a94b-ccbb6c5bc149':'Scheduled but Unassigned',
  '6f59c233-0909-42bf-88ca-9633201fea4b':'Install Scheduled',
  '06d6116f-3372-49f1-92ce-07ccb360985c':'Install Complete',
  '865e11ce-f9d3-4632-856a-f4bc98a996a5':'Completed Paid and Unpaid',
  '04d32879-cd69-4001-8efe-09f2b4675d62':'New Leads',
  '72a74bdf-a2ab-4412-89b0-52142a1e8c0b':'Closed',
  '04ca42f5-6b23-4d8a-a2fa-3edb9eafe9ba':'Scheduled but Unassigned',
  '4335186c-102f-4d63-99d0-ea6d474b7649':'Scheduled Install',
  '6852e765-eb65-4a0f-b22e-5c9a63bc803b':'Completed not paid',
  '5038b345-7127-4c9d-8360-93d5b86e9ff7':'Completed and Paid'
};

async function getAllOpportunities(){
  let all=[],page=1,hasMore=true;
  while(hasMore){
    try{
      const r=await axios.get('https://services.leadconnectorhq.com/opportunities/search',{
        headers:{Authorization:'Bearer '+GHL_API_KEY,Version:'2021-07-28'},
        params:{location_id:GHL_LOCATION_ID,limit:100,page,status:'open'}
      });
      const ops=r.data?.opportunities||[];
      all=all.concat(ops);
      hasMore=ops.length===100;
      page++;
    }catch(e){console.error('GHL API error:',e.response?.data||e.message);hasMore=false;}
  }
  return all;
}

function getInstallDate(opp){
  const fields=opp.customFields||[];
  for(const f of fields){
    if(f.id===INSTALL_DATE_FIELD_ID){
      const val=f.fieldValueDate||f.value||null;
      if(!val)return null;
      const ts=parseInt(val);
      const d=new Date(ts>9999999999?ts:ts*1000);
      return isNaN(d)?null:d.toISOString().slice(0,10);
    }
  }
  return null;
}

function getRevenue(opp){
  const fields=opp.customFields||[];
  for(const f of fields){
    if(f.id===REVENUE_FIELD_ID){return parseFloat(f.fieldValueNumber||0)||0;}
  }
  return parseFloat(opp.monetaryValue||opp.value||0)||0;
}

app.get('/api/calendar',async(req,res)=>{
  try{
    const opps=await getAllOpportunities();
    const byDate={};
    for(const opp of opps){
      if(!ALLOWED_PIPELINE_IDS.includes(opp.pipelineId))continue;
      const date=getInstallDate(opp);
      if(!date)continue;
      const revenue=getRevenue(opp);
      const pipelineName=PIPELINE_NAMES[opp.pipelineId]||opp.pipelineId;
      const stageName=STAGE_NAMES[opp.pipelineStageId]||opp.pipelineStageId||'';
      if(!byDate[date])byDate[date]={date,revenue:0,jobs:[],count:0};
      byDate[date].revenue+=revenue;
      byDate[date].count++;
      byDate[date].jobs.push({name:opp.name||opp.contact?.name||'Unknown',revenue,pipeline:pipelineName,stage:stageName});
    }
    res.json({success:true,data:Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date))});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/',(req,res)=>{
  res.send(`<!DOCTYPE html>
<html><head><title>Revenue Calendar - Turf Time</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;padding:24px}
.wrap{max-width:1100px;margin:0 auto}
.hdr{text-align:center;margin-bottom:28px}
.hdr h1{font-size:28px;color:#fff;margin-bottom:4px}
.hdr p{color:#555;font-size:13px}
.controls{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:24px}
.nav-btn{background:#1a1a1a;border:1px solid #2a2a2a;color:#ccc;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}
.nav-btn:hover{background:#222;color:#fff}
.month-label{font-size:20px;font-weight:700;color:#fff;min-width:200px;text-align:center}
.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px}
.sum-card{background:#141414;border:1px solid #1e1e1e;border-radius:12px;padding:18px;text-align:center}
.sum-card .val{font-size:24px;font-weight:700;color:#4caf50;margin-bottom:4px}
.sum-card .lbl{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.5px}
.calendar{background:#111;border:1px solid #1a1a1a;border-radius:14px;overflow:hidden}
.dow-header{display:grid;grid-template-columns:repeat(7,1fr);background:#141414;border-bottom:1px solid #1a1a1a}
.dow{padding:10px;text-align:center;font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.5px}
.grid{display:grid;grid-template-columns:repeat(7,1fr)}
.cell{min-height:100px;padding:8px;border-right:1px solid #161616;border-bottom:1px solid #161616;transition:background .15s;position:relative}
.cell:hover{background:#181818}
.cell.empty{background:#0d0d0d;cursor:default}
.cell.today{border:2px solid #4caf50}
.day-num{font-size:12px;color:#444;margin-bottom:6px;font-weight:600}
.cell.today .day-num{color:#4caf50}
.cell.has-jobs .day-num{color:#ccc}
.revenue-bar{width:100%;height:4px;border-radius:2px;margin-bottom:6px;background:#1a1a1a}
.revenue-fill{height:100%;border-radius:2px;transition:width .3s}
.rev-amount{font-size:13px;font-weight:700;margin-bottom:3px}
.job-count{font-size:11px;color:#666}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);display:none;align-items:center;justify-content:center;z-index:100}
.modal{background:#141414;border:1px solid #222;border-radius:14px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto}
.modal h2{font-size:18px;color:#fff;margin-bottom:4px}
.modal .date-sub{font-size:12px;color:#555;margin-bottom:16px}
.modal-total{background:#0d2e0d;border:1px solid #1e5c1e;border-radius:8px;padding:12px;margin-bottom:16px;text-align:center}
.modal-total .t-val{font-size:22px;font-weight:700;color:#4caf50}
.modal-total .t-lbl{font-size:11px;color:#2e7d32;text-transform:uppercase}
.job-item{background:#1a1a1a;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:8px}
.job-name{font-size:14px;font-weight:600;color:#fff;margin-bottom:4px}
.job-meta{font-size:12px;color:#666}
.job-rev{font-size:14px;font-weight:700;color:#4caf50;float:right;margin-top:-20px}
.close-btn{background:#1a1a1a;border:1px solid #333;color:#aaa;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:16px;width:100%}
.close-btn:hover{background:#222;color:#fff}
.loading{text-align:center;padding:60px;color:#444}
.spinner{width:32px;height:32px;border:3px solid #1a1a1a;border-top-color:#4caf50;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
.error-msg{text-align:center;padding:40px;color:#f44336}
</style>
</head><body>
<div class="wrap">
<div class="hdr"><h1>📅 Revenue Calendar</h1><p>Turf Time · Knocking &amp; Estimator Pipelines</p></div>
<div class="controls">
  <button class="nav-btn" onclick="changeMonth(-1)">← Prev</button>
  <div class="month-label" id="monthLabel"></div>
  <button class="nav-btn" onclick="changeMonth(1)">Next →</button>
</div>
<div class="summary">
  <div class="sum-card"><div class="val" id="sumRevenue">$0</div><div class="lbl">Month Revenue</div></div>
  <div class="sum-card"><div class="val" id="sumJobs" style="color:#42a5f5">0</div><div class="lbl">Jobs Scheduled</div></div>
  <div class="sum-card"><div class="val" id="sumAvg" style="color:#ff9800">$0</div><div class="lbl">Avg Per Job</div></div>
</div>
<div class="calendar">
  <div class="dow-header">
    <div class="dow">Sun</div><div class="dow">Mon</div><div class="dow">Tue</div>
    <div class="dow">Wed</div><div class="dow">Thu</div><div class="dow">Fri</div><div class="dow">Sat</div>
  </div>
  <div class="grid" id="calGrid"><div class="loading"><div class="spinner"></div>Loading jobs...</div></div>
</div>
</div>
<div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
  <div class="modal">
    <h2 id="modalDate"></h2>
    <div class="date-sub" id="modalSub"></div>
    <div class="modal-total"><div class="t-val" id="modalTotal"></div><div class="t-lbl">Total Revenue</div></div>
    <div id="modalJobs"></div>
    <button class="close-btn" onclick="closeModal()">Close</button>
  </div>
</div>
<script>
var allData={};
var currentYear=new Date().getFullYear();
var currentMonth=new Date().getMonth();
var maxRev=0;
function fmt(n){return '$'+n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});}
function getColor(rev){
  if(rev<=0)return null;
  if(rev<2000)return '#1b5e20';
  if(rev<5000)return '#2e7d32';
  if(rev<10000)return '#388e3c';
  if(rev<20000)return '#43a047';
  if(rev<40000)return '#4caf50';
  return '#66bb6a';
}
async function loadData(){
  try{
    const r=await fetch('/api/calendar');
    const d=await r.json();
    if(!d.success)throw new Error(d.error||'Failed');
    allData={};
    for(const item of d.data){allData[item.date]=item;}
    maxRev=Math.max(...d.data.map(x=>x.revenue),1);
    renderCalendar();
  }catch(e){
    document.getElementById('calGrid').innerHTML='<div class="error-msg" style="grid-column:span 7">Error: '+e.message+'<br><button onclick="loadData()" style="margin-top:12px;background:#1a1a1a;border:1px solid #333;color:#ccc;padding:8px 16px;border-radius:6px;cursor:pointer">Retry</button></div>';
  }
}
function renderCalendar(){
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('monthLabel').textContent=months[currentMonth]+' '+currentYear;
  var first=new Date(currentYear,currentMonth,1);
  var last=new Date(currentYear,currentMonth+1,0);
  var startDow=first.getDay();
  var today=new Date().toISOString().slice(0,10);
  var grid=document.getElementById('calGrid');
  var html='';
  var monthRev=0,monthJobs=0;
  for(var i=0;i<startDow;i++)html+='<div class="cell empty"></div>';
  for(var d=1;d<=last.getDate();d++){
    var pad=String(d).padStart(2,'0');
    var dateStr=currentYear+'-'+String(currentMonth+1).padStart(2,'0')+'-'+pad;
    var info=allData[dateStr];
    var isToday=dateStr===today;
    var hasJobs=info&&info.count>0;
    if(hasJobs){monthRev+=info.revenue;monthJobs+=info.count;}
    var cls='cell'+(isToday?' today':'')+(hasJobs?' has-jobs':'');
    html+='<div class="'+cls+'"'+(hasJobs?' data-date="'+dateStr+'" onclick="showDay(this.dataset.date)" style="cursor:pointer"':'')+'>'; 
    html+='<div class="day-num">'+d+'</div>';
    if(hasJobs){
      var pct=Math.min(100,Math.round(info.revenue/maxRev*100));
      var col=getColor(info.revenue);
      html+='<div class="revenue-bar"><div class="revenue-fill" style="width:'+pct+'%;background:'+col+'"></div></div>';
      html+='<div class="rev-amount" style="color:'+col+'">'+fmt(info.revenue)+'</div>';
      html+='<div class="job-count">'+info.count+' job'+(info.count!==1?'s':'')+'</div>';
    }
    html+='</div>';
  }
  var rem=(startDow+last.getDate())%7;
  if(rem>0)for(var i=rem;i<7;i++)html+='<div class="cell empty"></div>';
  grid.innerHTML=html;
  document.getElementById('sumRevenue').textContent=fmt(monthRev);
  document.getElementById('sumJobs').textContent=monthJobs;
  document.getElementById('sumAvg').textContent=monthJobs>0?fmt(monthRev/monthJobs):'$0';
}
function changeMonth(dir){
  currentMonth+=dir;
  if(currentMonth>11){currentMonth=0;currentYear++;}
  if(currentMonth<0){currentMonth=11;currentYear--;}
  renderCalendar();
}
function showDay(dateStr){
  var info=allData[dateStr];
  if(!info)return;
  var d=new Date(dateStr+'T12:00:00');
  var opts={weekday:'long',year:'numeric',month:'long',day:'numeric'};
  document.getElementById('modalDate').textContent=d.toLocaleDateString('en-US',opts);
  document.getElementById('modalSub').textContent=info.count+' job'+(info.count!==1?'s':'')+' scheduled';
  document.getElementById('modalTotal').textContent=fmt(info.revenue);
  var jobsHtml='';
  var sorted=info.jobs.slice().sort((a,b)=>b.revenue-a.revenue);
  for(var j of sorted){
    jobsHtml+='<div class="job-item">';
    jobsHtml+='<div class="job-name">'+j.name+'</div>';
    jobsHtml+='<div class="job-meta">'+j.pipeline+(j.stage?' · '+j.stage:'')+'</div>';
    jobsHtml+='<div class="job-rev">'+fmt(j.revenue)+'</div>';
    jobsHtml+='</div>';
  }
  document.getElementById('modalJobs').innerHTML=jobsHtml;
  document.getElementById('modalOverlay').style.display='flex';
}
function closeModal(e){
  if(!e||e.target===document.getElementById('modalOverlay'))
    document.getElementById('modalOverlay').style.display='none';
}
loadData();
setInterval(loadData,5*60*1000);
</script>
</body></html>`);
});

app.listen(PORT,'0.0.0.0',()=>console.log('Revenue Calendar running on port '+PORT));
