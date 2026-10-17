import { randomUUID } from 'node:crypto';
import { requireCondition } from './domain.js';
import { validEmail } from './notifications.js';
export function roomQuote(i, now=Date.now()) {
 const date=i.date;
 const parsed=typeof date==='string'?new Date(date+'T12:00:00Z'):new Date(NaN);
 requireCondition(typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>='2026-11-15'&&date<='2028-12-31'&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date,'Choose a valid date from November 15, 2026.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 requireCondition(date>=today,'Choose today or a future date.');
 requireCondition(['day','hourly'].includes(i.plan),'Choose hourly or full day.');
 const start=i.plan==='day'?360:Number(i.start),duration=i.plan==='day'?720:Number(i.hours)*60,guests=Number(i.guests);
 requireCondition(Number.isInteger(start)&&start%60===0&&start>=360&&Number.isInteger(duration)&&duration%60===0&&duration>=120&&start+duration<=1080,'Choose at least two whole hours between 6 AM and 6 PM.');
 requireCondition(Number.isInteger(guests)&&guests>=1&&guests<=6,'Maximum six guests.');
 if(date===today){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));const get=t=>Number(parts.find(p=>p.type===t).value);requireCondition(start>get('hour')*60+get('minute'),'Choose a future start time.');}
 return {date,start,end:start+duration,guests,plan:i.plan,amount:i.plan==='day'?16500:duration/60*4500};
}
export function createRoomRoutes({db,stripe,config,adminAuth,body,notifications,now=Date.now}) {
 db.exec(`CREATE TABLE IF NOT EXISTS room_bookings(id TEXT PRIMARY KEY,date TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,guests INTEGER NOT NULL,plan TEXT NOT NULL,amount INTEGER NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,checkout_id TEXT UNIQUE,checkout_url TEXT,checkout_params TEXT,payment_intent TEXT UNIQUE,created INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS room_inventory ON room_bookings(date,status,start,end);CREATE TABLE IF NOT EXISTS room_events(id TEXT PRIMARY KEY,created INTEGER NOT NULL);`);
 const one=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a),json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
 const clean=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
 const ready=()=>Boolean(config.roomPaymentsEnabled&&config.roomStripeKey&&config.roomWebhookSecret&&stripe);
 const conflict=r=>one("SELECT id FROM room_bookings WHERE date=? AND start<? AND end>? AND status IN ('held','processing','confirmed','blocked') AND id<>?",r.date,r.end,r.start,r.id||'');
 const time=m=>`${Math.floor(m/60)%12||12}:${String(m%60).padStart(2,'0')} ${m<720?'AM':'PM'}`;
 const describe=r=>`${r.date}, ${time(r.start)}–${time(r.end)} Eastern · ${r.guests} guests · $${(r.amount/100).toFixed(2)}\nBooking reference: ${r.id}`;
 const notify=(r,kind,title,lines,to=config.adminEmail)=>notifications.room(r.id,kind,to,title,lines);
 const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 async function checkout(r){
    if(r.checkout_id){const s=await stripe.checkout.sessions.retrieve(r.checkout_id);requireCondition(s.status==='open','This checkout is closed. Review the reservation.',409);return {url:r.checkout_url,sessionId:r.checkout_id};}
    atomic(()=>{requireCondition(!conflict(r),'This time is no longer available.',409);run("UPDATE room_bookings SET status='held' WHERE id=?",r.id);});
    // Keep inventory held on ambiguous network results; retry with the same idempotency key.
    let params=r.checkout_params ? JSON.parse(r.checkout_params) : {mode:'payment',customer_email:r.email,client_reference_id:r.id,metadata:{bms_room_id:r.id},payment_intent_data:{metadata:{bms_room_id:r.id}},line_items:[{price_data:{currency:'usd',unit_amount:r.amount,product_data:{name:r.plan==='day'?'BMS Private Meeting Room — Full Day':'BMS Private Meeting Room — Hourly',description:describe(r)}},quantity:1}],expires_at:Math.floor(now()/1000)+1800,success_url:config.baseUrl+'/room-return?session_id={CHECKOUT_SESSION_ID}',cancel_url:config.baseUrl+'/room-return?cancelled=1&session_id={CHECKOUT_SESSION_ID}',integration_identifier:'bms_room_rentals_jthervil'};
    if(!r.checkout_params){run('UPDATE room_bookings SET checkout_params=COALESCE(checkout_params,?) WHERE id=?',JSON.stringify(params),r.id);params=JSON.parse(one('SELECT checkout_params FROM room_bookings WHERE id=?',r.id).checkout_params);}
    const s=await stripe.checkout.sessions.create(params,{idempotencyKey:'bms-room-'+r.id});
    requireCondition(s.livemode===(config.paymentMode==='live'),'Unexpected Stripe environment.',502);run('UPDATE room_bookings SET checkout_id=?,checkout_url=? WHERE id=?',s.id,s.url,r.id);notify(r,'payment_link','Complete your room reservation',[describe(r),'Your time is temporarily held while this payment link is open. Complete payment to confirm: '+s.url,'Optional upgrades are quoted separately.'],r.email);return {url:s.url,sessionId:s.id};
 }
 async function webhook(request){
  requireCondition(stripe&&config.roomWebhookSecret,'Payment connection unavailable.',503);
  let e;try{e=stripe.webhooks.constructEvent(Buffer.from(await request.arrayBuffer()),request.headers.get('stripe-signature'),config.roomWebhookSecret);}catch{return json({error:'Invalid signature.'},400);}
  requireCondition(e.livemode===(config.paymentMode==='live')&&!e.account,'Unexpected payment environment.',400);
  if(one('SELECT id FROM room_events WHERE id=?',e.id))return json({received:true});
  const s=e.data.object,r=one('SELECT * FROM room_bookings WHERE checkout_id=?',s.id||'');
  if(r&&['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','checkout.session.async_payment_failed'].includes(e.type)){
   requireCondition(s.metadata?.bms_room_id===r.id&&s.client_reference_id===r.id&&s.amount_total===r.amount&&s.currency==='usd','Payment mismatch.',409);
   atomic(()=>{if(one('SELECT id FROM room_events WHERE id=?',e.id))return;
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(e.type)){
     requireCondition(['held','processing','confirmed'].includes(r.status),'Booking needs review.',409);
     if(s.payment_status==='paid'){
      run("UPDATE room_bookings SET status='confirmed',payment_intent=? WHERE id=?",s.payment_intent,r.id);
      notify(r,'confirmed_'+r.email,'Your meeting room is confirmed',[`Thank you, ${r.name}. Your payment has been verified and your private room is reserved.`,describe(r),'Bonita Multi-Services · Oak Creek Crossing\n11100 Bonita Beach Road, Unit 108-B-1&2, Bonita Springs, FL 34135','Please include setup and packing up within your reserved hours. Maximum six guests. TV and whiteboard are available.','Coffee, breakfast catering, printing and scanning are optional and quoted separately. BMS will coordinate your equipment needs and arrival details. For help or booking changes, reply to this email or call 941-404-5379.'],r.email);
      notify(r,'confirmed_'+config.adminEmail,'Paid meeting room booking — action required',[describe(r),`Customer: ${r.name}\nEmail: ${r.email}\nPhone: ${r.phone}`,r.notes||'No optional requests provided.','Coordinate arrival and equipment needs with the customer. Quote any requested upgrades separately.',`Review the reservation: ${config.baseUrl}/room-admin`],config.adminEmail);
     }else run("UPDATE room_bookings SET status='processing' WHERE id=? AND status='held'",r.id);
    }else run("UPDATE room_bookings SET status='expired' WHERE id=? AND status IN ('held','processing')",r.id);
    run('INSERT INTO room_events VALUES(?,?)',e.id,now());
   });
  }
  return json({received:true});
 }
 return async request=>{
  const u=new URL(request.url),p=u.pathname,m=request.method;
  if(!p.startsWith('/api/room/')&&!p.startsWith('/api/admin/room/'))return null;
  const o=request.headers.get('origin'),pub=p.startsWith('/api/room/'),allowed=o===config.baseUrl||(pub&&['https://bonitamultiservices.com','https://www.bonitamultiservices.com'].includes(o));
  const cors=r=>{if(allowed){r.headers.set('Access-Control-Allow-Origin',o);r.headers.set('Vary','Origin');r.headers.set('Access-Control-Allow-Headers','Content-Type');r.headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');}return r;};
  try{
   if(m==='OPTIONS')return cors(new Response(null,{status:204}));
   if(p==='/api/room/webhook'&&m==='POST')return await webhook(request);
   if(m==='POST')requireCondition(allowed,'Request origin is not allowed.',403);
   if(!pub)adminAuth(request);
   if(p==='/api/room/cancel'&&m==='POST'){
    requireCondition(stripe&&config.roomStripeKey,'Payment connection unavailable.',503);const i=await body(request),id=i.session_id||'';
    requireCondition(/^cs_(live|test)_[A-Za-z0-9_]{8,255}$/.test(id),'Invalid checkout reference.');
    const r=one('SELECT * FROM room_bookings WHERE checkout_id=?',id);requireCondition(r&&['held','expired'].includes(r.status),'Only an unpaid checkout hold can be released.',409);
    let session=await stripe.checkout.sessions.retrieve(id);requireCondition(session.livemode===(config.paymentMode==='live'),'Unexpected payment environment.',409);
    if(session.status==='open')session=await stripe.checkout.sessions.expire(id,{},{idempotencyKey:'room-expire-'+r.id});
    requireCondition(session.status==='expired','Payment is already complete or processing. Contact BMS for changes.',409);
    run("UPDATE room_bookings SET status='expired' WHERE id=? AND status='held'",r.id);return cors(json({released:true}));
   }
   if(p==='/api/room/status'&&m==='GET'){
    const id=u.searchParams.get('session_id')||'';requireCondition(/^cs_(live|test)_[A-Za-z0-9_]{8,255}$/.test(id),'Invalid checkout reference.');
    const r=one('SELECT id,date,start,end,guests,amount,status FROM room_bookings WHERE checkout_id=?',id);requireCondition(r,'Reservation not found.',404);return cors(json(r));
   }
   if(p==='/api/room/availability'&&m==='GET'){
    const date=u.searchParams.get('date');requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(date||''),'Choose a date.');
    return cors(json({date,timezone:'America/New_York',openingDate:'2026-11-15',opens:360,closes:1080,requestsEnabled:Boolean(config.roomRequestsEnabled),paymentReady:ready(),busy:db.prepare("SELECT start,end FROM room_bookings WHERE date=? AND status IN ('held','processing','confirmed','blocked') ORDER BY start").all(date)}));
   }
   if(p==='/api/room/requests'&&m==='POST'){
    requireCondition(config.roomRequestsEnabled,'Online requests are unavailable. Please call BMS.',503);
    const i=await body(request),q=roomQuote(i,now()),name=clean(i.name,100),email=clean(i.email,254).toLowerCase(),phone=clean(i.phone,40),notes=clean(i.notes,1000);
    requireCondition(i.consent===true,'Accept the reservation terms.');requireCondition(name.length>=2&&validEmail(email)&&phone.length>=7,'Enter your name, valid email and phone.');
    requireCondition(!conflict(q),'This time is unavailable. Choose another.',409);
    requireCondition(one('SELECT COUNT(*) AS n FROM room_bookings WHERE email=? AND created>?',email,now()-3600000).n<5,'Please contact BMS to update your request.',429);
    requireCondition(one('SELECT COUNT(*) AS n FROM room_bookings WHERE created>?',now()-60000).n<10,'Please try again shortly or call BMS.',429);
    const id=randomUUID();atomic(()=>{run("INSERT INTO room_bookings(id,date,start,end,guests,plan,amount,name,email,phone,notes,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",id,q.date,q.start,q.end,q.guests,q.plan,q.amount,name,email,phone,notes,'requested',now());const r=one('SELECT * FROM room_bookings WHERE id=?',id);notify(r,'request_admin','Meeting room request',[describe(r),`${name} · ${email} · ${phone}`,notes,`Review: ${config.baseUrl}/room-admin`]);notify(r,'request_customer','We received your meeting room request',[describe(r),'This is a request, not a confirmed reservation. BMS will check availability and send payment instructions. Optional upgrades require a separate quote.'],email);});
    if(i.payNow===true && ready()){const payment=await checkout(one('SELECT * FROM room_bookings WHERE id=?',id));return cors(json({id,status:'held',checkoutUrl:payment.url,checkoutSessionId:payment.sessionId},201));}
    return cors(json({id,status:'requested',message:'Your request was received. BMS will confirm availability and send payment instructions.'},201));
   }
   if(p==='/api/admin/room/overview'&&m==='GET')return json({paymentReady:ready(),requestsEnabled:Boolean(config.roomRequestsEnabled),bookings:db.prepare('SELECT id,date,start,end,guests,plan,amount,name,email,phone,notes,status,checkout_url FROM room_bookings ORDER BY date,start,created LIMIT 500').all()});
   if(p==='/api/admin/room/block'&&m==='POST'){
    const i=await body(request),q=roomQuote({...i,guests:1},now()),id=randomUUID();atomic(()=>{requireCondition(!conflict(q),'Time overlaps a reservation.',409);run("INSERT INTO room_bookings(id,date,start,end,guests,plan,amount,name,email,phone,notes,status,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",id,q.date,q.start,q.end,1,q.plan,0,'BMS internal use',config.adminEmail,'',clean(i.notes,1000),'blocked',now());});return json({id,status:'blocked'},201);
   }
   if(p==='/api/admin/room/release'&&m==='POST'){
    const i=await body(request),r=one('SELECT * FROM room_bookings WHERE id=?',i.id||'');requireCondition(r&&['requested','blocked'].includes(r.status),'Only unpaid requests or internal blocks can be released here.',409);run("UPDATE room_bookings SET status='cancelled' WHERE id=?",r.id);return json({cancelled:true});
   }
   if(p==='/api/admin/room/checkout'&&m==='POST'){
    requireCondition(ready(),'Connect the BMS direct-service Stripe key and room webhook first.',503);
    const i=await body(request),r=one('SELECT * FROM room_bookings WHERE id=?',i.id||'');requireCondition(r&&['requested','held'].includes(r.status),'Choose an unpaid request.',409);
    return json(await checkout(r));
   }
   return json({error:'Not found.'},404);
  }catch(e){return cors(json({error:(e.status||500)<500?e.message:'This service is not ready right now. Please contact BMS.'},e.status||500));}
 };
}
