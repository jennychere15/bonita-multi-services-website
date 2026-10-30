"use strict";
(() => {
 const catalog=[
  {
    "id": "notary-office",
    "label": "In-office notary",
    "family": "notary"
  },
  {
    "id": "notary-mobile",
    "label": "Mobile notary",
    "family": "notary"
  },
  {
    "id": "notary-online",
    "label": "Remote online notarization",
    "family": "notary"
  },
  {
    "id": "notary-signing",
    "label": "Loan / real estate document signing",
    "family": "notary"
  },
  {
    "id": "notary-estate",
    "label": "Attorney-prepared estate document signing",
    "family": "notary"
  },
  {
    "id": "notary-witness",
    "label": "Witness coordination",
    "family": "notary"
  },
  {
    "id": "notary-i9",
    "label": "Employer-authorized I-9 support",
    "family": "notary"
  },
  {
    "id": "apostille",
    "label": "Apostille facilitation",
    "family": "notary"
  },
  {
    "id": "wedding-office",
    "label": "In-office wedding ceremony",
    "family": "wedding"
  },
  {
    "id": "wedding-mobile",
    "label": "Mobile / beach / destination wedding",
    "family": "wedding"
  },
  {
    "id": "wedding-vows",
    "label": "Vow renewal / personalized ceremony",
    "family": "wedding"
  },
  {
    "id": "marriage-registration",
    "label": "Marriage registration / license application assistance",
    "family": "wedding"
  },
  {
    "id": "marriage-record",
    "label": "Certified marriage-record coordination",
    "family": "wedding"
  },
  {
    "id": "premarital-guidance",
    "label": "Premarital course provider guidance",
    "family": "wedding"
  },
  {
    "id": "real-estate",
    "label": "Real estate — commercial / investment / new construction / residential",
    "family": "realestate"
  },
  {
    "id": "rental-placement",
    "label": "Rental property placement — owner / renter",
    "family": "rental"
  },
  {
    "id": "corporate-lodging",
    "label": "Corporate / crew / government lodging coordination",
    "family": "lodging"
  },
  {
    "id": "senior-placement",
    "label": "Senior placement & relocation",
    "family": "senior"
  },
  {
    "id": "relocation",
    "label": "Relocation coordination",
    "family": "relocation"
  },
  {
    "id": "business-setup",
    "label": "Business setup / registration assistance",
    "family": "consulting"
  },
  {
    "id": "business-consulting",
    "label": "Business consulting / launch / expansion",
    "family": "consulting"
  },
  {
    "id": "sales-consulting",
    "label": "Sales consulting / implementation / training",
    "family": "consulting"
  },
  {
    "id": "document-preparation",
    "label": "Non-lawyer document preparation",
    "family": "business"
  },
  {
    "id": "passport-photos",
    "label": "Passport photos",
    "family": "business"
  },
  {
    "id": "tax-preparation",
    "label": "Tax preparation — outsourced provider coordination",
    "family": "business"
  },
  {
    "id": "meeting-room",
    "label": "Meeting room / day office rental",
    "family": "room"
  },
  {
    "id": "preferred-network",
    "label": "Preferred Provider Network — request a service provider",
    "family": "network"
  },
  {
    "id": "preferred-network-business",
    "label": "Preferred Provider Network — business / property service coordination",
    "family": "network"
  },
  {
    "id": "vendor-application",
    "label": "Join the Preferred Provider Network",
    "family": "vendor"
  },
  {
    "id": "wedding-provider",
    "label": "Wedding professional / provider application",
    "family": "weddingvendor"
  },
  {
    "id": "other",
    "label": "Other / help choosing a service",
    "family": "other"
  }
]
;
 const byId=new Map(catalog.map(item=>[item.id,item]));
 const booking=document.getElementById('bms-booking-form');
 const storageKey='bms_service_handoff_v1';
 function stash(form,service){try{const d=new FormData(form);sessionStorage.setItem(storageKey,JSON.stringify({service,time:Date.now(),name:d.get('name')||d.get('Name')||'',email:d.get('email')||d.get('Email')||'',phone:d.get('phone')||d.get('Phone')||'',description:form.querySelector('[data-service-description]')?.value||''}));}catch{}}
 function switchService(form,id){stash(form,id);location.assign('book.html?service='+encodeURIComponent(id));}
 const notaryDetail={'notary-office':'Office notary','notary-mobile':'Mobile notary','notary-online':'Remote online notarization','notary-signing':'Loan and title signing','notary-estate':'Attorney-prepared document signing','notary-witness':'Witness coordination','notary-i9':'Employer-authorized I-9 support','apostille':'Apostille facilitation'};
 for(const form of document.querySelectorAll('form[data-service-family]')){
  const select=form.querySelector('[data-all-services]'),description=form.querySelector('[data-service-description]');
  if(!select||!description)continue;
  select.addEventListener('change',()=>{const item=byId.get(select.value);if(!item)return;if(item.family!==form.dataset.serviceFamily){switchService(form,item.id);return;}if(form.id==='notary-inquiry'&&notaryDetail[item.id]){form.elements.service.value=notaryDetail[item.id];form.elements.service.dispatchEvent(new Event('change'));}});
  // Native forms include the selection; custom JSON handlers already send their existing description field.
  form.addEventListener('submit',event=>{const item=byId.get(select.value);if(!item||!description.value.trim()){event.preventDefault();event.stopImmediatePropagation();description.setCustomValidity(description.value.trim()?'':'Please briefly describe the service you need.');form.reportValidity();return;}if(item.family!==form.dataset.serviceFamily){event.preventDefault();event.stopImmediatePropagation();switchService(form,item.id);return;}const prefix='Requested service: '+item.label+'\n';if(!description.value.startsWith(prefix))description.value=prefix+description.value;},true);
  description.addEventListener('input',()=>description.setCustomValidity(''));
 }
 if(!booking)return;
 const service=booking.elements.requested_service,description=booking.elements.service_description;
 const query=new URLSearchParams(location.search);if(byId.has(query.get('service')))service.value=query.get('service');
 try{const stored=JSON.parse(sessionStorage.getItem(storageKey)||'null');sessionStorage.removeItem(storageKey);if(stored&&Date.now()-stored.time<30*60*1000&&(!service.value||service.value===stored.service)){if(byId.has(stored.service))service.value=stored.service;for(const key of ['name','email','phone'])if(stored[key])booking.elements[key].value=stored[key];description.value=stored.description||'';}}catch{}
 let sent=false,sending=false;
 description.addEventListener('input',()=>description.setCustomValidity(''));
 booking.addEventListener('submit',async event=>{
  event.preventDefault();if(sent||sending)return;
  description.setCustomValidity(description.value.trim()?'':'Please briefly describe the service you need.');if(!booking.reportValidity())return;
  const item=byId.get(service.value);if(!item)return;
  const data=Object.fromEntries(new FormData(booking)),status=document.getElementById('bms-booking-status'),button=booking.querySelector('button[type=submit]'),fallback=document.getElementById('bms-booking-fallback');
  const summary=['Appointment request','Service: '+item.label,'Preferred reply: '+data.contact_method,'Preferred date: '+(data.preferred_date||'Choose during scheduling'),'Brief: '+description.value.trim()].join('\n');
  const payload={name:data.name,email:data.email,phone:data.phone,company:'',location:data.location||'To confirm',service:'BMS appointment: '+item.label,summary,budget:'Confirm scope and itemized fees before payment',consent:booking.elements.consent.checked,website:data._honey||''};
  sending=true;button.disabled=true;status.textContent='Sending your service details to BMS…';fallback.hidden=true;
  try{
   const response=await fetch('https://bms-provider-payments.onrender.com/api/notary/inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
   const result=await response.json();if(!response.ok||!result.id)throw Error('Receipt could not be confirmed.');
   sent=true;status.textContent='Your request has been received. Continue below to complete scheduling.';button.textContent='Service details received';
   const box=document.getElementById('bms-booking-next'),link=document.getElementById('bms-schedule-link');
   const notaryKind={'notary-office':'office','notary-mobile':'mobile','notary-online':'online','apostille':'apostille'};
   if(item.id==='meeting-room'){link.href='meeting-room.html#reserve';link.textContent='Check room availability & complete reservation →';}
   else if(notaryKind[item.id]){link.href='https://bms-provider-payments.onrender.com/notary-book?kind='+notaryKind[item.id];link.textContent='Choose your notary appointment →';}
   else if(item.id==='vendor-application'){link.href='provider-network.html#apply';link.textContent='Complete provider application →';}
   else if(item.id==='wedding-provider'){link.href='wedding-providers.html#apply';link.textContent='Complete wedding-provider application →';}
   else{link.href='https://calendar.app.google/6BNgcTPhgPHVEg3n8';link.textContent='Choose your consultation time →';}
   document.getElementById('bms-booking-reference').textContent='Service: '+item.label+'. Request reference: '+result.id+'.';
   box.hidden=false;box.focus();box.scrollIntoView({behavior:'auto',block:'center'});
   if(typeof gtag==='function')gtag('event','generate_lead',{service:'bms_appointment',service_category:item.id});
  }catch{
   status.textContent='We could not confirm receipt, so scheduling has not opened. If an acknowledgment email arrives, contact BMS with that reference. Otherwise, try again or use the email request below.';
   const link=fallback.querySelector('a');link.href='mailto:Admin@bonitamultiservices.com?subject='+encodeURIComponent('BMS appointment — '+item.label)+'&body='+encodeURIComponent(['Name: '+data.name,'Email: '+data.email,'Phone: '+data.phone,'Location: '+payload.location,summary].join('\n'));fallback.hidden=false;button.disabled=false;
  }finally{sending=false;}
 });
})();
