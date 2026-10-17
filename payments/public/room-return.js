'use strict';
const params=new URLSearchParams(location.search),session=params.get('session_id'),heading=document.getElementById('heading'),result=document.getElementById('result'),details=document.getElementById('details');
const time=m=>{const h=Math.floor(m/60);return(h%12||12)+':00 '+(h<12?'AM':'PM');};
let checks=0;
async function refresh(){
 if(params.has('cancelled')){heading.textContent='Checkout was cancelled.';result.textContent='No booking is confirmed by this page. Use the button below to release an unpaid hold.';const b=document.createElement('button');b.textContent='Release unpaid hold';b.onclick=async()=>{b.disabled=true;try{const response=await fetch('/api/room/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session})});const value=await response.json();if(!response.ok)throw Error(value.error);result.textContent='The unpaid hold has been released. You can choose another time.';b.remove();}catch(error){result.textContent=error.message||'Please contact BMS.';b.disabled=false;}};if(session)details.replaceChildren(b);return;}
 if(!session){heading.textContent='Your reservation is not confirmed.';result.textContent=params.has('cancelled')?'You left checkout without confirming payment. Your selected time may remain temporarily held until Stripe closes the payment link.':'Open the confirmation link returned by your Stripe checkout, or contact BMS for help.';return;}
 try{const r=await fetch('/api/room/status?session_id='+encodeURIComponent(session),{signal:AbortSignal.timeout(10000)});const j=await r.json();if(!r.ok)throw Error();
 if(j.status==='confirmed'){heading.textContent='Your room is confirmed.';result.textContent='Payment has been verified. We look forward to welcoming you.';const p=document.createElement('p');p.textContent=j.date+' · '+time(j.start)+'–'+time(j.end)+' Eastern · '+j.guests+' guests · $'+(j.amount/100).toFixed(2);const ref=document.createElement('p');ref.textContent='Reservation reference: '+j.id;details.replaceChildren(p,ref);return;}
 if(['expired','cancelled'].includes(j.status)){heading.textContent='This reservation is not confirmed.';result.textContent='The payment link is closed. Please choose a new time or contact BMS.';return;}
 result.textContent='Payment verification is still pending. Please keep this page open. A completed checkout is confirmed only after Stripe verifies payment.';
 }catch{result.textContent='We could not check payment status right now. Contact BMS if you need help confirming your booking.';}
 if(++checks<30)setTimeout(refresh,2000);else result.textContent='Confirmation is taking longer than expected. Please contact BMS with your Stripe checkout details before making another payment.';
}
refresh();
