// Small, app-agnostic HTTP adapter for ChainOperatorRuntime.
// This adapter intentionally owns the hard boundary: operator/admin requests
// are loopback-only, mutations must be JSON, and model proposals cannot call
// executeAction except through /confirm with a pending action id.
const isLoopback = address => ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(address||''));
const send=(res,code,value)=>{const body=JSON.stringify(value);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);};
const fail=(res,code,message)=>send(res,code,{error:{type:'operator_error',message}});
const readJson=req=>new Promise((resolve,reject)=>{let size=0;const chunks=[];req.on('data',c=>{size+=c.length;if(size>512*1024){reject(Object.assign(new Error('request body too large'),{statusCode:413}));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{})}catch(e){reject(Object.assign(new Error('invalid JSON body'),{statusCode:400}))}});req.on('error',reject)});

export function createOperatorHttp({runtime,getContext,security,doctor,logs,saveProviderKey}){
  return async function handleOperator(req,res,url){
    if(!url.pathname.startsWith('/admin/operator/'))return false;
    if(!isLoopback(req.socket.remoteAddress)){fail(res,403,'Operator routes are loopback-only.');return true;}
    const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&site&&!['same-origin','none'].includes(site)){fail(res,403,'Cross-site operator mutations are blocked.');return true;}
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||''))){fail(res,415,'Operator mutations require application/json.');return true;}
    try{
      if(url.pathname==='/admin/operator/settings'&&req.method==='GET'){send(res,200,runtime.readSettings());return true;}
      if(url.pathname==='/admin/operator/settings'&&req.method==='POST'){send(res,200,runtime.saveSettings(await readJson(req)));return true;}
      if(url.pathname==='/admin/operator/key'&&req.method==='POST'){const {key}=await readJson(req);send(res,200,runtime.saveControlKey(key));return true;}
      if(url.pathname==='/admin/operator/provider-key'&&req.method==='POST'){if(typeof saveProviderKey!=='function'){fail(res,409,'Direct provider-key setup is unavailable in this app.');return true;}const {provider,key}=await readJson(req);send(res,200,await saveProviderKey(provider,key));return true;}
      if(url.pathname==='/admin/operator/context'&&req.method==='GET'){send(res,200,await getContext());return true;}
      if(url.pathname==='/admin/operator/security'&&req.method==='GET'){send(res,200,await security());return true;}
      if(url.pathname==='/admin/operator/logs'&&req.method==='GET'){send(res,200,await logs({limit:url.searchParams.get('limit')||100,before:url.searchParams.get('before')||undefined,status:url.searchParams.get('status')||undefined,provider:url.searchParams.get('provider')||undefined,route:url.searchParams.get('route')||undefined,q:url.searchParams.get('q')||undefined}));return true;}
      if(url.pathname==='/admin/operator/pending'&&req.method==='GET'){send(res,200,{actions:runtime.listPending()});return true;}
      if(url.pathname==='/admin/operator/reject'&&req.method==='POST'){const {id}=await readJson(req);send(res,200,runtime.reject(id));return true;}
      if(url.pathname==='/admin/operator/confirm'&&req.method==='POST'){const {id}=await readJson(req);send(res,200,await runtime.confirm(id));return true;}
      if(url.pathname==='/admin/operator/chat'&&req.method==='POST'){const {message,history}=await readJson(req);if(typeof message!=='string'||!message.trim()){fail(res,400,'message is required');return true;}const abort=new AbortController();req.once('close',()=>{if(!res.writableEnded)abort.abort()});send(res,200,await runtime.chat(message,history,abort.signal));return true;}
      if(url.pathname==='/admin/operator/doctor'&&req.method==='GET'){send(res,200,await doctor());return true;}
      fail(res,404,`No operator route for ${req.method} ${url.pathname}`);return true;
    }catch(error){fail(res,error.statusCode||500,error.statusCode?String(error.message||error):'Internal operator error.');return true;}
  };
}
