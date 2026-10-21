'use strict';
function openInquiry(id){const panel=document.getElementById(id);if(panel instanceof HTMLDetailsElement)panel.open=true;}
function syncHash(){openInquiry(location.hash.slice(1));}
syncHash();window.addEventListener('hashchange',syncHash);
document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',()=>{openInquiry(a.hash.slice(1));const menu=a.closest('.mobile-nav');if(menu)menu.open=false;}));
document.querySelectorAll('[data-county-filter]').forEach(button=>button.addEventListener('click',()=>{const selected=button.dataset.countyFilter;document.querySelectorAll('[data-county-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));let count=0;document.querySelectorAll('.area-card').forEach(card=>{card.hidden=selected!=='all'&&card.dataset.county!==selected;if(!card.hidden)count++;});document.getElementById('area-status').textContent=count+' community guides shown';}));
document.querySelectorAll('[data-resource-filter]').forEach(button=>button.addEventListener('click',()=>{const selected=button.dataset.resourceFilter;document.querySelectorAll('[data-resource-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('.resource').forEach(card=>card.hidden=selected!=='all'&&card.dataset.audience!=='all'&&card.dataset.audience!==selected);}));
const renter=document.getElementById('renter-form');
document.getElementById('start-search').addEventListener('click',()=>{const term=document.getElementById('quick-term').value;const area=document.getElementById('quick-area').value;if(term)renter.elements.rental_arrangement.value=term;if(area)renter.elements.preferred_areas.value=area;openInquiry('renter-inquiry');location.hash='renter-inquiry';renter.elements.name.focus({preventScroll:true});});
document.querySelectorAll('.area-pick').forEach(a=>a.addEventListener('click',()=>{renter.elements.preferred_areas.value=a.dataset.area;openInquiry('renter-inquiry');}));
for(const form of document.querySelectorAll('.rental-form')){
 const emailDraft=()=>{const lines=['BMS RENTAL HUB INQUIRY',''];for(const [name,value] of new FormData(form)){if(name.startsWith('_')||!value)continue;lines.push(name.replaceAll('_',' ')+': '+value);}const text=lines.join('\n');const field=form.querySelector('.email-fallback textarea');field.hidden=false;field.value=text;return 'mailto:Admin@bonitamultiservices.com?subject='+encodeURIComponent(form.elements._subject.value)+'&body='+encodeURIComponent(text);};
 form.querySelector('.draft-button').addEventListener('click',()=>{location.href=emailDraft();});form.querySelector('.email-draft').addEventListener('click',e=>{e.currentTarget.href=emailDraft();});
 form.addEventListener('submit',e=>{if(form===renter){const from=renter.elements.move_in.value,to=renter.elements.departure.value;if(from&&to&&to<=from){e.preventDefault();renter.elements.departure.setCustomValidity('Choose a departure after your arrival date.');renter.elements.departure.reportValidity();return;}}if(typeof gtag==='function')gtag('event','rental_inquiry_submit_attempt',{inquiry_type:form.id==='owner-form'?'owner':'renter'});});
}
renter.elements.departure.addEventListener('input',()=>renter.elements.departure.setCustomValidity(''));
renter.elements.move_in.addEventListener('input',()=>renter.elements.departure.setCustomValidity(''));
