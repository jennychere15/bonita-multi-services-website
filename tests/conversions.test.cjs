const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('conversions.js','utf8');
function setup({path='/notary.html',query='',storage=new Map(),labels={notary_request:'realLabel'},blocked=false}={}){
 const calls=[],handlers={};
 const sessionStorage={getItem:k=>{if(blocked)throw Error();return storage.get(k)||null;},setItem:(k,v)=>{if(blocked)throw Error();storage.set(k,v);},removeItem:k=>storage.delete(k)};
 const context={window:{BMS_ADS_CONVERSIONS:labels,gtag:(...a)=>calls.push(a)},sessionStorage,document:{addEventListener:(n,fn)=>handlers[n]=fn},location:{origin:'https://bonitamultiservices.com',pathname:path,href:'https://bonitamultiservices.com'+path+query},crypto:{randomUUID:()=> 'random-request-id'},URL,Date};
 vm.runInNewContext(code,context);return {api:context.window.BMSConversions,calls,handlers,storage};
}
test('disabled labels, absent IDs, unknown actions and email IDs never send',()=>{
 for(const labels of [{},{notary_request:''},{notary_request:'AW-18509547187/label'}]){
 const s=setup({labels});assert.equal(s.api.confirmedInquiry('notary_request','id-1'),false);assert.equal(s.calls.length,0);}
 const s=setup();for(const id of [null,undefined,'','client@example.com',123])assert.equal(s.api.confirmedInquiry('notary_request',id),false);
 assert.equal(s.api.confirmedInquiry('unknown','id'),false);assert.equal(s.calls.length,0);
});
test('accepted request sends only destination and namespaced stable ID; repeat suppressed',()=>{
 const s=setup();assert.equal(s.api.confirmedInquiry('notary_request','id-1'),true);assert.equal(s.api.confirmedInquiry('notary_request','id-1'),false);
 assert.equal(s.calls.length,1);const [command,event,payload]=s.calls[0];assert.equal(command,'event');assert.equal(event,'conversion');assert.equal(payload.send_to,'AW-18509547187/realLabel');assert.equal(payload.transaction_id,'notary_request:id-1');assert.deepEqual(Object.keys(payload).sort(),['send_to','transaction_id']);
 assert.equal(s.api.confirmedInquiry('notary_request','id-2'),true);
});
test('storage failure does not break workflow or send unprotected conversions',()=>{
 const s=setup({blocked:true});assert.equal(s.api.confirmedInquiry('notary_request','id-1'),false);assert.equal(s.calls.length,0);
});
function form(next='/real-estate-thank-you.html') {return {action:'https://formsubmit.co/admin@bonitamultiservices.com',elements:{_next:{value:'https://bonitamultiservices.com'+next}},checkValidity:()=>true};}
test('submit records attempt without conversion, preserves rental type',()=>{
 const s=setup();const f=form('/rental-placement-thank-you.html?type=owner');s.handlers.submit({target:f,defaultPrevented:false});assert.match(f.elements._next.value,/type=owner&bms_request=random-request-id/);assert.equal(s.calls.length,0);
});
test('valid same-tab confirmation converts once; refresh and direct visits do not',()=>{
 const s=setup();const f=form();s.handlers.submit({target:f,defaultPrevented:false});
 const args={path:'/real-estate-thank-you.html',query:'?bms_request=random-request-id',storage:s.storage,labels:{real_estate_request:'realLabel'}};
 const result=setup(args);assert.equal(result.calls.length,1);assert.equal(setup(args).calls.length,0);assert.equal(setup({...args,storage:new Map()}).calls.length,0);
});
test('failed validation, cancelled submit, vendor recruitment and foreign return do not arm',()=>{
 const s=setup();for(const [f,cancelled] of [[form(),true],[{...form(),checkValidity:()=>false},false],[form('/vendor-application-thank-you.html'),false],[{...form(),elements:{_next:{value:'https://example.com/real-estate-thank-you.html'}}},false]])s.handlers.submit({target:f,defaultPrevented:cancelled});assert.equal(s.storage.size,0);
});
test('stale or mismatched return never converts',()=>{
 for(const pending of [{action:'real_estate_request',path:'/real-estate-thank-you.html',time:Date.now()-31*60000},{action:'relocation_request',path:'/relocation-thank-you.html',time:Date.now()}]){
 const storage=new Map([['bms-ads-v1:pending:random-request-id',JSON.stringify(pending)]]);assert.equal(setup({path:'/real-estate-thank-you.html',query:'?bms_request=random-request-id',storage,labels:{real_estate_request:'realLabel'}}).calls.length,0);}
});
test('all instrumented pages load one base tag and config before helper',()=>{
 for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.html'))){const s=fs.readFileSync(file,'utf8');if(!s.includes('src="conversions.js'))continue;assert.equal((s.match(/gtag\/js\?id=AW-18509547187/g)||[]).length,1,file);assert(s.indexOf('conversion-config.js')<s.indexOf('src="conversions.js'),file);}
});
