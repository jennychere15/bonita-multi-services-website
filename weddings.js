"use strict";
document.querySelectorAll('[data-pick]').forEach(link=>link.addEventListener('click',()=>{const select=document.getElementById('wedding-service');if(select)select.value=link.dataset.pick;}));
for(const form of document.querySelectorAll('form[data-wedding-form],#wedding-form')){
 const inputs=[...form.querySelectorAll('input[type=file]')],status=form.querySelector('#file-status');
 function validate(){let size=0;for(const input of inputs){input.setCustomValidity('');for(const file of input.files){size+=file.size;const ext=file.name.split('.').pop().toLowerCase();const allowed=input.accept.split(',').map(x=>x.trim().replace('.',''));if(!allowed.includes(ext))input.setCustomValidity('Please choose one of the listed file types.');}}
 if(size>5*1024*1024&&inputs.length)inputs[0].setCustomValidity('Please keep all attachments under 5 MB combined.');
 if(status)status.textContent=size?(size/1024/1024).toFixed(2)+' MB selected'+(size>5*1024*1024?' — maximum 5 MB combined.':'.'):'';
 return form.checkValidity();}
 inputs.forEach(input=>input.addEventListener('change',validate));
 form.addEventListener('submit',event=>{if(!validate()){event.preventDefault();form.reportValidity();}});
}
// Keep the shared service category consistent with the ceremony detail selected.
const weddingForm=document.getElementById('wedding-form');
if(weddingForm){
 const detail=weddingForm.querySelector('#wedding-service'),category=weddingForm.querySelector('[data-all-services]');
 const categoryFor=value=>value.startsWith('Office ceremony')?'wedding-office':value.startsWith('Mobile')||value.includes('destination')?'wedding-mobile':value.includes('Vow renewal')?'wedding-vows':value.startsWith('Marriage-license')||value.startsWith('License help')?'marriage-registration':value.startsWith('Certified')?'marriage-record':value.startsWith('Premarital')?'premarital-guidance':'wedding-office';
 detail?.addEventListener('change',()=>{if(category)category.value=categoryFor(detail.value);});
 document.querySelectorAll('[data-pick]').forEach(link=>link.addEventListener('click',()=>{if(category)category.value=categoryFor(link.dataset.pick||'');}));
}
