/* Delivery LV: atualização remota, preservando dados e assinaturas push. */
(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  let writes = 0;
  // Instalado antes do SDK: não recarregar no meio de uma gravação no servidor.
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    const tracked = url.hostname === 'xzhxqjgekqbyucdgtvra.supabase.co' && !['GET', 'HEAD'].includes(method);
    if (tracked) writes++;
    try { return await nativeFetch(input, init); }
    finally { if (tracked) setTimeout(() => { writes--; }, 1500); }
  };

  let config, pending, checking = false, applying = false, holdCount = 0, nextAttempt = 0;
  let pollTimer, applyTimer, lastCheck = 0;
  const key = suffix => `imperio_updates_${config.app}_${suffix}`;
  const read = name => { try { return JSON.parse(sessionStorage.getItem(name) || 'null'); } catch { return null; } };
  const write = (name, value) => { sessionStorage.setItem(name, JSON.stringify(value)); };
  const build = () => document.querySelector('meta[name="lv-updates-build"]')?.content;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

  function notice(message, blocking = false) {
    let element = document.getElementById('lv-update-notice');
    if (!element) {
      element = document.createElement('div');
      element.id = 'lv-update-notice';
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      element.style.cssText = 'position:fixed;z-index:2147483646;left:12px;right:12px;bottom:12px;max-width:620px;margin:auto;padding:16px 20px;background:#211b16;color:#fff4e8;border:1px solid #e99147;border-radius:12px;font:600 14px/1.5 system-ui;box-shadow:0 8px 35px #0009;pointer-events:none';
      document.body.appendChild(element);
    }
    element.textContent = message;
    let shield = document.getElementById('lv-update-shield');
    if (blocking && !shield) {
      shield = document.createElement('div');
      shield.id = 'lv-update-shield';
      shield.style.cssText = 'position:fixed;inset:0;background:#0005;z-index:2147483645;cursor:wait';
      document.body.appendChild(shield);
    }
    if (!blocking) shield?.remove();
  }

  async function fetchWithTimeout(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await nativeFetch(url, { ...init, cache: 'no-store', signal: controller.signal });
      const text = await response.text();
      if (!response.ok) throw new Error('Não foi possível consultar a atualização.');
      return { response, text };
    } finally { clearTimeout(timer); }
  }

  async function releases() {
    const url = new URL('/rest/v1/lv_app_releases', config.url);
    url.searchParams.set('select', 'app,revision,requested_at');
    const result = await fetchWithTimeout(url.href, { headers: { apikey: config.apiKey } });
    const rows = JSON.parse(result.text);
    if (!Array.isArray(rows)) throw new Error('Resposta de atualização inválida.');
    return rows;
  }

  async function check() {
    if (!config || checking || applying || navigator.onLine === false || document.visibilityState === 'hidden' || Date.now() - lastCheck < 1000) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const rows = await releases();
      config.onStatus?.(rows);
      const current = rows.find(row => row.app === config.app);
      if (!uuid(current?.revision) || current.revision === read(key('applied'))) return;
      if (pending?.revision !== current.revision) {
        pending = { ...current, detected: Date.now() };
        notice('Atualização solicitada. Esta tela será recarregada em alguns segundos.');
      }
      await tryApply();
    } catch (error) {
      config.onError?.(error);
      // A operação da loja continua normalmente; a próxima consulta tenta novamente.
    } finally { checking = false; }
  }

  async function refreshWorker() {
    if (!('serviceWorker' in navigator)) return;
    const expected = new URL('./notification-sw.js', location.href).pathname;
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const worker = registration.active || registration.waiting || registration.installing;
      if (!worker || new URL(worker.scriptURL).pathname !== expected || !location.href.startsWith(registration.scope)) continue;
      await registration.update();
      const next = registration.installing || registration.waiting;
      if (next) {
        next.postMessage({ type: 'LV_ACTIVATE_UPDATE' });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { cleanup(); reject(new Error('A atualização do aplicativo ainda não terminou.')); }, 8000);
          function cleanup() { clearTimeout(timer); next.removeEventListener('statechange', changed); }
          function changed() {
            if (next.state === 'activated') { cleanup(); resolve(); }
            else if (next.state === 'redundant') { cleanup(); reject(new Error('Não foi possível atualizar o aplicativo.')); }
          }
          next.addEventListener('statechange', changed);
          changed();
        });
      }
    }
  }

  async function tryApply() {
    if (!pending || applying || Date.now() < nextAttempt || navigator.onLine === false || document.visibilityState === 'hidden') return;
    if (Date.now() - pending.detected < 5000) return;
    if (writes || holdCount || config.isBusy?.()) {
      notice('Atualização aguardando a operação ou edição em andamento terminar.');
      return;
    }
    const attempt = read(key('attempt'));
    if (attempt?.revision === pending.revision && attempt.count >= 2 && Date.now() - attempt.at < 120000) {
      notice('A nova versão ainda não carregou. Tentaremos novamente em instantes.');
      return;
    }
    applying = true;
    notice('Atualizando o site… aguarde.', true);
    try {
      const target = new URL(location.href);
      target.searchParams.set('lv_update', pending.revision);
      const probe = new URL(target.href);
      probe.searchParams.set('lv_probe', String(Date.now()));
      const fresh = await fetchWithTimeout(probe.href);
      if (!fresh.response.headers.get('content-type')?.includes('text/html')) throw new Error('A nova página ainda não está disponível.');
      const parsed = new DOMParser().parseFromString(fresh.text, 'text/html');
      const expectedBuild = parsed.querySelector('meta[name="lv-updates-build"]')?.content;
      if (!expectedBuild) throw new Error('A nova versão ainda não está publicada.');
      await refreshWorker();
      if ('caches' in window) {
        const prefix = config.app === 'admin' ? 'imperio-panel-' : 'deliverylv-menu-';
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith(prefix)).map(name => caches.delete(name)));
      }
      if (writes || holdCount || config.isBusy?.()) throw new Error('Aguardando a operação em andamento terminar.');
      config.beforeReload?.();
      // Só confirmar a revisão no próximo documento, depois da navegação ter funcionado.
      write(key('attempt'), { revision: pending.revision, expectedBuild, at: Date.now(), count: attempt?.revision === pending.revision && Date.now() - attempt.at < 120000 ? attempt.count + 1 : 1 });
      location.replace(target.href);
    } catch (error) {
      applying = false;
      nextAttempt = Date.now() + 30000;
      notice(`${error.message || 'Não foi possível atualizar agora.'} Tentaremos novamente.`);
    }
  }

  function init(options) {
    if (config) return;
    config = options;
    const attempt = read(key('attempt'));
    if (attempt && new URL(location.href).searchParams.get('lv_update') === attempt.revision && build() === attempt.expectedBuild) {
      try { write(key('applied'), attempt.revision); sessionStorage.removeItem(key('attempt')); } catch { /* sem armazenamento: tentativas permanecem limitadas pela navegação */ }
    }
    pollTimer = setInterval(check, 15000);
    applyTimer = setInterval(tryApply, 1000);
    ['online', 'focus', 'pageshow'].forEach(type => window.addEventListener(type, check));
    document.addEventListener('visibilitychange', check);
    check();
  }

  window.LVUpdates = {
    init, check, releases,
    hold() { holdCount++; let released = false; return () => { if (!released) { holdCount--; released = true; } }; },
    // Snapshot restrito à aba, usado somente na atualização e descartado ao restaurar.
    saveDraft(value) { write(key('draft'), { value, at: Date.now() }); },
    takeDraft() {
      const saved = read(key('draft'));
      try { sessionStorage.removeItem(key('draft')); } catch { /* armazenamento indisponível */ }
      return saved && Date.now() - saved.at < 1800000 ? saved.value : null;
    }
  };
})();
