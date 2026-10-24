import { randomUUID, randomBytes } from 'node:crypto';
import { hash, token, text, requireCondition } from './domain.js';
import { validEmail } from './notifications.js';

// Consulting uses the existing BMS direct-services Stripe account and signed
// destination. It never uses Connect or the provider-network payment flag.
export function createConsultingRoutes({db, stripe, config, adminAuth, body, notifications, now=Date.now}) {
 db.exec(`CREATE TABLE IF NOT EXISTS consulting_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,company TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,service TEXT NOT NULL,budget TEXT NOT NULL,location TEXT NOT NULL,summary TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Inquiry',scope TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS consulting_milestones(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES consulting_projects(id),title TEXT NOT NULL,status TEXT NOT NULL,due TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS consulting_messages(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES consulting_projects(id),author TEXT NOT NULL,message TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS consulting_access(hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS consulting_sessions(hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS consulting_login_requests(email_hash TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS consulting_invoices(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES consulting_projects(id),title TEXT NOT NULL,scope TEXT NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'due',checkout_id TEXT UNIQUE,checkout_url TEXT,checkout_params TEXT,attempt INTEGER NOT NULL DEFAULT 1,payment_intent TEXT UNIQUE,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS consulting_events(id TEXT PRIMARY KEY,created INTEGER NOT NULL);`);
 const one=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a),all=(s,...a)=>db.prepare(s).all(...a);
 const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
 const clean=(v,n=1000)=>typeof v==='string'?v.trim().slice(0,n):'';
 const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const ready=()=>Boolean(config.roomPaymentsEnabled&&config.roomStripeKey&&config.roomWebhookSecret&&stripe);
 const sessionCookie=(v,age)=>`bms_consulting=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.baseUrl.startsWith('https:')?'; Secure':''}`;
 const mail=(id,kind,email,title,lines)=>notifications.consulting(id,kind,email,title,lines);
 function login(email){
  const t=token();run('INSERT INTO consulting_access VALUES(?,?,?,0)',hash(t),email,now()+15*60000);
  mail(randomUUID(),'access',email,'Your private BMS client portal link',[`Open your private portal within 15 minutes: ${config.baseUrl}/client-portal#access=${t}`,'This link can be used once. Do not forward it. If you did not request it, you can ignore this email.']);
 }
 function client(request){
  const value=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('bms_consulting='))?.slice(15)||'';
  const session=one('SELECT email FROM consulting_sessions WHERE hash=? AND expires>?',hash(value),now());
  requireCondition(session,'Please request a fresh private sign-in link.',401);return session.email;
 }
 function project(id,email){const p=one('SELECT * FROM consulting_projects WHERE id=?',id||'');requireCondition(p&&(!email||p.email===email),'Project not found.',404);return p;}
 function view(p){return {...p,milestones:all('SELECT id,title,status,due FROM consulting_milestones WHERE project_id=? ORDER BY created,id',p.id),messages:all('SELECT id,author,message,created FROM consulting_messages WHERE project_id=? ORDER BY created,id',p.id),invoices:all('SELECT id,title,scope,amount,status FROM consulting_invoices WHERE project_id=? ORDER BY created,id',p.id)};}
 async function checkout(invoice){
  requireCondition(ready(),'Secure payments are temporarily unavailable. Contact BMS.',503);
  requireCondition(invoice.status!=='paid','This payment request is already paid.',409);
  const p=project(invoice.project_id);
  if(invoice.checkout_id){
   const current=await stripe.checkout.sessions.retrieve(invoice.checkout_id);
   requireCondition(current.livemode===(config.paymentMode==='live'),'Unexpected payment environment.',409);
   if(current.status==='open')return {url:invoice.checkout_url};
   requireCondition(current.status==='expired','Payment is complete or processing. Refresh your portal.',409);
   run("UPDATE consulting_invoices SET checkout_id=NULL,checkout_url=NULL,checkout_params=NULL,attempt=attempt+1,status='due' WHERE id=? AND status<>'paid'",invoice.id);
   invoice=one('SELECT * FROM consulting_invoices WHERE id=?',invoice.id);
  }
  requireCondition(!p.service.startsWith('Notary & Apostille'),'Notary payments now use the BMS Notary Network portal. Contact BMS to migrate this quote.',409);
  let params=invoice.checkout_params?JSON.parse(invoice.checkout_params):{
   mode:'payment',customer_email:p.email,client_reference_id:invoice.id,
   metadata:{bms_consulting_invoice:invoice.id},payment_intent_data:{metadata:{bms_consulting_invoice:invoice.id}},
   line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:invoice.amount,product_data:{name:(p.service.startsWith('Notary & Apostille')?'BMS Notary & Apostille — ':'BMS Consulting — ')+invoice.title,description:invoice.scope.slice(0,450)}}}],
   expires_at:Math.floor(now()/1000)+86400,success_url:config.baseUrl+'/client-portal?payment=received',cancel_url:config.baseUrl+'/client-portal?payment=cancelled',
   integration_identifier:'bms_consulting_'+Array.from(randomBytes(8),b=>String.fromCharCode(97+b%26)).join('')
  };
  if(!invoice.checkout_params){run('UPDATE consulting_invoices SET checkout_params=COALESCE(checkout_params,?) WHERE id=?',JSON.stringify(params),invoice.id);params=JSON.parse(one('SELECT checkout_params FROM consulting_invoices WHERE id=?',invoice.id).checkout_params);}
  const s=await stripe.checkout.sessions.create(params,{idempotencyKey:'bms-consult-'+invoice.id+'-'+invoice.attempt});
  requireCondition(s.livemode===(config.paymentMode==='live')&&s.url?.startsWith('https://checkout.stripe.com/'),'Unexpected checkout response.',502);
  run("UPDATE consulting_invoices SET checkout_id=?,checkout_url=?,status='open' WHERE id=? AND status<>'paid'",s.id,s.url,invoice.id);
  return {url:s.url};
 }
 async function webhook(request){
  // A cloned request preserves the room handler's body for unrelated room events.
  if(!stripe||!config.roomWebhookSecret)return null;
  let e;try{e=stripe.webhooks.constructEvent(Buffer.from(await request.clone().arrayBuffer()),request.headers.get('stripe-signature'),config.roomWebhookSecret);}catch{return json({error:'Invalid signature.'},400);}
  if(!e.data.object.metadata?.bms_consulting_invoice)return null;
  requireCondition(e.livemode===(config.paymentMode==='live')&&!e.account,'Unexpected payment environment.',400);
  const s=e.data.object,r=one('SELECT * FROM consulting_invoices WHERE id=?',s.metadata.bms_consulting_invoice);
  requireCondition(r&&s.id===r.checkout_id&&s.client_reference_id===r.id&&s.amount_total===r.amount&&s.currency==='usd','Payment details do not match.',409);
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(e.type))return json({received:true});
  atomic(()=>{
   if(one('SELECT id FROM consulting_events WHERE id=?',e.id))return;
   if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(e.type)){
    if(s.payment_status==='paid'&&r.status!=='paid'){
     requireCondition(typeof s.payment_intent==='string'&&s.payment_intent.startsWith('pi_'),'Payment reference missing.',409);
     run("UPDATE consulting_invoices SET status='paid',payment_intent=? WHERE id=?",s.payment_intent,r.id);
     const p=project(r.project_id),lines=[`${r.title}: $${(r.amount/100).toFixed(2)} paid.`,r.scope,`Project: ${p.company||p.name}\nReference: ${r.id}`,`View your project: ${config.baseUrl}/client-portal`];
     mail(r.id,'paid_customer',p.email,'Your BMS payment is confirmed',lines);
     mail(r.id,'paid_admin',config.adminEmail,'BMS client payment received',[...lines,`${p.name} · ${p.email}`,`Manage: ${config.baseUrl}/consulting-admin`]);
    }else if(r.status!=='paid')run("UPDATE consulting_invoices SET status='processing' WHERE id=?",r.id);
   }else if(r.status!=='paid')run("UPDATE consulting_invoices SET status='due' WHERE id=?",r.id);
   run('INSERT INTO consulting_events VALUES(?,?)',e.id,now());
  });return json({received:true});
 }
 return async request=>{
  const u=new URL(request.url),notaryInquiry=u.pathname==='/api/notary/inquiries',path=notaryInquiry?'/api/consulting/inquiries':u.pathname==='/api/notary/health'?'/api/consulting/health':u.pathname,m=request.method;
  if(path==='/api/room/webhook'&&m==='POST')return webhook(request);
  if(!path.startsWith('/api/consulting/')&&!path.startsWith('/api/admin/consulting/'))return null;
  const origin=request.headers.get('origin'),publicOrigin=['https://bonitamultiservices.com','https://www.bonitamultiservices.com'].includes(origin),same=origin===config.baseUrl;
  const cors=r=>{if(publicOrigin||same){r.headers.set('Access-Control-Allow-Origin',origin);r.headers.set('Vary','Origin');r.headers.set('Access-Control-Allow-Headers','Content-Type');r.headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');}return r;};
  try{
   if(m==='OPTIONS')return cors(new Response(null,{status:204}));
   if(path==='/api/consulting/health'&&m==='GET')return cors(json({available:true,paymentReady:ready(),portal:true}));
   if(m==='POST')requireCondition(same||(publicOrigin&&path==='/api/consulting/inquiries'),'Request origin is not allowed.',403);
   if(path==='/api/consulting/inquiries'&&m==='POST'){
    const i=await body(request);if(notaryInquiry)i.service='Notary & Apostille — '+clean(i.service,130);if(i.website)return cors(json({received:true},201));
    const email=clean(i.email,254).toLowerCase();requireCondition(validEmail(email),'Enter a valid email.');requireCondition(i.consent===true,'Please authorize a reply.');
    requireCondition(one('SELECT COUNT(*) AS n FROM consulting_projects WHERE created>?',now()-60000).n<10&&one('SELECT COUNT(*) AS n FROM consulting_projects WHERE email=? AND created>?',email,now()-3600000).n<3,'Please contact BMS to update your request.',429);
    const p={id:randomUUID(),name:text(i.name,100),company:clean(i.company,160),email,phone:text(i.phone,40),service:text(i.service,160),budget:clean(i.budget,100),location:clean(i.location,160),summary:text(i.summary,3000)};
    atomic(()=>{run('INSERT INTO consulting_projects(id,name,company,email,phone,service,budget,location,summary,created) VALUES(?,?,?,?,?,?,?,?,?,?)',p.id,p.name,p.company,p.email,p.phone,p.service,p.budget,p.location,p.summary,now());
     mail(p.id,'inquiry_admin',config.adminEmail,p.service.startsWith('Notary & Apostille')?'New BMS Notary & Apostille request':'New business & sales consulting inquiry',[`${p.name} · ${p.company}\n${p.email} · ${p.phone}\n${p.service} · ${p.budget}\n${p.location}`,p.summary,`Review: ${config.baseUrl}/consulting-admin`]);
     mail(p.id,'inquiry_customer',p.email,p.service.startsWith('Notary & Apostille')?'Your notary service request is with BMS':'Your consulting inquiry is with BMS',[`Thank you, ${p.name}. We received your ${p.service} inquiry.`,p.summary,'We will contact you to clarify scope, timing and the right next step. No project or payment obligation is created by this inquiry.',`Reference: ${p.id}`]);
    });return cors(json({received:true,id:p.id},201));
   }
   if(path==='/api/consulting/access'&&m==='POST'){
    const i=await body(request),email=clean(i.email,254).toLowerCase();requireCondition(validEmail(email),'Enter a valid email.');
    run('DELETE FROM consulting_login_requests WHERE created<?',now()-3600000);
    requireCondition(one('SELECT COUNT(*) AS n FROM consulting_login_requests WHERE email_hash=? AND created>?',hash(email),now()-15*60000).n<3&&one('SELECT COUNT(*) AS n FROM consulting_login_requests WHERE created>?',now()-60000).n<20,'Please wait before requesting another link.',429);
    run('INSERT INTO consulting_login_requests VALUES(?,?)',hash(email),now());
    if(one("SELECT id FROM consulting_projects WHERE email=? AND status<>'Inquiry'",email))login(email);
    return json({message:'If your email has an invited client account, a private sign-in link will arrive shortly.'});
   }
   if(path==='/api/consulting/exchange'&&m==='POST'){
    const i=await body(request),key=hash(i.token||'');const session=token();
    atomic(()=>{const r=one('SELECT * FROM consulting_access WHERE hash=? AND used=0 AND expires>?',key,now());requireCondition(r,'This sign-in link has expired or was already used.',401);run('UPDATE consulting_access SET used=1 WHERE hash=?',key);run('INSERT INTO consulting_sessions VALUES(?,?,?)',hash(session),r.email,now()+7*86400000);});
    return json({ok:true},200,{'Set-Cookie':sessionCookie(session,604800)});
   }
   if(path==='/api/consulting/logout'&&m==='POST'){const raw=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('bms_consulting='))?.slice(15)||'';run('DELETE FROM consulting_sessions WHERE hash=?',hash(raw));return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});}
   if(path.startsWith('/api/admin/consulting/')){
    adminAuth(request);
    if(path.endsWith('/overview')&&m==='GET')return json({paymentReady:ready(),projects:all('SELECT * FROM consulting_projects ORDER BY created DESC LIMIT 250').map(view)});
    const i=await body(request),p=project(i.projectId);
    if(path.endsWith('/project')&&m==='POST'){
     requireCondition(['Discovery','Proposal','Active','On hold','Complete'].includes(i.status),'Choose a project stage.');
     run('UPDATE consulting_projects SET status=?,scope=? WHERE id=?',i.status,clean(i.scope,6000),p.id);return json({ok:true});
    }
    if(path.endsWith('/invite')&&m==='POST'){requireCondition(p.status!=='Inquiry','Set a project stage before inviting the client.',409);login(p.email);return json({queued:true});}
    if(path.endsWith('/milestone')&&m==='POST'){
     requireCondition(['Planned','In progress','Waiting on client','Waiting on agency','Complete'].includes(i.status),'Choose a milestone status.');
     requireCondition(!i.due||/^\d{4}-\d{2}-\d{2}$/.test(i.due),'Use a date.');
     if(i.id){requireCondition(one('SELECT id FROM consulting_milestones WHERE id=? AND project_id=?',i.id,p.id),'Milestone not found.',404);run('UPDATE consulting_milestones SET title=?,status=?,due=? WHERE id=?',text(i.title,180),i.status,clean(i.due,10),i.id);}
     else run('INSERT INTO consulting_milestones VALUES(?,?,?,?,?,?)',randomUUID(),p.id,text(i.title,180),i.status,clean(i.due,10),now());return json({ok:true});
    }
    if(path.endsWith('/invoice')&&m==='POST'){
     requireCondition(p.status!=='Inquiry','Define the engagement before requesting payment.',409);
     requireCondition(Number.isSafeInteger(i.amount)&&i.amount>=100&&i.amount<=10000000,'Enter a payment between $1 and $100,000.');
     const id=randomUUID();run('INSERT INTO consulting_invoices(id,project_id,title,scope,amount,created) VALUES(?,?,?,?,?,?)',id,p.id,text(i.title,180),text(i.scope,3000),i.amount,now());return json({id},201);
    }
    if(path.endsWith('/payment-link')&&m==='POST'){
     const r=one('SELECT * FROM consulting_invoices WHERE id=? AND project_id=?',i.invoiceId||'',p.id);requireCondition(r,'Payment request not found.',404);const link=await checkout(r);
     if(i.send===true)mail(r.id,'payment_link_'+r.attempt,p.email,'Your customized BMS payment link',[`${r.title} · $${(r.amount/100).toFixed(2)}`,r.scope,`Pay securely: ${link.url}`,`Your private project portal: ${config.baseUrl}/client-portal`]);
     return json(link);
    }
    if(path.endsWith('/message')&&m==='POST'){const message=text(i.message,3000);run('INSERT INTO consulting_messages VALUES(?,?,?,?,?)',randomUUID(),p.id,'BMS',message,now());mail(randomUUID(),'message',p.email,'A new update in your BMS client portal',[message,`View your project: ${config.baseUrl}/client-portal`]);return json({ok:true});}
   }else{
    const email=client(request);
    if(path==='/api/consulting/projects'&&m==='GET')return json({projects:all("SELECT * FROM consulting_projects WHERE email=? AND status<>'Inquiry' ORDER BY created DESC",email).map(view)});
    const i=await body(request),p=project(i.projectId,email);requireCondition(p.status!=='Inquiry','Project not found.',404);
    if(path==='/api/consulting/message'&&m==='POST'){const message=text(i.message,3000);run('INSERT INTO consulting_messages VALUES(?,?,?,?,?)',randomUUID(),p.id,'Client',message,now());mail(randomUUID(),'message_admin',config.adminEmail,'New BMS client message',[`${p.company||p.name} · ${p.email}`,message,`Review: ${config.baseUrl}/consulting-admin`]);return json({ok:true});}
    if(path==='/api/consulting/checkout'&&m==='POST'){const r=one('SELECT * FROM consulting_invoices WHERE id=? AND project_id=?',i.invoiceId||'',p.id);requireCondition(r,'Payment request not found.',404);return json(await checkout(r));}
   }
   return json({error:'Not found.'},404);
  }catch(e){return cors(json({error:(e.status||500)>=500?'This service is temporarily unavailable. Please contact BMS.':e.message},e.status||500));}
 };
}
