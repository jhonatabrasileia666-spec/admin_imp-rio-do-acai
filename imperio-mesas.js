(()=>{
const IMPERIO_ID='01df0795-8f3b-4484-97b5-6b75bb0d3276';
const STAFF_URL='https://xzhxqjgekqbyucdgtvra.supabase.co/functions/v1/imperio-staff-auth';
const $=s=>document.querySelector(s);
const esc=v=>{const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML};
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
let role='owner',mesas=[],products=[],categories=[],cart={},selectedMesa=null,currentComanda=null,waiters=[],waiterCategory='all';

function db(){return window.getImperioDb?.()}
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
    const acc=$('#account-label');if(acc)acc.textContent=p.nome||p.login||'Garçom';
    setTimeout(()=>document.querySelector('[data-view="tables"]')?.click(),80);
  }else{
    document.querySelectorAll('.nav-item').forEach(el=>{if(!el.dataset.imperioRole||el.dataset.imperioRole.includes('owner'))el.style.display='';});
  }
}
window.ImperioMesas={applyRole,openTables,openWaiters};

async function loadCatalog(){
  const client=db();if(!client)return;
  const [{data:cats,error:ce},{data:prods,error:pe}]=await Promise.all([
    client.from('categorias').select('id,nome,ordem').eq('estabelecimento_id',IMPERIO_ID).order('ordem').order('nome'),
    client.from('produtos').select('id,nome,descricao,imagem_url,ativo,categoria_id,produto_variantes(id,tamanho,sabor,preco)').eq('estabelecimento_id',IMPERIO_ID).eq('ativo',true).order('nome')
  ]);
  if(ce)throw ce;if(pe)throw pe;
  categories=cats||[];products=prods||[];
}
async function loadMesas(){
  const {data,error}=await db().rpc('imperio_listar_mesas');
  if(error)throw error;mesas=data||[];
}
async function openTables(){
  const root=$('#imperio-tables-root');if(!root)return;
  root.innerHTML='<div class="empty-column">Carregando mesas...</div>';
  selectedMesa=null;currentComanda=null;cart={};waiterCategory='all';
  try{
    await Promise.all([loadMesas(),loadCatalog()]);
    if(role==='garcom')renderWaiterTables();
    else renderAdminTables();
  }catch(e){root.innerHTML='<div class="empty-column">'+esc(e.message)+'</div>'}
}

function renderAdminTables(){
  const root=$('#imperio-tables-root');
  root.innerHTML=`
    <div id="admin-tables-view">
      <div class="panel lw-panel">
        <div class="panel-head"><div><h2>Mesas e comandas</h2><p>Clique em uma mesa ocupada para conferir a conta, imprimir a comanda e receber o pagamento.</p></div>
        <button class="button secondary small" id="refresh-admin-tables" type="button">Atualizar mesas</button></div>
        <div class="tables-grid admin-table-grid" id="admin-operational-tables"></div>
      </div>
    </div>
    <div id="admin-comanda-view" hidden>
      <div class="waiter-order-head"><button class="button secondary" id="back-to-admin-tables" type="button">← Mesas</button>
      <div><span class="eyebrow">Conta da mesa</span><h2 id="admin-comanda-title">Mesa</h2><p class="waiter-comanda-summary">Confira o consumo, imprima para o cliente e registre o pagamento.</p></div></div>
      <div id="admin-comanda-detail"></div>
    </div>`;
  const box=$('#admin-operational-tables');
  box.innerHTML=mesas.filter(m=>m.ativo).map(m=>{
    const occupied=!!m.ocupada;
    const stateText=!occupied?'Livre':'Em atendimento';
    return `<button class="table-card ${occupied?'occupied':'free'}" type="button" ${occupied?`data-open-admin-table="${m.id}"`:'disabled'}>
      <b>Mesa ${esc(m.numero)}</b><span>${stateText}</span>${occupied?`<span class="table-account">${money(m.total)} · abrir comanda</span>`:'<span class="table-account">Aguardando atendimento</span>'}
    </button>`;
  }).join('')||'<div class="empty-column">Nenhuma mesa cadastrada.</div>';
  $('#refresh-admin-tables').onclick=openTables;
  box.querySelectorAll('[data-open-admin-table]').forEach(b=>b.onclick=()=>openAdminTable(b.dataset.openAdminTable));
}
async function openAdminTable(id){
  selectedMesa=mesas.find(m=>m.id===id);if(!selectedMesa)return;
  const {data,error}=await db().rpc('imperio_resumo_comanda',{p_mesa_id:id});
  if(error){alert(error.message);return}
  currentComanda=data;
  $('#admin-tables-view').hidden=true;$('#admin-comanda-view').hidden=false;
  $('#admin-comanda-title').textContent=`Mesa ${selectedMesa.numero}`;
  renderAdminComanda();
}
function renderAdminComanda(){
  const host=$('#admin-comanda-detail'),c=currentComanda;
  if(!c){host.innerHTML='<div class="empty-column">Comanda não encontrada.</div>';return}
  const orders=(c.pedidos||[]).filter(p=>p.status!=='cancelado');
  const pending=orders.filter(p=>['novo','em_preparo'].includes(p.status)).length;
  const ready=orders.filter(p=>p.status==='pronto').length;
  const items=new Map();
  for(const p of orders)for(const i of p.itens||[]){
    const key=[i.produto_nome,i.variante_nome,i.preco_unitario].join('|');
    const row=items.get(key)||{name:i.produto_nome,variant:i.variante_nome,qty:0,total:0,price:Number(i.preco_unitario||0)};
    row.qty+=Number(i.quantidade||0);row.total+=Number(i.total_item||0);items.set(key,row);
  }
  host.innerHTML=`<article class="comanda-card">
    <div class="comanda-head"><div><h3>Mesa ${esc(c.mesa_numero)}</h3><p>Comanda aberta em ${new Date(c.aberta_em).toLocaleString('pt-BR')}</p></div>
    <div class="comanda-total"><span>Total da comanda</span><strong>${money(c.total)}</strong></div></div>
    <div class="comanda-body">
      <div class="comanda-status-line"><span class="comanda-status-pill">${orders.length} lançamento${orders.length===1?'':'s'}</span><span class="comanda-status-pill">${ready} pronto${ready===1?'':'s'}</span>${pending?`<span class="comanda-status-pill">${pending} pendente${pending===1?'':'s'}</span>`:''}</div>
      <div class="comanda-items">${[...items.values()].map(i=>`<div class="comanda-item"><div><b>${i.qty}x ${esc(i.name)}${i.variant?' · '+esc(i.variant):''}</b><span>${money(i.price)} cada</span></div><strong>${money(i.total)}</strong></div>`).join('')||'<div class="empty-column">Sem itens.</div>'}</div>
      <details class="comanda-history"><summary>Ver histórico de todos os pedidos</summary>${orders.map(p=>`<div class="comanda-launch"><div class="comanda-launch-head"><b>Pedido · ${new Date(p.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</b><span>${esc(p.status)} · ${money(p.total)}</span></div><ul>${(p.itens||[]).map(i=>`<li>${i.quantidade}x ${esc(i.produto_nome)}${i.variante_nome?' · '+esc(i.variante_nome):''}</li>`).join('')}</ul>${p.observacoes?`<p>Obs.: ${esc(p.observacoes)}</p>`:''}</div>`).join('')}</details>
    </div>
    <div class="comanda-actions">${pending?`<div class="comanda-warning">Ainda há ${pending} pedido${pending===1?'':'s'} novo/em preparo. A comanda só pode ser fechada quando a cozinha terminar.</div>`:''}
      <button class="button secondary" id="print-comanda" type="button">Imprimir comanda</button>
      <button class="button" id="close-comanda" type="button" ${pending?'disabled':''}>Receber e fechar mesa</button>
    </div>
  </article>`;
  $('#back-to-admin-tables').onclick=renderAdminTables;
  $('#print-comanda').onclick=()=>printComanda(c);
  $('#close-comanda').onclick=()=>closeComanda(c.id);
}

function renderWaiterTables(){
  const root=$('#imperio-tables-root');
  root.innerHTML=`<div id="waiter-tables-view">
    <div class="panel lw-panel"><div class="panel-head"><div><h2>Mesas</h2><p>Escolha a mesa para lançar o pedido do cliente</p></div><button class="button secondary small" id="refresh-tables">Atualizar mesas</button></div>
    <div class="tables-grid" id="waiter-tables"></div></div>
  </div>
  <div id="waiter-order-view" hidden>
    <div class="waiter-order-head"><button class="button secondary" id="back-to-tables">← Mesas</button><div><span class="eyebrow">Novo pedido</span><h2 id="waiter-table-title">Mesa</h2><p class="waiter-comanda-summary" id="waiter-comanda-summary"></p><div class="waiter-existing-comanda" id="waiter-existing-comanda" hidden></div></div></div>
    <div class="waiter-layout"><div class="panel lw-panel"><div class="panel-head"><div><h2>Cardápio</h2><p>Toque em adicionar para montar o pedido</p></div></div><div class="waiter-cats" id="waiter-cats"></div><div class="waiter-products" id="waiter-products"></div></div>
    <div class="panel lw-panel waiter-cart"><div class="panel-head"><div><h2>Pedido da mesa</h2><p>Revise os itens antes de lançar na comanda</p></div></div><div class="waiter-cart-list" id="waiter-cart-items"></div><div class="waiter-cart-foot"><textarea id="waiter-note" placeholder="Observações do cliente (opcional)"></textarea><div class="waiter-total"><span>Total</span><strong id="waiter-total">R$ 0,00</strong></div><button class="button waiter-send" id="send-table-order">Lançar pedido na mesa</button></div></div></div>
  </div>`;
  $('#waiter-tables').innerHTML=mesas.filter(m=>m.ativo).map(m=>`<button class="table-card ${m.ocupada?'occupied':''}" data-open-table="${m.id}"><b>Mesa ${m.numero}</b><span>${m.ocupada?'Em atendimento · Adicionar pedido':'Livre · Abrir pedido'}</span>${m.ocupada?`<span class="table-account">Comanda ${money(m.total)}</span>`:''}</button>`).join('')||'<div class="empty-column">Nenhuma mesa cadastrada.</div>';
  $('#refresh-tables').onclick=openTables;
  document.querySelectorAll('[data-open-table]').forEach(b=>b.onclick=()=>openWaiterTable(b.dataset.openTable));
}
async function openWaiterTable(id){
  selectedMesa=mesas.find(m=>m.id===id)||null;if(!selectedMesa)return;
  cart={};waiterCategory='all';currentComanda=null;
  $('#waiter-tables-view').hidden=true;$('#waiter-order-view').hidden=false;
  if(selectedMesa.ocupada){
    const {data}=await db().rpc('imperio_resumo_comanda',{p_mesa_id:id});currentComanda=data||null;
  }
  renderWaiterOrder();
  window.scrollTo({top:0,behavior:'smooth'});
}
function renderWaiterOrder(){
  $('#waiter-table-title').textContent=`Mesa ${selectedMesa.numero}`;
  $('#waiter-comanda-summary').textContent=selectedMesa.ocupada?`Comanda aberta · ${money(selectedMesa.total)} consumidos`:'Nova comanda será aberta ao enviar o primeiro pedido.';
  const existing=$('#waiter-existing-comanda');
  if(existing){
    const allItems=(currentComanda?.pedidos||[]).flatMap(p=>p.itens||[]);
    existing.hidden=!selectedMesa.ocupada;
    existing.innerHTML=selectedMesa.ocupada?(allItems.length?`<b>Já pedido nesta mesa</b>${allItems.map(i=>`<div class="waiter-existing-item"><span>${i.quantidade}x ${esc(i.produto_nome)}${i.variante_nome?' · '+esc(i.variante_nome):''}</span><strong>${money(i.total_item)}</strong></div>`).join('')}`:'<b>Comanda aberta</b><span>Sem itens carregados.</span>'):'';
  }
  const cats=[{id:'all',nome:'Todos'},...categories];
  $('#waiter-cats').innerHTML=cats.map(c=>`<button class="${waiterCategory===c.id?'active':''}" data-waiter-cat="${c.id}">${esc(c.nome)}</button>`).join('');
  $('#waiter-cats').querySelectorAll('[data-waiter-cat]').forEach(b=>b.onclick=()=>{waiterCategory=b.dataset.waiterCat;renderWaiterOrder()});
  const filtered=products.filter(p=>waiterCategory==='all'||p.categoria_id===waiterCategory);
  $('#waiter-products').innerHTML=filtered.map(p=>{
    const vars=p.produto_variantes||[];
    const useful=vars.length>1;
    const options=useful?`<select data-waiter-variant="${p.id}">${vars.map(v=>`<option value="${v.id}">${esc([v.tamanho,v.sabor].filter(Boolean).join(' · ')||'Padrão')} · ${money(v.preco)}</option>`).join('')}</select>`:'';
    const first=vars[0];return `<article class="waiter-product"><img src="${esc(p.imagem_url||'')}" alt=""><div><h3>${esc(p.nome)}</h3><p>${esc(p.descricao||'')}</p>${options}<div class="waiter-product-bottom"><strong>${money(first?.preco||0)}</strong><button class="button small" data-waiter-add="${p.id}">Adicionar</button></div></div></article>`;
  }).join('')||'<div class="empty-column">Nenhum item nesta categoria.</div>';
  $('#waiter-products').querySelectorAll('[data-waiter-add]').forEach(b=>b.onclick=e=>{e.stopPropagation();addCart(b.dataset.waiterAdd)});
  renderCart();
}
function addCart(productId){
  const p=products.find(x=>x.id===productId);if(!p)return;
  const sel=document.querySelector(`[data-waiter-variant="${CSS.escape(productId)}"]`);
  const variantId=sel?.value||(p.produto_variantes?.[0]?.id||'');
  const key=productId+'|'+variantId;cart[key]=(cart[key]||0)+1;renderCart();
}
function cartInfo(key){const [pid,vid]=key.split('|'),p=products.find(x=>x.id===pid),v=p?.produto_variantes?.find(x=>x.id===vid)||p?.produto_variantes?.[0];return p&&v?{p,v,price:Number(v.preco||0)}:null}
function renderCart(){
  const entries=Object.entries(cart).filter(([,q])=>q>0);let total=0;
  $('#waiter-cart-items').innerHTML=entries.length?entries.map(([key,q])=>{const i=cartInfo(key);if(!i)return'';total+=i.price*q;return `<div class="waiter-cart-item"><div><b>${esc(i.p.nome)}${i.v&&[i.v.tamanho,i.v.sabor].filter(Boolean).length?' · '+esc([i.v.tamanho,i.v.sabor].filter(Boolean).join(' · ')):''}</b><span>${money(i.price)} cada</span></div><div class="waiter-qty"><button data-waiter-minus="${key}">−</button><b>${q}</b><button data-waiter-plus="${key}">+</button></div></div>`}).join(''):'<div class="empty-column">Pedido vazio. Adicione itens do cardápio.</div>';
  document.querySelectorAll('[data-waiter-minus]').forEach(b=>b.onclick=()=>{cart[b.dataset.waiterMinus]=Math.max(0,(cart[b.dataset.waiterMinus]||0)-1);renderCart()});
  document.querySelectorAll('[data-waiter-plus]').forEach(b=>b.onclick=()=>{cart[b.dataset.waiterPlus]=(cart[b.dataset.waiterPlus]||0)+1;renderCart()});
  $('#waiter-total').textContent=money(total);$('#send-table-order').disabled=!entries.length;
}
async function sendOrder(){
  const entries=Object.entries(cart).filter(([,q])=>q>0);if(!entries.length)return;
  const itens=entries.map(([key,quantidade])=>{const [produto_id,variante_id]=key.split('|');return{produto_id,variante_id,quantidade}});
  const btn=$('#send-table-order');btn.disabled=true;btn.textContent='Enviando...';
  const {error}=await db().rpc('imperio_criar_pedido_garcom',{p_mesa_id:selectedMesa.id,p_observacoes:$('#waiter-note').value.trim()||null,p_itens:itens});
  btn.disabled=false;btn.textContent='Lançar pedido na mesa';
  if(error){alert(error.message);return}
  alert('Pedido adicionado à comanda da mesa.');
  $('#waiter-order-view').hidden=true;$('#waiter-tables-view').hidden=false;
  await Promise.all([loadMesas(),loadCatalog()]);renderWaiterTables();
}
function printComanda(c){
  const lines=(c.pedidos||[]).flatMap(p=>(p.itens||[]).map(i=>`${i.quantidade}x ${i.produto_nome}${i.variante_nome?' · '+i.variante_nome:''} — ${money(i.total_item)}`)).join('\n');
  const w=window.open('','_blank','width=420,height=700');if(!w)return;
  w.document.write(`<pre style="font:14px monospace;white-space:pre-wrap">IMPÉRIO DO AÇAÍ\nCOMANDA MESA ${selectedMesa.numero}\n-------------------------\n${esc(lines)}\n-------------------------\nTOTAL: ${money(c.total)}\n</pre><script>print()<\/script>`);w.document.close();
}
async function closeComanda(id){
  if(!confirm(`Receber ${money(currentComanda?.total||0)} e fechar a Mesa ${selectedMesa.numero}?`))return;
  const forma=prompt('Forma de pagamento (pix, dinheiro, cartão):','pix')||'';
  const {error}=await db().rpc('imperio_fechar_comanda',{p_comanda_id:id,p_forma_pagamento:forma});if(error){alert(error.message);return}
  await openTables();
}

async function staffApi(action,params={}){
  const {data:{session}}=await db().auth.getSession();
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
async function createWaiter(){const nome=$('#new-waiter-name').value.trim(),password=$('#new-waiter-pass').value;if(!nome||password.length<6){alert('Informe nome e senha com pelo menos 6 caracteres.');return}try{await staffApi('create',{nome,password});await openWaiters();alert('Garçom cadastrado.')}catch(e){alert(e.message)}}
async function toggleWaiter(id,ativo){try{await staffApi('set_active',{id,ativo});await openWaiters()}catch(e){alert(e.message)}}
async function changeWaiterPassword(id){const password=prompt('Nova senha (mínimo 6 caracteres):');if(!password)return;try{await staffApi('set_password',{id,password});alert('Senha alterada.')}catch(e){alert(e.message)}}
async function deleteWaiter(id){if(!confirm('Excluir este garçom e o acesso dele?'))return;try{await staffApi('delete',{id});await openWaiters()}catch(e){alert(e.message)}}

document.addEventListener('click',e=>{if(e.target?.id==='send-table-order'){e.preventDefault();sendOrder()}});
setLoginRole('owner');
})();