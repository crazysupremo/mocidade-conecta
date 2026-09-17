// app.js - Mocidade Conecta (frontend)

let me = null;
let socket = null;
let rooms = [];
let currentRoom = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function showCopyToast(text) {
  const toast = document.createElement('div');
  toast.textContent = text;
  toast.style.cssText =
    'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#3a2c2c; color:white; ' +
    'padding:10px 18px; border-radius:999px; font-size:13px; font-weight:600; z-index:200; box-shadow:0 8px 24px rgba(0,0,0,0.25);';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

// ---------- AUTENTICAÇÃO ----------

document.getElementById('tab-login').onclick = () => {
  document.getElementById('tab-login').classList.add('active');
  document.getElementById('tab-register').classList.remove('active');
  document.getElementById('form-login').classList.remove('hidden');
  document.getElementById('form-register').classList.add('hidden');
};
document.getElementById('tab-register').onclick = () => {
  document.getElementById('tab-register').classList.add('active');
  document.getElementById('tab-login').classList.remove('active');
  document.getElementById('form-register').classList.remove('hidden');
  document.getElementById('form-login').classList.add('hidden');
};

async function authRequest(url, body) {
  const errEl = url.includes('register') ? document.getElementById('register-error') : document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Erro ao processar';
      return;
    }
    me = data;
    if (data.requiresEmailVerification) {
      showEmailVerificationScreen();
      return;
    }
    if (data.requiresTermsAcceptance) {
      await showTermsAcceptanceScreen();
      return;
    }
    startApp();
  } catch (err) {
    errEl.textContent = 'Erro de conexão com o servidor';
  }
}

document.getElementById('form-login').onsubmit = (e) => {
  e.preventDefault();
  authRequest('/api/login', {
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
  });
};

document.getElementById('form-register').onsubmit = (e) => {
  e.preventDefault();
  const errEl = document.getElementById('register-error');
  if (!document.getElementById('reg-terms-checkbox').checked) {
    errEl.textContent = 'Você precisa marcar que leu e concorda com os Termos pra continuar.';
    return;
  }
  authRequest('/api/register', {
    nickname: document.getElementById('reg-nickname').value.trim(),
    real_name: document.getElementById('reg-realname').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    password: document.getElementById('reg-password').value,
    birth_date: document.getElementById('reg-birthdate').value,
    terms_accepted: true,
  });
};

document.getElementById('reg-terms-link').onclick = async (e) => {
  e.preventDefault();
  let content = 'Não foi possível carregar os Termos agora.';
  try {
    const res = await fetch('/api/terms/public');
    const data = await res.json();
    content = data.content || content;
  } catch (_) {}
  alert(content);
};

function showEmailVerificationScreen() {
  ['form-login', 'form-register', 'form-terms-accept'].forEach((id) => document.getElementById(id).classList.add('hidden'));
  document.getElementById('email-verify-address').textContent = me.email || 'seu e-mail';
  document.getElementById('email-verify-error').textContent = '';
  document.getElementById('email-verify-code').value = '';
  document.getElementById('form-email-verify').classList.remove('hidden');
}

document.getElementById('form-email-verify').onsubmit = async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('email-verify-error');
  errEl.textContent = '';
  const code = document.getElementById('email-verify-code').value.trim();
  const res = await fetch('/api/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) {
    errEl.textContent = data.error || 'Código incorreto';
    return;
  }
  const meRes = await fetch('/api/me', { credentials: 'include' });
  me = await meRes.json();
  if (!me.terms_accepted) {
    await showTermsAcceptanceScreen();
  } else {
    startApp();
  }
};

document.getElementById('btn-resend-code').onclick = async () => {
  await fetch('/api/resend-verification-code', { method: 'POST', credentials: 'include' });
  showCopyToast('Código reenviado — confira sua caixa de entrada.');
};
document.getElementById('btn-logout-verify').onclick = doLogout;
document.getElementById('btn-logout-terms').onclick = doLogout;

async function showTermsAcceptanceScreen() {
  ['form-login', 'form-register', 'form-email-verify'].forEach((id) => document.getElementById(id).classList.add('hidden'));
  document.getElementById('terms-accept-error').textContent = '';
  document.getElementById('terms-accept-checkbox').checked = false;
  document.getElementById('btn-terms-accept-submit').disabled = true;
  document.getElementById('form-terms-accept').classList.remove('hidden');
  const box = document.getElementById('terms-content-box');
  box.textContent = 'Carregando...';
  try {
    const res = await fetch('/api/terms/public');
    const data = await res.json();
    box.textContent = data.content || 'Não foi possível carregar os Termos agora.';
  } catch (_) {
    box.textContent = 'Não foi possível carregar os Termos agora.';
  }
}
document.getElementById('terms-accept-checkbox').onchange = (e) => {
  document.getElementById('btn-terms-accept-submit').disabled = !e.target.checked;
};
document.getElementById('btn-terms-accept-submit').onclick = async () => {
  const errEl = document.getElementById('terms-accept-error');
  const res = await fetch('/api/terms/accept', { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    errEl.textContent = 'Erro ao registrar aceite — tente de novo.';
    return;
  }
  const meRes = await fetch('/api/me', { credentials: 'include' });
  me = await meRes.json();
  startApp();
};

async function doLogout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  window.location.reload();
}
document.getElementById('btn-logout').onclick = doLogout;

// ---------- BOOT ----------

async function tryResumeSession() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    if (!res.ok) return;
    me = await res.json();
    if (me.email_verified === false) {
      showEmailVerificationScreen();
      return;
    }
    if (me.terms_accepted === false) {
      await showTermsAcceptanceScreen();
      return;
    }
    startApp();
  } catch (_) {}
}
tryResumeSession();

// ---------- APP PRINCIPAL ----------

function connectSocket() {
  socket = io({ withCredentials: true });
  socket.on('chat:message', (msg) => {
    if (currentRoom && msg.room_id === currentRoom.id) renderMessage(msg);
  });
  socket.on('chat:deleted', ({ id, room_id }) => {
    if (currentRoom && room_id === currentRoom.id) {
      const el = document.querySelector(`.message-row[data-id="${id}"]`);
      if (el) el.remove();
    }
  });
  socket.on('chat:blocked', ({ reason }) => {
    alert('⚠️ ' + reason);
  });
}

function startApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('me-nickname').textContent = me.nickname;
  document.getElementById('me-avatar').textContent = me.avatar_emoji || '🙂';
  document.getElementById('btn-leader-panel').classList.toggle('hidden', !me.is_leader && !me.is_admin);
  connectSocket();
  loadRooms();
}

async function loadRooms() {
  const res = await fetch('/api/rooms', { credentials: 'include' });
  rooms = await res.json();
  const listEl = document.getElementById('rooms-list');
  listEl.innerHTML = rooms
    .map(
      (r) => `
    <div class="room-item" data-id="${r.id}">
      <span class="room-item-icon">${escapeHtml(r.icon)}</span>
      <div>
        <div class="room-item-name">${escapeHtml(r.name)}</div>
        <div class="room-item-desc">${escapeHtml(r.description || '')}</div>
      </div>
    </div>
  `
    )
    .join('');
  listEl.querySelectorAll('.room-item').forEach((el) => {
    el.onclick = () => selectRoom(el.dataset.id);
  });
  if (rooms.length > 0 && !currentRoom) selectRoom(rooms[0].id);
}

async function selectRoom(roomId) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return;
  if (currentRoom) socket.emit('room:leave', currentRoom.id);
  currentRoom = room;
  socket.emit('room:join', room.id);
  document.querySelectorAll('.room-item').forEach((el) => el.classList.toggle('active', el.dataset.id === roomId));
  document.getElementById('chat-room-icon').textContent = room.icon;
  document.getElementById('chat-room-name').textContent = room.name;
  document.getElementById('chat-room-desc').textContent = room.description || '';
  closeMobileSidebar();

  const listEl = document.getElementById('messages-list');
  listEl.innerHTML = '<p class="empty-hint">Carregando mensagens...</p>';
  const res = await fetch(`/api/rooms/${room.id}/messages`, { credentials: 'include' });
  const messages = await res.json();
  listEl.innerHTML = '';
  if (messages.length === 0) {
    listEl.innerHTML = '<p class="empty-hint">Nenhuma mensagem ainda — seja o primeiro a puxar assunto! 👋</p>';
  } else {
    messages.forEach((m) => renderMessage(m, true));
  }
  listEl.scrollTop = listEl.scrollHeight;
}

function renderMessage(msg, skipScroll) {
  const listEl = document.getElementById('messages-list');
  const emptyHint = listEl.querySelector('.empty-hint');
  if (emptyHint) emptyHint.remove();
  const isOwn = msg.user_id === me.id;
  const row = document.createElement('div');
  row.className = 'message-row' + (isOwn ? ' own' : '');
  row.dataset.id = msg.id;
  row.innerHTML = `
    <div class="message-avatar">${isOwn ? (me.avatar_emoji || '🙂') : '🙂'}</div>
    <div>
      <div class="message-bubble">
        <div class="message-meta">
          <span class="message-meta-name">${escapeHtml(msg.nickname)}</span>
          <span class="message-meta-time">${new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="message-content">${escapeHtml(msg.content)}</div>
      </div>
      <button type="button" class="message-report-btn">🚩 Denunciar</button>
    </div>
  `;
  row.querySelector('.message-report-btn').onclick = () => openReportModal(msg.id, msg.user_id);
  listEl.appendChild(row);
  if (!skipScroll) listEl.scrollTop = listEl.scrollHeight;
}

document.getElementById('form-send-message').onsubmit = (e) => {
  e.preventDefault();
  if (!currentRoom) return;
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content) return;
  socket.emit('chat:message', { roomId: currentRoom.id, content });
  input.value = '';
};

// ---------- MENU MOBILE (gaveta de salas) ----------
function openMobileSidebar() {
  document.getElementById('rooms-sidebar').classList.add('open');
  document.getElementById('mobile-backdrop').classList.remove('hidden');
}
function closeMobileSidebar() {
  document.getElementById('rooms-sidebar').classList.remove('open');
  document.getElementById('mobile-backdrop').classList.add('hidden');
}
document.getElementById('btn-open-sidebar-mobile').onclick = openMobileSidebar;
document.getElementById('btn-close-sidebar-mobile').onclick = closeMobileSidebar;
document.getElementById('mobile-backdrop').onclick = closeMobileSidebar;

// ---------- DENÚNCIA ----------
let reportTarget = null;
function openReportModal(messageId, reportedUserId) {
  reportTarget = { messageId, reportedUserId };
  document.getElementById('report-reason').value = '';
  document.getElementById('report-error').textContent = '';
  document.getElementById('modal-report').classList.remove('hidden');
}
document.getElementById('btn-cancel-report').onclick = () => document.getElementById('modal-report').classList.add('hidden');
document.getElementById('btn-submit-report').onclick = async () => {
  const reason = document.getElementById('report-reason').value.trim();
  const errEl = document.getElementById('report-error');
  if (reason.length < 3) {
    errEl.textContent = 'Descreva o motivo (pelo menos 3 caracteres).';
    return;
  }
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message_id: reportTarget.messageId, reported_user_id: reportTarget.reportedUserId, reason }),
  });
  if (!res.ok) {
    errEl.textContent = 'Erro ao enviar denúncia.';
    return;
  }
  document.getElementById('modal-report').classList.add('hidden');
  showCopyToast('Denúncia enviada — a liderança vai analisar.');
};

// ---------- PERFIL ----------
document.getElementById('btn-my-profile').onclick = () => {
  document.getElementById('profile-avatar-input').value = me.avatar_emoji || '🙂';
  document.getElementById('profile-bio-input').value = me.bio || '';
  document.getElementById('modal-profile').classList.remove('hidden');
};
document.getElementById('btn-close-profile').onclick = () => document.getElementById('modal-profile').classList.add('hidden');
document.getElementById('btn-save-profile').onclick = async () => {
  const avatar_emoji = document.getElementById('profile-avatar-input').value.trim() || '🙂';
  const bio = document.getElementById('profile-bio-input').value.trim();
  await fetch('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ avatar_emoji, bio }),
  });
  me.avatar_emoji = avatar_emoji;
  me.bio = bio;
  document.getElementById('me-avatar').textContent = avatar_emoji;
  document.getElementById('modal-profile').classList.add('hidden');
  showCopyToast('Perfil atualizado!');
};

// ---------- PAINEL DE LIDERANÇA ----------
document.getElementById('btn-leader-panel').onclick = () => {
  document.getElementById('modal-leader').classList.remove('hidden');
  loadLeaderReports();
};
document.getElementById('btn-close-leader').onclick = () => document.getElementById('modal-leader').classList.add('hidden');

document.querySelectorAll('.leader-tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.leader-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.leader-tab-panel').forEach((p) => p.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById('leader-tab-' + tab.dataset.tab).classList.remove('hidden');
    if (tab.dataset.tab === 'reports') loadLeaderReports();
    if (tab.dataset.tab === 'flagged') loadLeaderFlagged();
    if (tab.dataset.tab === 'members') loadLeaderMembers();
  };
});

async function loadLeaderReports() {
  const listEl = document.getElementById('leader-reports-list');
  listEl.innerHTML = 'Carregando...';
  const res = await fetch('/api/leader/reports', { credentials: 'include' });
  const rows = await res.json();
  listEl.innerHTML = rows.length
    ? rows
        .map(
          (r) => `
      <div class="leader-row">
        <div>
          <strong>${r.status === 'pendente' ? '🟡 Pendente' : '✅ Resolvida'}</strong> — ${escapeHtml(r.reason)}
          <div class="hint">${new Date(r.created_at).toLocaleString('pt-BR')}</div>
        </div>
        ${r.status === 'pendente' ? `<div class="leader-row-actions"><button data-id="${r.id}" class="btn-resolve-report">Marcar como resolvida</button></div>` : ''}
      </div>
    `
        )
        .join('')
    : '<p class="empty-hint">Nenhuma denúncia ainda.</p>';
  listEl.querySelectorAll('.btn-resolve-report').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/leader/reports/${btn.dataset.id}/resolve`, { method: 'POST', credentials: 'include' });
      loadLeaderReports();
    };
  });
}

async function loadLeaderFlagged() {
  const listEl = document.getElementById('leader-flagged-list');
  listEl.innerHTML = 'Carregando...';
  const res = await fetch('/api/leader/flagged-messages', { credentials: 'include' });
  const rows = await res.json();
  listEl.innerHTML = rows.length
    ? rows
        .map(
          (m) => `
      <div class="leader-row">
        <div>
          <strong>${escapeHtml(m.nickname)}</strong>: ${escapeHtml(m.content)}
          <div class="hint">${new Date(m.created_at).toLocaleString('pt-BR')} — categorias: ${escapeHtml((JSON.parse(m.flag_categories || '[]') || []).join(', ') || '—')}</div>
        </div>
      </div>
    `
        )
        .join('')
    : '<p class="empty-hint">Nenhuma mensagem sinalizada.</p>';
}

async function loadLeaderMembers() {
  const listEl = document.getElementById('leader-members-list');
  listEl.innerHTML = 'Carregando...';
  const res = await fetch('/api/leader/users', { credentials: 'include' });
  const rows = await res.json();
  listEl.innerHTML = rows
    .map(
      (u) => `
    <div class="leader-row">
      <div>
        <strong>${escapeHtml(u.nickname)}</strong> ${u.is_admin ? '👑 admin' : u.is_leader ? '🛡️ líder' : ''} ${u.is_banned ? '<span style="color:#c0392b;">(banido)</span>' : ''}
        <div class="hint">${escapeHtml(u.real_name)} · ${escapeHtml(u.email)}</div>
      </div>
      <div class="leader-row-actions">
        ${
          me.is_admin && !u.is_admin
            ? u.is_leader
              ? `<button data-id="${u.id}" class="btn-demote">Remover liderança</button>`
              : `<button data-id="${u.id}" class="btn-promote">Promover a líder</button>`
            : ''
        }
        ${
          u.is_banned
            ? `<button data-id="${u.id}" class="btn-unban">Desbanir</button>`
            : `<button data-id="${u.id}" class="btn-timeout">Timeout 10min</button><button data-id="${u.id}" class="btn-ban danger">Banir</button>`
        }
      </div>
    </div>
  `
    )
    .join('');
  listEl.querySelectorAll('.btn-promote').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/leader/users/${btn.dataset.id}/promote`, { method: 'POST', credentials: 'include' });
      showCopyToast('Promovido a líder.');
      loadLeaderMembers();
    };
  });
  listEl.querySelectorAll('.btn-demote').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Remover a liderança dessa pessoa?')) return;
      await fetch(`/api/leader/users/${btn.dataset.id}/demote`, { method: 'POST', credentials: 'include' });
      showCopyToast('Liderança removida.');
      loadLeaderMembers();
    };
  });
  listEl.querySelectorAll('.btn-ban').forEach((btn) => {
    btn.onclick = async () => {
      const reason = prompt('Motivo do banimento:', '');
      if (reason === null) return;
      await fetch(`/api/leader/users/${btn.dataset.id}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      });
      loadLeaderMembers();
    };
  });
  listEl.querySelectorAll('.btn-unban').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/leader/users/${btn.dataset.id}/unban`, { method: 'POST', credentials: 'include' });
      loadLeaderMembers();
    };
  });
  listEl.querySelectorAll('.btn-timeout').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/leader/users/${btn.dataset.id}/timeout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ minutes: 10 }),
      });
      showCopyToast('Timeout de 10 minutos aplicado.');
    };
  });
}
