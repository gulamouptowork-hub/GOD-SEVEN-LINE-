// Arranque do painel /admin.
//  • Sem backend (SUPABASE_URL / SUPABASE_ANON_KEY em falta no build): ecrã de configuração, sem login.
//  • Com backend: supabase-js (CDN) → sessão → verificação em admin_users → painel.
// Só a anon key é usada no browser. A segurança real está nas regras RLS do Supabase; o painel apenas as reflete.
import { hasBackend, runtime } from '/js/services/runtime.js';
import { escapeHTML } from '/js/lib/html.js';
import { authErrorMessage, dbErrorMessage } from './logic.js';
import { createApi } from './api.js';
import { mountShell } from './shell.js';

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
    ['SUPABASE_URL', runtime.supabaseUrl, 'URL do projeto (Project Settings → API)'],
    ['SUPABASE_ANON_KEY', runtime.supabaseAnonKey, 'chave anon / public — nunca a service_role']
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

  const supabase = createClient(runtime.supabaseUrl, runtime.supabaseAnonKey, { global: { fetch: timedFetch } });
  const api = createApi(supabase);
  let shell = null;
  let verifiedUserId = null;
  let verifying = null;
  let loginNotice = null; // { text, type }

  function closeShell() {
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
      // Sucesso: o evento SIGNED_IN trata da verificação de permissões.
      password.value = '';
      statusEl.textContent = 'A verificar permissões…';
    });
  }

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
      verifiedUserId = userId;
      shell = mountShell(root, {
        api,
        email: session.user.email ?? '',
        supabaseUrl: runtime.supabaseUrl,
        onLogout: logout
      });
    } catch (error) {
      console.error(error);
      renderMessage('Erro', `Não foi possível confirmar as permissões de administrador. ${dbErrorMessage(error)}`, {
        actions: [
          { label: 'Tentar novamente', run: () => { verifying = null; verify(session); } },
          { label: 'Sair', run: logout }
        ]
      });
    } finally {
      verifying = null;
    }
  }

  async function logout() {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      const message = `Não foi possível terminar a sessão. ${authErrorMessage(error)}`;
      if (shell) shell.flash(message, 'error');
      else renderMessage('Erro', message, { actions: [{ label: 'Tentar novamente', run: logout }] });
      return;
    }
    loginNotice = { type: 'info', text: 'Sessão terminada.' };
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

if (hasBackend) start();
else renderSetup();
