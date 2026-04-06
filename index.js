const express=require('express');
const axios=require('axios');
const app=express();
const PORT=process.env.PORT||3000;
const GHL_API_KEY=process.env.GHL_API_KEY||'';
const GHL_LOCATION_ID=process.env.GHL_LOCATION_ID||'';

const ALLOWED_PIPELINE_IDS=['EWGmXwXP63Da5eBMNiDU','jfhZWICxnmISGllte9Rv'];
const WEEKLY_CAPACITY=250000;
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

const CREW_CALENDAR_IDS={
  'Cody':'YwDVLD5gSqcTws1JFL40',
  'Kevin':'bLgQlUtXaEn8NUbCgLWf',
  'Joel':'kffGMRfcVPuoLPnh6lVe',
  'Scott':'sfqmiQ2hETw51PYCWw2f'
};

const DAY_LIMITS={1:7,2:4,3:5,4:5,5:3};

function getFieldByKey(fields,key){
  if(!fields||!fields.length)return null;
  for(const f of fields){
    const k=f.fieldKey||f.key||f.name||'';
    if(k===key||k.endsWith('.'+key.split('.').pop())){
      return f.fieldValue||f.value||f.fieldValueDate||f.fieldValueNumber||null;
    }
  }
  return null;
}

function parseDate(val){
  if(!val)return null;
  const str=String(val).trim();
  if(/^\d+$/.test(str)){
    const ts=parseInt(str);
    const d=new Date(ts>9999999999?ts:ts*1000);
    return isNaN(d.getTime())?null:d.toISOString().slice(0,10);
  }
  const d=new Date(str);
  return isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}

function getInstallDate(opp){
  const fields=opp.customFields||[];
  const val=getFieldByKey(fields,'opportunity.install_date')||getFieldByKey(fields,'contact.install_date');
  return parseDate(val);
}

function getRevenue(opp){
  const fields=opp.customFields||[];
  const val=getFieldByKey(fields,'opportunity.price')||getFieldByKey(fields,'contact.job_price');
  if(val!==null&&val!==undefined){
    const n=parseFloat(String(val).replace(/[^0-9.]/g,''));
    if(!isNaN(n))return n;
  }
  return parseFloat(opp.monetaryValue||opp.value||0)||0;
}

function normalizeName(name){
  if(!name)return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g,'').trim();
}

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

async function getCalendarAppointments(calendarId,crewName){
  const appointments=[];
  try{
    const startTime=new Date();
    startTime.setMonth(startTime.getMonth()-6);
    const endTime=new Date();
    endTime.setMonth(endTime.getMonth()+6);
    const startMs=startTime.getTime();
    const endMs=endTime.getTime();
    let page=1,hasMore=true;
    while(hasMore){
      const r=await axios.get('https://services.leadconnectorhq.com/calendars/events',{
        headers:{Authorization:'Bearer '+GHL_API_KEY,Version:'2021-07-28'},
        params:{
          locationId:GHL_LOCATION_ID,
          calendarId,
          startTime:startMs,
          endTime:endMs,
          limit:100,
          page
        }
      });
      const events=r.data?.events||r.data?.appointments||[];
      for(const ev of events){
        const start=ev.startTime||ev.start||ev.appointmentDate||null;
        if(!start)continue;
        const date=new Date(start).toISOString().slice(0,10);
        const title=ev.title||ev.contactName||ev.name||'Unknown';
        appointments.push({date,name:title,crew:crewName,id:ev.id||ev._id||null});
      }
      hasMore=events.length===100;
      page++;
    }
  }catch(e){console.error('Calendar API error for '+crewName+':',e.response?.data||e.message);}
  return appointments;
}

app.get('/api/calendar',async(req,res)=>{
  try{
    const opps=await getAllOpportunities();
    const calendarPromises=Object.entries(CREW_CALENDAR_IDS).map(([crew,id])=>getCalendarAppointments(id,crew));
    const calendarResults=await Promise.all(calendarPromises);
    const allAppointments=calendarResults.flat();
    const byDate={};

    for(const opp of opps){
      if(!ALLOWED_PIPELINE_IDS.includes(opp.pipelineId))continue;
      const date=getInstallDate(opp);
      if(!date)continue;
      const revenue=getRevenue(opp);
      const pipelineName=PIPELINE_NAMES[opp.pipelineId]||opp.pipelineId;
      const stageName=STAGE_NAMES[opp.pipelineStageId]||opp.pipelineStageId||'';
      const name=opp.name||opp.contact?.name||'Unknown';
      if(!byDate[date])byDate[date]={date,revenue:0,jobs:[],count:0};
      byDate[date].revenue+=revenue;
      byDate[date].count++;
      byDate[date].jobs.push({
        name,revenue,
        pending:revenue<=0,
        pipeline:pipelineName,
        stage:stageName,
        source:'opportunity',
        normalizedName:normalizeName(name)
      });
    }

    for(const appt of allAppointments){
      const {date,name,crew}=appt;
      const normalizedAppt=normalizeName(name);
      if(!byDate[date])byDate[date]={date,revenue:0,jobs:[],count:0};
      const isDuplicate=byDate[date].jobs.some(j=>j.normalizedName===normalizedAppt);
      if(isDuplicate)continue;
      byDate[date].count++;
      byDate[date].jobs.push({
        name,revenue:0,
        pending:true,
        pipeline:'Crew Calendar',
        stage:crew,
        source:'calendar',
        normalizedName:normalizedAppt
      });
    }

    res.json({success:true,data:Object.values(byDate).sort((a,b)=>a.date.localeCompare(b.date))});
  }catch(e){console.error(e);res.status(500).json({error:e.message});}
});

// DEBUG: visit /api/debug to see raw custom field structure from GHL
app.get('/api/debug',async(req,res)=>{
  try{
    const r=await axios.get('https://services.leadconnectorhq.com/opportunities/search',{
      headers:{Authorization:'Bearer '+GHL_API_KEY,Version:'2021-07-28'},
      params:{location_id:GHL_LOCATION_ID,limit:3,page:1,status:'open'}
    });
    const opps=r.data?.opportunities||[];
    const result=opps.map(o=>({
      name:o.name,
      pipelineId:o.pipelineId,
      monetaryValue:o.monetaryValue,
      customFields:o.customFields
    }));
    res.json(result);
  }catch(e){res.status(500).json({error:e.message,detail:e.response?.data});}
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
.dow-header{display:grid;grid-template-columns:repeat(6,1fr) 90px;background:#141414;border-bottom:1px solid #1a1a1a}
.dow{padding:10px;text-align:center;font-size:11px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.5px}
.grid{display:grid;grid-template-columns:repeat(6,1fr) 90px}
.cell{min-height:110px;padding:8px;border-right:1px solid #161616;border-bottom:1px solid #161616;transition:background .15s;position:relative}
.cell:hover{background:#181818}
.cell.empty{background:#0d0d0d;cursor:default}
.cell.today{border:2px solid #4caf50}
.cell.day-warn{background:rgba(234,179,8,0.07)}
.cell.day-warn::after{content:'';position:absolute;inset:0;background:rgba(234,179,8,0.11);pointer-events:none}
.cell.full{background:rgba(220,38,38,0.08)}
.cell.full::after{content:'';position:absolute;inset:0;background:rgba(220,38,38,0.13);pointer-events:none}
.day-num{font-size:12px;color:#444;margin-bottom:6px;font-weight:600}
.cell.today .day-num{color:#4caf50}
.cell.has-jobs .day-num{color:#ccc}
.cell.full .day-num{color:#f87171}
.cell.day-warn .day-num{color:#fde047}
.full-badge{display:inline-block;font-size:9px;font-weight:700;color:#f87171;background:rgba(220,38,38,0.18);border:1px solid rgba(220,38,38,0.3);border-radius:4px;padding:1px 5px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.warn-badge{display:inline-block;font-size:9px;font-weight:700;color:#fde047;background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.35);border-radius:4px;padding:1px 5px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
.revenue-bar{width:100%;height:4px;border-radius:2px;margin-bottom:6px;background:#1a1a1a}
.revenue-fill{height:100%;border-radius:2px;transition:width .3s}
.rev-amount{font-size:13px;font-weight:700;margin-bottom:3px}
.rev-pending{font-size:11px;font-weight:600;color:#f59e0b;margin-bottom:3px}
.job-count{font-size:11px;color:#666}
.week-bar-cell{min-height:110px;border-bottom:1px solid #161616;background:#0d0d0d;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 6px;position:relative;gap:6px}
.week-bar-cell.week-full{background:rgba(220,38,38,0.08)}
.week-bar-cell.week-full::after{content:'';position:absolute;inset:0;background:rgba(220,38,38,0.13);pointer-events:none}
.week-bar-title{font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.5px;text-align:center;line-height:1.3}
.week-bar-track{flex:1;width:18px;background:#1a1a1a;border-radius:9px;overflow:hidden;position:relative;min-height:60px}
.week-bar-fill{position:absolute;bottom:0;left:0;right:0;border-radius:9px;transition:height .4s}
.week-bar-fill.under{background:linear-gradient(0deg,#2e7d32,#4caf50)}
.week-bar-fill.over{background:linear-gradient(0deg,#e65100,#ff9800)}
.week-bar-pct{font-size:11px;font-weight:700}
.week-bar-pct.under{color:#4caf50}
.week-bar-pct.over{color:#ff9800}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);display:none;align-items:center;justify-content:center;z-index:100}
.modal{background:#141414;border:1px solid #222;border-radius:14px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto}
.modal h2{font-size:18px;color:#fff;margin-bottom:4px}
.modal .date-sub{font-size:12px;color:#555;margin-bottom:16px}
.modal-total{background:#0d2e0d;border:1px solid #1e5c1e;border-radius:8px;padding:12px;margin-bottom:16px;text-align:center}
.modal-total .t-val{font-size:22px;font-weight:700;color:#4caf50}
.modal-total .t-lbl{font-size:11px;color:#2e7d32;text-transform:uppercase}
.job-item{background:#1a1a1a;border:1px solid #222;border-radius:8px;padding:12px;margin-bottom:8px}
.job-item.is-pending{border-color:#3a2e00}
.job-name{font-size:14px;font-weight:600;color:#fff;margin-bottom:4px}
.job-meta{font-size:12px;color:#666}
.job-rev{font-size:14px;font-weight:700;color:#4caf50;float:right;margin-top:-20px}
.job-rev.pending{color:#f59e0b;font-size:12px;font-weight:600}
.close-btn{background:#1a1a1a;border:1px solid #333;color:#aaa;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;margin-top:16px;width:100%}
.close-btn:hover{background:#222;color:#fff}
.loading{text-align:center;padding:60px;color:#444}
.spinner{width:32px;height:32px;border:3px solid #1a1a1a;border-top-color:#4caf50;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
.error-msg{text-align:center;padding:40px;color:#f44336}
.refresh-note{text-align:center;font-size:11px;color:#333;margin-top:12px}
</style>
</head><body>
<div class="wrap">
<div class="hdr"><h1>📅 Revenue Calendar</h1><p>Turf Time · Pipelines + Kevin, Cody, Joel &amp; Scott</p></div>
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
    <div class="dow">Mon</div><div class="dow">Tue</div><div class="dow">Wed</div>
    <div class="dow">Thu</div><div class="dow">Fri</div><div class="dow">Sat</div>
    <div class="dow" style="color:#333">Week</div>
  </div>
  <div class="grid" id="calGrid"><div class="loading" style="grid-column:span 7"><div class="spinner"></div>Loading jobs...</div></div>
</div>
<div class="refresh-note" id="refreshNote">Refreshes every 30 minutes</div>
</div>
<div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
  <div class="modal">
    <h2 id="modalDate"></h2>
    <div class="date-sub" id="modalSub"></div>
    <div class="modal-total"><div class="t-val" id="modalTotal"></div><div class="t-lbl">Total Confirmed Revenue</div></div>
    <div id="modalJobs"></div>
    <button class="close-btn" onclick="closeModal()">Close</button>
  </div>
</div>
<script>
var allData={};
var currentYear=new Date().getFullYear();
var currentMonth=new Date().getMonth();
var maxRev=0;
var WEEKLY_CAP=250000;
var DAY_LIMITS={1:7,2:4,3:5,4:5,5:3};
var lastLoaded=null;

function fmt(n){return '$'+n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});}
function fmtK(n){return n>=1000?'$'+(n/1000).toFixed(0)+'k':fmt(n);}
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
    lastLoaded=new Date();
    updateRefreshNote();
    renderCalendar();
  }catch(e){
    document.getElementById('calGrid').innerHTML='<div class="error-msg" style="grid-column:span 7">Error: '+e.message+'<br><button onclick="loadData()" style="margin-top:12px;background:#1a1a1a;border:1px solid #333;color:#ccc;padding:8px 16px;border-radius:6px;cursor:pointer">Retry</button></div>';
  }
}

function updateRefreshNote(){
  if(!lastLoaded)return;
  var t=lastLoaded.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  document.getElementById('refreshNote').textContent='Last updated: '+t+' · Refreshes every 30 min';
}

function getDayLimit(dateStr){
  var dow=new Date(dateStr+'T12:00:00').getDay();
  return DAY_LIMITS[dow]||null;
}

function getDayStatus(dateStr){
  var limit=getDayLimit(dateStr);
  if(!limit)return null;
  var count=(allData[dateStr]?allData[dateStr].count:0);
  if(count>=limit)return 'full';
  if(count===limit-1)return 'warn';
  return null;
}

function renderCalendar(){
  var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('monthLabel').textContent=months[currentMonth]+' '+currentYear;
  var first=new Date(currentYear,currentMonth,1);
  var last=new Date(currentYear,currentMonth+1,0);
  var today=new Date().toISOString().slice(0,10);
  var grid=document.getElementById('calGrid');
  var html='';
  var monthRev=0,monthJobs=0;

  var firstDow=first.getDay();
  var monOffset=(firstDow===0)?6:firstDow-1;
  var slots=[];
  for(var i=0;i<monOffset;i++)slots.push(null);
  for(var d2=1;d2<=last.getDate();d2++){
    var ds=currentYear+'-'+String(currentMonth+1).padStart(2,'0')+'-'+String(d2).padStart(2,'0');
    if(new Date(ds+'T12:00:00').getDay()===0)continue;
    slots.push(ds);
  }
  while(slots.length%6!==0)slots.push(null);

  var numWeeks=slots.length/6;
  for(var w=0;w<numWeeks;w++){
    var weekSlots=slots.slice(w*6,(w+1)*6);
    var weekDates=weekSlots.filter(function(x){return x!==null;});
    var weekRev=0;
    for(var i2=0;i2<weekDates.length;i2++){
      if(allData[weekDates[i2]])weekRev+=allData[weekDates[i2]].revenue;
    }
    var weekFull=weekRev>=WEEKLY_CAP;

    for(var s=0;s<6;s++){
      var dateStr=weekSlots[s];
      if(!dateStr){
        html+='<div class="cell empty'+(weekFull?' full':'')+'"></div>';
        continue;
      }
      var info=allData[dateStr];
      var isToday=dateStr===today;
      var hasJobs=info&&info.count>0;
      var dayStatus=getDayStatus(dateStr);
      var limit=getDayLimit(dateStr);
      if(hasJobs){monthRev+=info.revenue;monthJobs+=info.count;}

      var cls='cell';
      if(isToday)cls+=' today';
      if(hasJobs)cls+=' has-jobs';
      if(dayStatus==='full'||weekFull)cls+=' full';
      else if(dayStatus==='warn')cls+=' day-warn';

      html+='<div class="'+cls+'"'+(hasJobs?' data-date="'+dateStr+'" onclick="showDay(this.dataset.date)" style="cursor:pointer"':'')+' data-date="'+dateStr+'">';
      html+='<div class="day-num">'+parseInt(dateStr.slice(8))+'</div>';
      if(dayStatus==='full'){html+='<div class="full-badge">Full</div>';}
      else if(dayStatus==='warn'){html+='<div class="warn-badge">1 Left</div>';}

      if(hasJobs){
        var hasPending=info.jobs.some(function(j){return j.pending;});
        if(info.revenue>0){
          var pct=Math.min(100,Math.round(info.revenue/maxRev*100));
          var col2=getColor(info.revenue);
          html+='<div class="revenue-bar"><div class="revenue-fill" style="width:'+pct+'%;background:'+col2+'"></div></div>';
          html+='<div class="rev-amount" style="color:'+col2+'">'+fmt(info.revenue)+'</div>';
        }
        if(hasPending){html+='<div class="rev-pending">+ Pending</div>';}
        var countLabel=info.count+' job'+(info.count!==1?'s':'');
        if(limit)countLabel+=' / '+limit;
        html+='<div class="job-count">'+countLabel+'</div>';
      }
      html+='</div>';
    }

    var fillPct=Math.min((weekRev/WEEKLY_CAP)*100,100);
    var isOver=weekRev>WEEKLY_CAP;
    var overPct=weekRev>0?Math.round(weekRev/WEEKLY_CAP*100):0;
    var barClass=isOver?'over':'under';
    html+='<div class="week-bar-cell'+(weekFull?' week-full':'')+'">';
    html+='<div class="week-bar-title">Week<br>'+fmtK(weekRev)+'</div>';
    html+='<div class="week-bar-track"><div class="week-bar-fill '+barClass+'" style="height:'+fillPct+'%"></div></div>';
    html+='<div class="week-bar-pct '+barClass+'">'+overPct+'%</div>';
    html+='</div>';
  }

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
  var limit=getDayLimit(dateStr);
  var subText=info.count+' job'+(info.count!==1?'s':'')+' scheduled';
  if(limit)subText+=' (max '+limit+')';
  document.getElementById('modalSub').textContent=subText;
  document.getElementById('modalTotal').textContent=fmt(info.revenue);
  var jobsHtml='';
  var sorted=info.jobs.slice().sort((a,b)=>b.revenue-a.revenue);
  for(var j of sorted){
    jobsHtml+='<div class="job-item'+(j.pending?' is-pending':'')+'">';
    jobsHtml+='<div class="job-rev '+(j.pending?'pending':'')+'">'+( j.pending?'Pending Revenue':fmt(j.revenue))+'</div>';
    jobsHtml+='<div class="job-name">'+j.name+'</div>';
    jobsHtml+='<div class="job-meta">'+j.pipeline+(j.stage?' · '+j.stage:'')+'</div>';
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
setInterval(loadData,30*60*1000);
</script>
</body></html>`);
});

app.listen(PORT,'0.0.0.0',()=>console.log('Revenue Calendar running on port '+PORT));
