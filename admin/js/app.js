// Arranque do painel /admin.
//  • Sem backend (SUPABASE_URL / SUPABASE_ANON_KEY em falta no build): ecrã de configuração, sem login.
//  • Com backend: supabase-js (CDN) → palavra-passe → verificação em admin_users → código de 6 dígitos da app de
//    autenticação (TOTP; ativado na 1.ª entrada) → painel. A sessão dura só enquanto o browser estiver aberto e
//    termina após 60 min sem atividade. O Supabase exige o código (aal2) em is_admin(): sem ele nada é alterável.
// Só a anon key é usada no browser. A segurança real está nas regras RLS do Supabase; o painel apenas as reflete.
import { hasBackend, runtime } from '/js/services/runtime.js';
import { escapeHTML } from '/js/lib/html.js';
import {
  MFA_FRIENDLY_NAME, authErrorMessage, dbErrorMessage, formatTotpSecret, isIdleExpired, isPersistentAuthKey, mfaErrorMessage, normalizeTotpCode
} from './logic.js';
import { createApi } from './api.js';
import { mountShell } from './shell.js';
import { NO_TRACK_KEY } from './visitors.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
const root = document.getElementById('app');

const setTitle = title => { document.title = `${title} · Painel Admin · God Seven Line`; };

// ─── Ecrãs fora do painel ────────────────────────────────────────────────────

function screen(inner, { wide = false } = {}) {
  root.innerHTML = `<main class="screen" id="main" tabindex="-1">
    <div class="screen-card${wide ? ' screen-card-wide' : ''}">
      <p class="screen-kicker">PAINEL ADMIN · GOD SEVEN LINE</p>
      ${inner}
    </div>
  </main>`;
  return root.querySelector('.screen-card');
}

function renderSetup() {
  setTitle('Backend não configurado');
  const variables = [
    ['SUPABASE_URL', runtime.supabaseUrl, 'URL do projeto (Project Settings → Data API)'],
    ['SUPABASE_ANON_KEY', runtime.supabaseAnonKey, 'chave pública: publishable (sb_publishable_…) ou anon — também aceite como SUPABASE_PUBLISHABLE_KEY; nunca a secret/service_role']
  ];
  screen(`
    <h1>Backend não configurado</h1>
    <p>O painel de administração precisa de uma base de dados Supabase. Enquanto não estiver ligada, a loja funciona em modo local (catálogo de <code>data/products.json</code>, pedidos enviados só pelo WhatsApp) e não há nada para gerir aqui.</p>
    <h2>O que falta</h2>
    <ol class="setup-list">
      <li>
        <strong>Variáveis de ambiente na Vercel</strong> (Project → Settings → Environment Variables), seguidas de um novo deploy:
        <ul>
          ${variables.map(([name, value, help]) => `<li><code>${name}</code> — ${value
            ? '<span class="chip chip-ok">definida</span>'
            : '<span class="chip chip-danger">em falta</span>'} <span class="muted">${escapeHTML(help)}</span></li>`).join('')}
        </ul>
      </li>
      <li><strong>Base de dados:</strong> executar <code>supabase/schema.sql</code> no SQL Editor do Supabase (tabelas, regras RLS, função <code>create_order</code> e bucket <code>product-images</code>).</li>
      <li><strong>Utilizador administrador:</strong> criar a conta em Authentication → Users e acrescentar o seu <code>user_id</code> à tabela <code>admin_users</code>.</li>
    </ol>
    <p>Passo a passo completo em <code>docs/SETUP.md</code>, no repositório do projeto.</p>
    <p><a href="/">← Voltar à loja</a></p>`, { wide: true });
}

function renderMessage(title, message, { busy = false, actions = [] } = {}) {
  setTitle(title);
  const card = screen(`
    <h1>${escapeHTML(title)}</h1>
    <div class="state${busy ? ' state-loading' : ' state-error'}" role="${busy ? 'status' : 'alert'}">
      ${busy ? '<span class="spinner" aria-hidden="true"></span>' : ''}<p>${escapeHTML(message)}</p>
    </div>
    ${actions.length ? `<div class="form-actions">${actions.map((action, index) => `<button type="button" class="btn${index === 0 ? ' btn-primary' : ''}" data-index="${index}">${escapeHTML(action.label)}</button>`).join('')}</div>` : ''}`);
  card.querySelectorAll('button[data-index]').forEach(button => {
    button.addEventListener('click', () => actions[Number(button.dataset.index)].run(), { once: true });
  });
}

// ─── Arranque com Supabase ───────────────────────────────────────────────────

// Evita pedidos pendurados para sempre (sem rede): 30 s para dados, 2 min para uploads.
function timedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  const ms = url.includes('/storage/v1/') ? 120000 : 30000;
  if (typeof AbortSignal.timeout !== 'function') return fetch(input, init);
  const timeout = AbortSignal.timeout(ms);
  let signal = timeout;
  if (init.signal) signal = typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, timeout]) : init.signal;
  return fetch(input, { ...init, signal });
}

async function start() {
  renderMessage('A carregar o painel', 'A carregar o painel…', { busy: true });
  let createClient;
  try {
    ({ createClient } = await import(SUPABASE_ESM));
  } catch (error) {
    console.error(error);
    renderMessage('Sem ligação', 'Não foi possível carregar a biblioteca do Supabase (cdn.jsdelivr.net). Verifica a ligação à internet e tenta novamente.', {
      actions: [{ label: 'Tentar novamente', run: () => location.reload() }]
    });
    return;
  }

  // A sessão dura só enquanto o browser estiver aberto (sessionStorage): fechar o browser obriga a entrar de novo,
  // com palavra-passe e código. Sessões antigas guardadas em localStorage são apagadas.
  try {
    Object.keys(localStorage).filter(isPersistentAuthKey).forEach(key => localStorage.removeItem(key));
  } catch { /* sem armazenamento */ }
  const supabase = createClient(runtime.supabaseUrl, runtime.supabaseAnonKey, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: timedFetch }
  });
  const api = createApi(supabase);
  let shell = null;
  let verifiedUserId = null;
  let verifying = null;
  let loginNotice = null; // { text, type }
  let stopIdle = null;

  function closeShell() {
    stopIdle?.();
    stopIdle = null;
    shell?.destroy();
    shell = null;
  }

  function renderLogin() {
    closeShell();
    setTitle('Entrar');
    const notice = loginNotice;
    const card = screen(`
      <h1>Entrar</h1>
      <p class="muted">Acesso reservado à equipa God Seven Line.</p>
      <form class="stack" novalidate data-login>
        <div class="field">
          <label for="login-email">Email</label>
          <input id="login-email" name="email" type="email" autocomplete="username" inputmode="email" required aria-describedby="login-error">
        </div>
        <div class="field">
          <label for="login-password">Palavra-passe</label>
          <input id="login-password" name="password" type="password" autocomplete="current-password" required aria-describedby="login-error">
        </div>
        <p class="form-status form-status-error" role="alert" id="login-error">${notice?.type === 'error' ? escapeHTML(notice.text) : ''}</p>
        <p class="form-status" role="status" data-login-status>${notice && notice.type !== 'error' ? escapeHTML(notice.text) : ''}</p>
        <button type="submit" class="btn btn-primary btn-block">Entrar</button>
      </form>
      <p class="screen-foot muted">Depois da palavra-passe é pedido o código de 6 dígitos da app de autenticação.</p>
      <p class="screen-foot"><a href="/">← Voltar à loja</a></p>`);
    const form = card.querySelector('[data-login]');
    const errorEl = card.querySelector('#login-error');
    const statusEl = card.querySelector('[data-login-status]');
    const button = form.querySelector('button[type="submit"]');
    const email = form.elements.email;
    const password = form.elements.password;
    email.focus();

    form.addEventListener('submit', async event => {
      event.preventDefault();
      loginNotice = null;
      errorEl.textContent = '';
      statusEl.textContent = '';
      email.removeAttribute('aria-invalid');
      password.removeAttribute('aria-invalid');
      if (!email.value.trim() || !password.value) {
        errorEl.textContent = 'Indica o email e a palavra-passe.';
        const missing = !email.value.trim() ? email : password;
        missing.setAttribute('aria-invalid', 'true');
        missing.focus();
        return;
      }
      button.disabled = true;
      button.textContent = 'A entrar…';
      const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) {
        button.disabled = false;
        button.textContent = 'Entrar';
        errorEl.textContent = authErrorMessage(error);
        password.value = '';
        password.focus();
        return;
      }
      // Sucesso: o evento SIGNED_IN trata da verificação de permissões e do código.
      password.value = '';
      statusEl.textContent = 'A verificar permissões…';
    });
  }

  // Formulário do código de 6 dígitos (entrada normal e ativação).
  function codeFormHTML(label) {
    return `<form class="stack" novalidate data-mfa>
        <div class="field">
          <label for="mfa-code">${escapeHTML(label)}</label>
          <input id="mfa-code" class="code-input" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
            pattern="[0-9 ]*" maxlength="7" required aria-describedby="mfa-error" spellcheck="false">
        </div>
        <p class="form-status form-status-error" role="alert" id="mfa-error"></p>
        <button type="submit" class="btn btn-primary btn-block">Confirmar</button>
      </form>
      <p class="screen-foot"><button type="button" class="link-button" data-other-account>Entrar com outra conta</button></p>`;
  }

  // onCode(code) devolve a mensagem de erro a mostrar, ou null quando o código foi aceite.
  function bindCodeForm(card, onCode) {
    const form = card.querySelector('[data-mfa]');
    const input = form.elements.code;
    const errorEl = card.querySelector('#mfa-error');
    const button = form.querySelector('button[type="submit"]');
    input.focus();
    card.querySelector('[data-other-account]').addEventListener('click', () => logout({ notice: null }));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      errorEl.textContent = '';
      input.removeAttribute('aria-invalid');
      const code = normalizeTotpCode(input.value);
      if (!code) {
        errorEl.textContent = 'Escreve os 6 algarismos que a app mostra.';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      button.disabled = true;
      button.textContent = 'A confirmar…';
      const message = await onCode(code);
      if (!message) return;
      button.disabled = false;
      button.textContent = 'Confirmar';
      errorEl.textContent = message;
      input.value = '';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    });
  }

  function renderCode(session, factor) {
    closeShell();
    setTitle('Código de verificação');
    const card = screen(`
      <h1>Código de verificação</h1>
      <p class="muted">Abre a app de autenticação no telemóvel (Google Authenticator, Microsoft Authenticator…) e escreve o código de 6 dígitos de “God Seven Line”.</p>
      ${codeFormHTML('Código de 6 dígitos')}`);
    bindCodeForm(card, async code => {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) return mfaErrorMessage(error);
      await openPanel(session);
      return null;
    });
  }

  async function renderEnroll(session) {
    closeShell();
    renderMessage('A preparar', 'A preparar a verificação em dois passos…', { busy: true });
    // Tentativas de ativação que ficaram a meio (fator por verificar) impedem uma nova com o mesmo nome.
    const listed = await supabase.auth.mfa.listFactors();
    for (const factor of listed.data?.all ?? []) {
      if (factor.factor_type === 'totp' && factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id }).catch(() => {});
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: MFA_FRIENDLY_NAME, issuer: MFA_FRIENDLY_NAME });
    if (error) {
      console.error(error);
      renderMessage('Erro', mfaErrorMessage(error), {
        actions: [{ label: 'Tentar novamente', run: () => renderEnroll(session) }, { label: 'Sair', run: () => logout() }]
      });
      return;
    }
    setTitle('Ativar verificação em dois passos');
    const qr = String(data.totp?.qr_code ?? '');
    const card = screen(`
      <h1>Ativar verificação em dois passos</h1>
      <p>Para proteger o painel, a entrada passa a pedir também um código do teu telemóvel. Só é preciso fazer isto uma vez:</p>
      <ol class="setup-list">
        <li>Instala uma app de autenticação: <strong>Google Authenticator</strong> ou <strong>Microsoft Authenticator</strong> (grátis).</li>
        <li>Na app, carrega em <strong>+</strong> → <strong>Ler código QR</strong> e aponta a câmara para este código:
          ${qr.startsWith('data:image/') ? `<img class="mfa-qr" src="${escapeHTML(qr)}" alt="Código QR para adicionar God Seven Line à app de autenticação" width="200" height="200">` : ''}
          <details class="mfa-secret"><summary>Não consegues ler o código QR?</summary>
            <p>Na app escolhe <strong>Introduzir chave</strong> (conta “God Seven Line”, tipo “Baseada no tempo”) e escreve:</p>
            <p><code data-secret>${escapeHTML(formatTotpSecret(data.totp?.secret))}</code></p>
          </details>
        </li>
        <li>Escreve abaixo o código de 6 dígitos que a app mostra para “God Seven Line”.</li>
      </ol>
      ${codeFormHTML('Código de 6 dígitos')}
      <p class="screen-foot muted">Guarda bem o telemóvel: sem ele não consegues entrar. Se o perderes, segue “Perdi o telemóvel” em docs/SETUP.md.</p>`, { wide: true });
    bindCodeForm(card, async code => {
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code });
      if (result.error) return mfaErrorMessage(result.error);
      loginNotice = null;
      await openPanel(session, 'Verificação em dois passos ativada. A partir de agora, cada entrada pede o código da app.');
      return null;
    });
  }

  // 1) a conta está em admin_users?  2) a sessão já tem o código (aal2)?  Senão pede-o (ou ativa-o na 1.ª vez).
  async function verify(session) {
    const userId = session.user.id;
    if (verifying === userId) return;
    verifying = userId;
    closeShell();
    renderMessage('A verificar', 'A verificar permissões…', { busy: true });
    try {
      const admin = await api.isAdmin(userId);
      if (!admin) {
        loginNotice = { type: 'error', text: `Sem permissão de administrador. A conta ${session.user.email ?? ''} não está autorizada a usar este painel.` };
        verifiedUserId = null;
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        renderLogin();
        return;
      }
      const { data: level, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      if (level.currentLevel === 'aal2') {
        await openPanel(session);
        return;
      }
      if (level.nextLevel === 'aal2') {
        const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        const factor = (factors?.totp ?? []).find(item => item.status === 'verified');
        if (factor) {
          renderCode(session, factor);
          return;
        }
      }
      await renderEnroll(session);
    } catch (error) {
      console.error(error);
      renderMessage('Erro', `Não foi possível confirmar as permissões de administrador. ${dbErrorMessage(error)}`, {
        actions: [
          { label: 'Tentar novamente', run: () => { verifying = null; verify(session); } },
          { label: 'Sair', run: () => logout() }
        ]
      });
    } finally {
      verifying = null;
    }
  }

  async function openPanel(session, message = '') {
    verifiedUserId = session.user.id;
    // Quem gere a loja não conta nas estatísticas (pode mudar em Visitantes → Privacidade).
    try { if (localStorage.getItem(NO_TRACK_KEY) === null) localStorage.setItem(NO_TRACK_KEY, '1'); } catch { /* sem armazenamento */ }
    closeShell();
    shell = mountShell(root, {
      api,
      email: session.user.email ?? '',
      supabaseUrl: runtime.supabaseUrl,
      onLogout: () => logout()
    });
    if (message) shell.flash(message, 'success');
    stopIdle = watchIdle(() => logout({ notice: { type: 'info', text: 'A sessão terminou por inatividade (60 minutos). Entra de novo para continuar.' } }));
  }

  async function logout({ notice = { type: 'info', text: 'Sessão terminada.' } } = {}) {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      const message = `Não foi possível terminar a sessão. ${authErrorMessage(error)}`;
      if (shell) shell.flash(message, 'error');
      else renderMessage('Erro', message, { actions: [{ label: 'Tentar novamente', run: () => logout({ notice }) }] });
      return;
    }
    loginNotice = notice;
    verifiedUserId = null;
    renderLogin();
  }

  // Única fonte de verdade da sessão. Não chamar métodos do supabase dentro do callback (recomendação da
  // biblioteca): o trabalho é adiado para a próxima volta do event loop.
  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        if (!session) {
          if (verifiedUserId || !root.querySelector('[data-login]')) {
            verifiedUserId = null;
            renderLogin();
          }
          return;
        }
        if (session.user.id !== verifiedUserId) verify(session);
      }
    }, 0);
  });
}

// Termina a sessão depois de IDLE_LIMIT_MS sem mexer no painel (conta também o tempo com o separador escondido ou o
// computador suspenso). A última atividade fica em sessionStorage para sobreviver a um recarregar da página.
function watchIdle(onExpire) {
  const KEY = 'gsl-admin-last-activity';
  const read = () => { try { return Number(sessionStorage.getItem(KEY)); } catch { return NaN; } };
  const write = value => { try { sessionStorage.setItem(KEY, String(value)); } catch { /* sem armazenamento */ } };
  const previous = read();
  if (previous > 0 && isIdleExpired(previous)) {
    queueMicrotask(onExpire);
    return () => {};
  }
  let last = Date.now();
  let expired = false;
  write(last);
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'];
  const check = () => {
    if (expired || !isIdleExpired(last)) return;
    expired = true;
    stop();
    onExpire();
  };
  const touch = () => {
    if (expired) return;
    const now = Date.now();
    if (isIdleExpired(last, now)) { check(); return; }
    if (now - last > 15000) write(now); // não escrever a cada movimento
    last = now;
  };
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  events.forEach(name => document.addEventListener(name, touch, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(check, 30000);
  function stop() {
    events.forEach(name => document.removeEventListener(name, touch, { capture: true }));
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
  }
  return stop;
}

if (hasBackend) start();
else renderSetup();
