const CACHE_NAME='imperio-panel-v10-esfirras-global-toggle';
const APP_SHELL=['./','./index.html','./lv-updates.js?v=20260926-esfirras-global-toggle-v1','./manifest.webmanifest','./pwa-icon-192.svg','./pwa-icon-512.svg'];
const PUSH_ACK_URL='https://xzhxqjgekqbyucdgtvra.supabase.co/functions/v1/imperio-web-push';

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('imperio-panel-')&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.hostname.includes('supabase.co'))return;

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(new Request(request,{cache:'no-store'}));
        if(!fresh.ok)throw new Error('Página indisponível');
        const cache=await caches.open(CACHE_NAME);
        cache.put('./index.html',fresh.clone());
        return fresh;
      }catch(error){
        return (await (await caches.open(CACHE_NAME)).match('./index.html'))||(await (await caches.open(CACHE_NAME)).match('./'))||Response.error();
      }
    })());
    return;
  }

  // Código sempre validado na rede; apenas o cache offline pertence a este aplicativo.
  if(request.destination==='script'||request.destination==='style'||url.pathname.endsWith('/lv-updates.js')){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      try{
        const fresh=await fetch(new Request(request,{cache:'no-store'}));
        if(fresh.ok)await cache.put(request,fresh.clone());
        return fresh;
      }catch(error){return (await cache.match(request))||Response.error()}
    })());
    return;
  }
  if(['font','image'].includes(request.destination)||url.origin===self.location.origin){
    event.respondWith((async()=>{
      const cached=await (await caches.open(CACHE_NAME)).match(request);
      const network=fetch(request).then(async response=>{
        if(response&&response.status<400){
          const cache=await caches.open(CACHE_NAME);
          cache.put(request,response.clone());
        }
        return response;
      }).catch(()=>null);
      return cached||(await network)||Response.error();
    })());
  }
});

async function acknowledgeAlert(data){
  if(!data?.alertId||!data?.ackToken)return false;
  try{
    const response=await fetch(PUSH_ACK_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'ack',alertId:data.alertId,ackToken:data.ackToken})
    });
    return response.ok;
  }catch(error){
    console.error('Falha ao parar alerta push',error);
    return false;
  }
}

self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let data={};
    try{data=event.data?.json?.()||{}}catch(error){data={title:'Delivery LV',body:event.data?.text?.()||'Novo alerta'}}
    const title=data.title||'Delivery LV';
    const options={
      body:data.body||'Existe uma atualização que precisa da sua atenção.',
      icon:'./pwa-icon-192.svg',
      badge:'./pwa-icon-192.svg',
      tag:data.tag||`lv-alert-${data.alertId||Date.now()}`,
      renotify:true,
      requireInteraction:true,
      silent:false,
      timestamp:Date.now(),
      vibrate:Array.isArray(data.vibrate)?data.vibrate:[700,180,700,180,900],
      data,
      actions:[
        {action:'stop-alert',title:'Parar alerta'},
        {action:'open-alert',title:'Abrir painel'}
      ]
    };
    await self.registration.showNotification(title,options);
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    windows.forEach(client=>client.postMessage({type:'lv-push-alert',payload:data}));
  })());
});

self.addEventListener('notificationclick',event=>{
  const data=event.notification.data||{};
  const action=event.action;
  event.notification.close();
  event.waitUntil((async()=>{
    if(action==='stop-alert'){
      await acknowledgeAlert(data);
      const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      windows.forEach(client=>client.postMessage({type:'lv-push-stopped',payload:data}));
      return;
    }
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(windows.length){await windows[0].focus();windows[0].postMessage({type:'lv-push-opened',payload:data});return}
    await self.clients.openWindow(data.url||'./');
  })());
});


self.addEventListener('message',event=>{if(event.data?.type==='LV_ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting())});
