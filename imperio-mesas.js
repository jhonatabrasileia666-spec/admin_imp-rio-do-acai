(()=>{
const IMPERIO_ID='01df0795-8f3b-4484-97b5-6b75bb0d3276';
const STAFF_URL='https://xzhxqjgekqbyucdgtvra.supabase.co/functions/v1/imperio-staff-auth';
const $=s=>document.querySelector(s);
const esc=v=>{const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML};
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
let role='owner',mesas=[],products=[],cart={},selectedMesa=null,currentComanda=null,waiters=[];

function db(){return window.getImperioDb?.()}
function profile(){return window.getImperioProfile?.()||{}}

function setLoginRole(next){
  window.IMPERIO_LOGIN_ROLE=next;
  document.querySelectorAll('[data-imperio-login-role]').forEach(b=>b.classList.toggle('active',b.dataset.imperioLoginRole===next));
  const input=$('#login-user'),label=$('#login-user-field label'),desc=$('#login-description');
  if(next==='garcom'){
    if(label)label.textContent='Nome do garçom';
    if(input){input.type='text';input.placeholder='Digite seu nome de acesso';}
    if(desc)desc.textContent='Garçom: entre com o nome e a senha cadastrados pelo administrador.';
  }else{
    if(label)label.textContent='E-mail';
    if(input){input.type='email';input.placeholder='Digite o e-mail cadastrado';}
    if(desc)desc.textContent='Administrador: entre com o e-mail e a senha cadastrados.';
  }
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-imperio-login-role]');
  if(b){e.preventDefault();setLoginRole(b.dataset.imperioLoginRole);}
});

function applyRole(p){
  role=p?.role||'owner';
  document.querySelectorAll('[data-imperio-role]').forEach(el=>{
    const allowed=(el.dataset.imperioRole||'').split(',');
    el.style.display=allowed.includes(role)?'':'none';
  });
  if(role==='garcom'){
    document.querySelectorAll('.nav-item').forEach(el=>{if(el.dataset.view!=='tables')el.style.display='none';});
    ['#store-toggle-button','[data-enable-alerts]','#push-test-local'].forEach(sel=>{const el=$(sel);if(el)el.style.display='none';});
    const acc=$('#account-label'); if(acc)acc.textContent=p.nome||p.login||'Garçom';
    setTimeout(()=>document.querySelector('[data-view="tables"]')?.click(),80);
  }else{
    document.querySelectorAll('.nav-item').forEach(el=>{if(!el.dataset.imperioRole||el.dataset.imperioRole.includes('owner'))el.style.display='';});
  }
}
window.ImperioMesas={applyRole,openTables,openWaiters};

async function loadProducts(){
  const client=db();if(!client)return;
  const {data,error}=await client.from('produtos').select('id,nome,descricao,imagem_url,ativo,categoria_id,produto_variantes(id,tamanho,sabor,preco)').eq('estabelecimento_id',IMPERIO_ID).eq('ativo',true).order('nome');
  if(error)throw error;products=data||[];
}
async function loadMesas(){
  const client=db();const {data,error}=await client.rpc('imperio_listar_mesas');if(error)throw error;mesas=data||[];
}
async function openTables(){
  const root=$('#imperio-tables-root');if(!root)return;
  root.innerHTML='<div class="empty-column">Carregando mesas...</div>';
  try{await Promise.all([loadMesas(),loadProducts()]);renderTables()}catch(e){root.innerHTML='<div class="empty-column">'+esc(e.message)+'</div>'}
}
function renderTables(){
  const root=$('#imperio-tables-root');
  root.innerHTML=`<div class="imperio-tables-grid">${mesas.filter(m=>m.ativo).map(m=>`<button class="imperio-table-card ${m.ocupada?'occupied':'free'}" data-mesa="${m.id}">
    <span>Mesa</span><strong>${m.numero}</strong><small>${m.ocupada?money(m.total):'Livre'}</small>
  </button>`).join('')}</div>`;
  root.querySelectorAll('[data-mesa]').forEach(b=>b.onclick=()=>openMesa(b.dataset.mesa));
}
async function openMesa(id){
  selectedMesa=mesas.find(m=>m.id===id);if(!selectedMesa)return;
  const root=$('#imperio-tables-root');
  const client=db();
  currentComanda=null;
  if(selectedMesa.ocupada){
    const {data}=await client.rpc('imperio_resumo_comanda',{p_mesa_id:id});
    currentComanda=data||null;
  }
  if(role==='garcom')renderWaiterOrder(root);
  else renderOwnerComanda(root);
}
function renderOwnerComanda(root){
  const c=currentComanda;
  root.innerHTML=`<div class="imperio-back"><button class="button secondary" id="mesa-back">← Mesas</button></div>
  <div class="imperio-comanda">
    <div class="imperio-comanda-head"><div><span class="eyebrow">Conta da mesa</span><h2>Mesa ${selectedMesa.numero}</h2></div><strong>${money(c?.total||0)}</strong></div>
    ${c?`<div class="imperio-launches">${(c.pedidos||[]).map(p=>`<article><b>${new Date(p.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</b><span class="imperio-status">${esc(p.status)}</span>${(p.itens||[]).map(i=>`<div class="imperio-line"><span>${i.quantidade}x ${esc(i.produto_nome)} ${esc(i.variante_nome||'')}</span><strong>${money(i.total_item)}</strong></div>`).join('')}${p.observacoes?`<small>Obs.: ${esc(p.observacoes)}</small>`:''}</article>`).join('')}</div>
    <div class="imperio-actions"><button class="button secondary" id="print-comanda">Imprimir comanda</button><button class="button" id="close-comanda">Receber e fechar mesa</button></div>`:'<div class="empty-column">Mesa livre.</div>'}
  </div>`;
  $('#mesa-back').onclick=openTables;
  if(c){
    $('#print-comanda').onclick=()=>printComanda(c);
    $('#close-comanda').onclick=()=>closeComanda(c.id);
  }
}
function printComanda(c){
  const lines=(c.pedidos||[]).flatMap(p=>(p.itens||[]).map(i=>`${i.quantidade}x ${i.produto_nome} ${i.variante_nome||''} — ${money(i.total_item)}`)).join('\n');
  const w=window.open('','_blank','width=420,height=700');if(!w)return;
  w.document.write(`<pre style="font:14px monospace;white-space:pre-wrap">IMPÉRIO DO AÇAÍ\nCOMANDA MESA ${selectedMesa.numero}\n-------------------------\n${esc(lines)}\n-------------------------\nTOTAL: ${money(c.total)}\n</pre><script>print()<\/script>`);
  w.document.close();
}
async function closeComanda(id){
  if(!confirm(`Receber ${money(currentComanda?.total||0)} e fechar a Mesa ${selectedMesa.numero}?`))return;
  const forma=prompt('Forma de pagamento (pix, dinheiro, cartão):','pix')||'';
  const {error}=await db().rpc('imperio_fechar_comanda',{p_comanda_id:id,p_forma_pagamento:forma});if(error){alert(error.message);return}
  await openTables();
}

function renderWaiterOrder(root){
  cart={};
  root.innerHTML=`<div class="imperio-back"><button class="button secondary" id="mesa-back">← Mesas</button></div>
  <div class="imperio-waiter-head"><div><span class="eyebrow">Novo pedido</span><h2>Mesa ${selectedMesa.numero}</h2></div><div>${currentComanda?`Comanda atual: <strong>${money(currentComanda.total)}</strong>`:'Mesa livre — a comanda será aberta no primeiro pedido.'}</div></div>
  <div class="imperio-waiter-layout"><section class="imperio-menu-panel"><div class="imperio-product-grid" id="waiter-products"></div></section>
  <aside class="imperio-cart"><h3>Pedido da mesa</h3><div id="waiter-cart"></div><textarea id="waiter-note" placeholder="Observações"></textarea><div class="imperio-cart-total"><span>Total</span><strong id="waiter-total">R$ 0,00</strong></div><button class="button" id="send-waiter-order">Lançar na comanda</button></aside></div>`;
  $('#mesa-back').onclick=openTables;
  $('#waiter-products').innerHTML=products.map(p=>{
    const vars=p.produto_variantes||[];
    const options=vars.length>1?`<select data-variant-for="${p.id}">${vars.map(v=>`<option value="${v.id}" data-price="${v.preco}">${esc([v.tamanho,v.sabor].filter(Boolean).join(' · ')||'Padrão')} · ${money(v.preco)}</option>`).join('')}</select>`:'';
    const price=vars[0]?.preco||0;
    return `<article class="imperio-product-card"><img src="${esc(p.imagem_url||'')}" alt=""><div><h3>${esc(p.nome)}</h3><p>${esc(p.descricao||'')}</p>${options}<div><strong>${money(price)}</strong><button class="button small" data-add-product="${p.id}">Adicionar</button></div></div></article>`;
  }).join('');
  root.querySelectorAll('[data-add-product]').forEach(b=>b.onclick=()=>addCart(b.dataset.addProduct));
  $('#send-waiter-order').onclick=sendOrder;
  renderCart();
}
function addCart(productId){
  const p=products.find(x=>x.id===productId);if(!p)return;
  const sel=document.querySelector(`[data-variant-for="${CSS.escape(productId)}"]`);
  const variantId=sel?.value||(p.produto_variantes?.[0]?.id||'');
  const key=productId+'|'+variantId;cart[key]=(cart[key]||0)+1;renderCart();
}
function cartInfo(key){
  const [pid,vid]=key.split('|'),p=products.find(x=>x.id===pid),v=p?.produto_variantes?.find(x=>x.id===vid)||p?.produto_variantes?.[0];
  return p&&v?{p,v,price:Number(v.preco||0)}:null;
}
function renderCart(){
  const host=$('#waiter-cart');if(!host)return;let total=0;
  const entries=Object.entries(cart).filter(([,q])=>q>0);
  host.innerHTML=entries.length?entries.map(([k,q])=>{const i=cartInfo(k);if(!i)return'';total+=i.price*q;return `<div class="imperio-cart-line"><div><b>${esc(i.p.nome)}</b><small>${esc([i.v.tamanho,i.v.sabor].filter(Boolean).join(' · '))}</small></div><div><button data-minus="${k}">−</button><b>${q}</b><button data-plus="${k}">+</button></div></div>`}).join(''):'<div class="empty-column">Adicione itens.</div>';
  host.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{cart[b.dataset.minus]=Math.max(0,(cart[b.dataset.minus]||0)-1);renderCart()});
  host.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{cart[b.dataset.plus]=(cart[b.dataset.plus]||0)+1;renderCart()});
  $('#waiter-total').textContent=money(total);$('#send-waiter-order').disabled=!entries.length;
}
async function sendOrder(){
  const itens=Object.entries(cart).filter(([,q])=>q>0).map(([k,quantidade])=>{const [produto_id,variante_id]=k.split('|');return{produto_id,variante_id,quantidade}});
  if(!itens.length)return;
  const btn=$('#send-waiter-order');btn.disabled=true;btn.textContent='Enviando...';
  const {error}=await db().rpc('imperio_criar_pedido_garcom',{p_mesa_id:selectedMesa.id,p_observacoes:$('#waiter-note').value.trim()||null,p_itens:itens});
  btn.disabled=false;btn.textContent='Lançar na comanda';
  if(error){alert(error.message);return}
  alert('Pedido lançado na comanda e enviado para a fila de pedidos.');
  await openTables();
}

async function staffApi(action,params={}){
  const client=db();const {data:{session}}=await client.auth.getSession();
  const r=await fetch(STAFF_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?.access_token||'')},body:JSON.stringify({action,...params})});
  const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p.error||'Erro no servidor');return p.data??p;
}
async function openWaiters(){
  if(role!=='owner')return;
  const root=$('#imperio-waiters-root');root.innerHTML='<div class="empty-column">Carregando garçons...</div>';
  try{waiters=await staffApi('list');renderWaiters()}catch(e){root.innerHTML='<div class="empty-column">'+esc(e.message)+'</div>'}
}
function renderWaiters(){
  const root=$('#imperio-waiters-root');
  root.innerHTML=`<section class="imperio-waiter-create"><h3>Cadastrar garçom</h3><div><input id="new-waiter-name" placeholder="Nome de acesso"><input id="new-waiter-pass" type="password" placeholder="Senha (mín. 6)"><button class="button" id="create-waiter">Cadastrar</button></div></section>
  <div class="imperio-waiter-list">${waiters.map(w=>`<article><div><span class="badge ${w.ativo?'ready':'cancel'}">${w.ativo?'ATIVO':'BLOQUEADO'}</span><h3>${esc(w.nome)}</h3></div><div class="actions"><button class="button secondary small" data-pass="${w.id}">Trocar senha</button><button class="button secondary small" data-toggle="${w.id}" data-active="${w.ativo?'1':'0'}">${w.ativo?'Bloquear':'Reativar'}</button><button class="button danger small" data-delete="${w.id}">Excluir</button></div></article>`).join('')||'<div class="empty-column">Nenhum garçom cadastrado.</div>'}</div>`;
  $('#create-waiter').onclick=createWaiter;
  root.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleWaiter(b.dataset.toggle,b.dataset.active!=='1'));
  root.querySelectorAll('[data-pass]').forEach(b=>b.onclick=()=>changeWaiterPassword(b.dataset.pass));
  root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteWaiter(b.dataset.delete));
}
async function createWaiter(){
  const nome=$('#new-waiter-name').value.trim(),password=$('#new-waiter-pass').value;
  if(!nome||password.length<6){alert('Informe nome e senha com pelo menos 6 caracteres.');return}
  try{await staffApi('create',{nome,password});await openWaiters();alert('Garçom cadastrado. Ele entra usando nome e senha.')}catch(e){alert(e.message)}
}
async function toggleWaiter(id,ativo){try{await staffApi('set_active',{id,ativo});await openWaiters()}catch(e){alert(e.message)}}
async function changeWaiterPassword(id){const password=prompt('Nova senha (mínimo 6 caracteres):');if(!password)return;try{await staffApi('set_password',{id,password});alert('Senha alterada.')}catch(e){alert(e.message)}}
async function deleteWaiter(id){if(!confirm('Excluir este garçom e o acesso dele?'))return;try{await staffApi('delete',{id});await openWaiters()}catch(e){alert(e.message)}}

setLoginRole('owner');
})();