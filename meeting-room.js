'use strict';
const api='https://bms-provider-payments.onrender.com/api/room/';
const f=document.getElementById('room-form'),plan=f.elements.Plan,start=f.elements.Start,hours=f.elements.Hours,date=f.elements.Date;
const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');f.prepend(status);
const availability=document.createElement('p');availability.setAttribute('aria-live','polite');f.querySelector('.bms-form-note').before(availability);
let busy=[],requestSequence=0,available=false,sending=false,submitted=false,paymentReady=false;
const label=h=>(h%12||12)+':00 '+(h<12?'AM':'PM');
const selected=()=>({start:plan.value==='day'?360:Number(start.value)*60,end:plan.value==='day'?1080:(Number(start.value)+Number(hours.value))*60});
const overlaps=(s,e)=>busy.some(b=>b.start<e&&b.end>s);
for(let h=6;h<=16;h++)start.add(new Option(label(h),h));
function update(){
 const day=plan.value==='day';start.disabled=day;hours.disabled=day;
 if(day){start.value='6';hours.replaceChildren(new Option('Full day — 12 hours','12'));}
 else{const old=Number(hours.value)||2;hours.replaceChildren();for(let h=2;h<=18-Number(start.value);h++)hours.add(new Option(h+' hours',h));hours.value=String(Math.min(old,18-Number(start.value)));}
 const s=selected(),cost=day?165:45*Number(hours.value);document.getElementById('room-total').textContent='$'+cost+' room rental · '+label(s.start/60)+'–'+label(s.end/60)+' Eastern'+(!day&&cost>165?' · Full-day option available for $165':'');
 const blocked=available&&overlaps(s.start,s.end);
 if(blocked){availability.textContent='This time overlaps an existing reservation or internal room use. Please choose a different time.';}
 else if(available){availability.textContent=busy.length?'Reserved / held times: '+busy.map(b=>label(b.start/60)+'–'+label(b.end/60)).join(', ')+'. Your selected time is currently open, subject to BMS confirmation.':'No reserved times for this date. Your selected time is currently open, subject to BMS confirmation.';}
 f.querySelector('button[type=submit]').disabled=sending||blocked||submitted;
 if(!sending&&!submitted)f.querySelector('button[type=submit]').textContent=paymentReady?'Reserve & pay securely':'Request this reservation';
}
async function checkAvailability(){
 const seq=++requestSequence;available=false;busy=[];
 if(!date.value){availability.textContent='Select a date to check the room calendar.';update();return;}
 availability.textContent='Checking the room calendar…';update();
 try{const r=await fetch(api+'availability?date='+encodeURIComponent(date.value),{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const j=await r.json();if(seq!==requestSequence)return;busy=j.busy;paymentReady=j.paymentReady===true;available=true;update();}
 catch{if(seq!==requestSequence)return;availability.textContent='The live calendar is temporarily unavailable. You can still request a time for BMS to verify.';}
}
plan.addEventListener('change',update);start.addEventListener('change',update);hours.addEventListener('change',update);date.addEventListener('change',checkAvailability);date.addEventListener('input',()=>date.setCustomValidity(''));
document.querySelectorAll('[data-plan]').forEach(a=>a.addEventListener('click',()=>{plan.value=a.dataset.plan;update();}));
f.addEventListener('submit',async e=>{
 e.preventDefault();if(sending||!f.reportValidity())return;
 if(date.value<'2026-11-15'){date.setCustomValidity('Reservations begin November 15, 2026.');f.reportValidity();return;}
 const s=selected();if(available&&overlaps(s.start,s.end)){update();return;}
 const data=new FormData(f),payload={payNow:paymentReady,date:date.value,plan:plan.value,start:s.start,hours:plan.value==='day'?12:Number(hours.value),guests:Number(data.get('Guests')),name:data.get('Name'),email:data.get('Email'),phone:data.get('Phone'),notes:[data.get('Company')?'Company: '+data.get('Company'):'',data.get('Requests')||''].filter(Boolean).join('\n'),consent:f.querySelector('input[type=checkbox]').checked};
 sending=true;update();status.textContent='Sending your reservation request…';document.getElementById('room-result').hidden=true;
 try{const r=await fetch(api+'requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok)throw Error(j.error||'The request could not be sent.');if(j.checkoutUrl){const checkout=new URL(j.checkoutUrl);if(checkout.protocol!=='https:'||checkout.hostname!=='checkout.stripe.com')throw Error('Payment link could not be verified. Please contact BMS.');submitted=true;status.textContent='Your time is temporarily held. Opening secure Stripe checkout…';window.location.assign(checkout.href);return;}window.BMSConversions?.confirmedInquiry('room_request',j.id);submitted=true;status.textContent='Request received. Reference: '+j.id+'. BMS will review availability and contact you with payment instructions. This is not yet a confirmed reservation.';f.querySelector('button[type=submit]').textContent='Request received';}
 catch(error){status.textContent='We could not confirm online submission. '+error.message+' If you already received an acknowledgment, please do not submit again. Otherwise, use the email option below.';const lines=['BMS PRIVATE MEETING ROOM — AVAILABILITY REQUEST','Date: '+payload.date,'Time: '+label(s.start/60)+'–'+label(s.end/60)+' Eastern','Room rental: $'+(payload.plan==='day'?165:45*payload.hours),'Guests: '+payload.guests,'Name: '+payload.name,'Email: '+payload.email,'Phone: '+payload.phone,payload.notes,'Availability confirmation and payment required; extras quoted separately.'];const draft=lines.join('\n');document.getElementById('room-draft').value=draft;document.getElementById('room-mail').href='mailto:Admin@bonitamultiservices.com?subject='+encodeURIComponent('Meeting room request — '+payload.date)+'&body='+encodeURIComponent(draft);document.getElementById('room-result').hidden=false;}
 finally{sending=false;update();}
});
date.value='2026-11-15';update();checkAvailability();
