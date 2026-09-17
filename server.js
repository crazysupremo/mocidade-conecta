// server.js - Mocidade Conecta
// Espaço seguro e moderado pra jovens de um grupo/igreja se conhecerem por
// apelido — salas de GRUPO (nunca pareamento 1-a-1 com desconhecido
// aleatório), só texto (sem imagem/anexo), com moderação automática via
// BLUEX (mesmo serviço externo que o NEXT GAME usa) + fallback Groq direto,
// e conformidade com o ECA / ECA Digital (idade obrigatória, termo próprio,
// denúncia registrada, contas de menor sinalizadas pra atenção prioritária).

const express = require('express');
const cookieSession = require('cookie-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 200 * 1024 }); // pequeno de propósito — só texto, nunca precisa de payload grande

const PORT = process.env.PORT || 3300;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '80kb' })); // só texto — nunca precisa de corpo grande
app.use(
  cookieSession({
    name: 'mc_session',
    keys: [process.env.SESSION_SECRET || 'troque-essa-chave-em-producao'],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  })
);
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- TERMOS (uso + proteção ECA/ECA Digital, num só documento —
// item pedido: "tem que colocar a idade e tem que colocar o eca digital") ----------
const CURRENT_TERMS_VERSION = '2026-09-v1';
const TERMS_CONTENT = `TERMOS DE USO E PROTEÇÃO DE CRIANÇAS E ADOLESCENTES — MOCIDADE CONECTA
Última atualização: setembro de 2026

Bem-vindo(a) ao Mocidade Conecta — um espaço pra jovens de grupo/igreja se conhecerem por apelido, num ambiente moderado. Ao criar uma conta, você concorda com estes Termos.

1. QUEM PODE USAR
1.1. É proibido usar a plataforma com menos de 13 anos completos.
1.2. Se você tem entre 13 e 17 anos, só pode usar com autorização de um dos pais ou responsável legal, ciente do uso e destes Termos.
1.3. A data de nascimento é obrigatória no cadastro — informar data falsa é, em si, uma violação destes Termos.

2. APELIDO, NÃO ANONIMATO TOTAL
2.1. Seu nome real nunca é mostrado publicamente — só o apelido que você escolhe.
2.2. Seu nome real fica guardado de forma reservada, só pra casos de denúncia grave ou exigência legal — não é "anonimato" no sentido de não ter nenhum rastro.

3. CONTEÚDO PROIBIDO
Você concorda em NÃO publicar, em nenhuma sala:
  a) Conteúdo de exploração ou abuso sexual infantil — proibição absoluta, denunciado às autoridades.
  b) Aliciamento, assédio ou contato de natureza sexual/inadequada com qualquer pessoa, principalmente menores de idade.
  c) Ameaças, discurso de ódio, discriminação, bullying.
  d) Incentivo a automutilação, suicídio ou transtornos alimentares.
  e) Divulgação de dados pessoais de terceiros sem consentimento (doxxing), spam ou links maliciosos.
  f) Combinação de encontros fora da plataforma sem conhecimento de um responsável/líder, quando envolver menor de idade.

4. SOMENTE TEXTO
4.1. A plataforma não permite envio de imagem, foto, vídeo ou arquivo — só mensagens de texto, em todas as salas.

5. MODERAÇÃO
5.1. Toda mensagem passa por moderação automática (BLUEX, com IA) antes ou logo depois de ser publicada.
5.2. Mensagens que violem estes Termos podem ser removidas, e a conta pode receber aviso, silenciamento temporário, banimento, ou ser reportada às autoridades quando a lei exigir.
5.3. Líderes podem investigar denúncias com motivo registrado.
5.4. Qualquer pessoa pode denunciar uma mensagem ou conta pela própria plataforma.

6. SALAS DE GRUPO
6.1. As conversas acontecem em salas de grupo, visíveis a todos os membros da sala — não existe conversa privada 1-a-1 com desconhecido escolhido aleatoriamente.

7. DADOS PESSOAIS (LGPD)
7.1. O nome real e a data de nascimento são coletados só pra fins de segurança/responsabilização, conforme a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018) e o Estatuto Digital da Criança e do Adolescente — ECA Digital (Lei 15.211/2025), que exige verificação de idade e proteção reforçada pra contas de menores.

8. DENÚNCIA
8.1. Situações que caracterizem crime contra criança/adolescente também podem ser denunciadas ao Disque 100 ou à Polícia Federal (Comunica PF), além do canal de denúncia da própria plataforma.

9. LEI APLICÁVEL
9.1. Estes Termos são regidos pelas leis da República Federativa do Brasil.

Ao marcar "Li e aceito", você confirma que leu e concorda com todo o conteúdo acima.`;

// ---------- AUTH ----------

const TERMS_ALLOWLIST = new Set(['/api/me', '/api/logout', '/api/terms/public', '/api/verify-email', '/api/resend-verification-code']);

async function requireAuth(req, res, next) {
  try {
    if (!req.session.userId || !req.session.sessionId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user || user.is_banned) return res.status(403).json({ error: 'Conta banida ou inválida' });
    const sessionRow = await db.get('SELECT * FROM user_sessions WHERE id = ? AND user_id = ?', [req.session.sessionId, user.id]);
    if (!sessionRow || sessionRow.revoked) return res.status(401).json({ error: 'Sessão encerrada — faça login de novo' });
    if (!user.email_verified && !TERMS_ALLOWLIST.has(req.path)) {
      return res.status(403).json({ error: 'Confirme seu e-mail antes de continuar.', requiresEmailVerification: true });
    }
    if (user.terms_version !== CURRENT_TERMS_VERSION && !TERMS_ALLOWLIST.has(req.path)) {
      return res.status(403).json({ error: 'Aceite os Termos antes de continuar.', requiresTermsAcceptance: true });
    }
    db.run("UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ?", [sessionRow.id]).catch(() => {});
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
}

function requireLeader(req, res, next) {
  if (!req.user.is_leader && !req.user.is_admin) return res.status(403).json({ error: 'Só líderes' });
  next();
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createSession(userId, req) {
  const id = uuidv4();
  await db.run('INSERT INTO user_sessions (id, user_id, user_agent) VALUES (?, ?, ?)', [
    id,
    userId,
    (req.headers['user-agent'] || '').slice(0, 200),
  ]);
  return id;
}

// E-mail de verificação — usa Resend se configurado (mesma lógica do NEXT
// GAME); sem RESEND_API_KEY, só loga o código no console (deploy sem e-mail
// configurado ainda consegue testar).
async function sendVerificationEmail(email, code, nickname) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Mocidade Conecta <onboarding@resend.dev>';
  if (!apiKey) {
    console.log(`[E-MAIL SIMULADO] Código de verificação pra ${email} (${nickname}): ${code}`);
    return;
  }
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        from,
        to: email,
        subject: 'Confirme seu e-mail — Mocidade Conecta',
        html: `<p>Oi, ${nickname}!</p><p>Seu código de confirmação é: <strong>${code}</strong></p><p>Vale por 15 minutos.</p>`,
      }),
    });
  } catch (err) {
    console.error('Falha ao enviar e-mail:', err.message);
  }
}

app.post(
  '/api/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { nickname, real_name, email, password, birth_date, terms_accepted } = req.body || {};
    if (terms_accepted !== true) {
      return res.status(400).json({ error: 'Você precisa aceitar os Termos pra criar uma conta.' });
    }
    if (!nickname || typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 24) {
      return res.status(400).json({ error: 'Apelido precisa ter entre 2 e 24 caracteres' });
    }
    if (!real_name || typeof real_name !== 'string' || real_name.trim().length < 3) {
      return res.status(400).json({ error: 'Nome completo é obrigatório (fica reservado, nunca é mostrado publicamente)' });
    }
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Senha precisa ter pelo menos 6 caracteres' });
    }
    // ECA Digital (Lei 15.211/25): data de nascimento é obrigatória.
    if (!birth_date || !/^\d{4}-\d{2}-\d{2}$/.test(birth_date)) {
      return res.status(400).json({ error: 'Data de nascimento é obrigatória' });
    }
    const birthDateObj = new Date(birth_date + 'T00:00:00Z');
    const ageYears = (Date.now() - birthDateObj.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (isNaN(birthDateObj.getTime()) || birthDateObj > new Date() || ageYears > 100) {
      return res.status(400).json({ error: 'Data de nascimento inválida' });
    }
    if (ageYears < 13) {
      return res.status(400).json({ error: 'É preciso ter pelo menos 13 anos pra usar o Mocidade Conecta.' });
    }

    const existingNickname = await db.get('SELECT id FROM users WHERE nickname = ?', [nickname.trim()]);
    if (existingNickname) return res.status(409).json({ error: 'Esse apelido já está em uso' });
    const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail) return res.status(409).json({ error: 'Já existe uma conta com esse e-mail' });

    const countRow = await db.get('SELECT COUNT(*) as c FROM users');
    const isFirstUser = Number(countRow.c) === 0;
    const id = uuidv4();
    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.run(
      `INSERT INTO users (id, nickname, real_name, password_hash, email, birth_date, verification_code, verification_expires, is_admin, is_leader, terms_accepted_at, terms_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      [
        id,
        nickname.trim(),
        real_name.trim().slice(0, 100),
        bcrypt.hashSync(password, 10),
        email,
        birth_date,
        code,
        expires,
        isFirstUser ? 1 : 0,
        isFirstUser ? 1 : 0,
        CURRENT_TERMS_VERSION,
      ]
    );
    sendVerificationEmail(email, code, nickname.trim()).catch(() => {});
    req.session.userId = id;
    req.session.sessionId = await createSession(id, req);
    res.json({ id, nickname: nickname.trim(), email, email_verified: false, requiresEmailVerification: true });
  })
);

app.post(
  '/api/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }
    if (user.is_banned) return res.status(403).json({ error: 'Esta conta foi banida' });
    req.session.userId = user.id;
    req.session.sessionId = await createSession(user.id, req);
    res.json({
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      email_verified: !!user.email_verified,
      requiresEmailVerification: !user.email_verified,
      requiresTermsAcceptance: user.terms_version !== CURRENT_TERMS_VERSION,
    });
  })
);

app.post('/api/logout', (req, res) => {
  if (req.session && req.session.sessionId) {
    db.run('UPDATE user_sessions SET revoked = 1 WHERE id = ?', [req.session.sessionId]).catch(() => {});
  }
  req.session = null;
  res.json({ ok: true });
});

app.post(
  '/api/verify-email',
  authLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    if (req.user.email_verified) return res.json({ ok: true });
    if (!req.user.verification_code || req.user.verification_code !== String(code || '').trim()) {
      return res.status(400).json({ error: 'Código incorreto' });
    }
    if (new Date(req.user.verification_expires) < new Date()) {
      return res.status(400).json({ error: 'Código expirado — peça um novo.' });
    }
    await db.run('UPDATE users SET email_verified = 1, verification_code = NULL WHERE id = ?', [req.user.id]);
    res.json({ ok: true });
  })
);

app.post(
  '/api/resend-verification-code',
  authLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.email_verified) return res.json({ ok: true, already_verified: true });
    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.run('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?', [code, expires, req.user.id]);
    await sendVerificationEmail(req.user.email, code, req.user.nickname);
    res.json({ ok: true });
  })
);

app.get(
  '/api/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      id: req.user.id,
      nickname: req.user.nickname,
      email: req.user.email,
      email_verified: !!req.user.email_verified,
      avatar_emoji: req.user.avatar_emoji,
      bio: req.user.bio,
      is_leader: !!req.user.is_leader,
      is_admin: !!req.user.is_admin,
      terms_accepted: req.user.terms_version === CURRENT_TERMS_VERSION,
    });
  })
);

app.get('/api/terms/public', (req, res) => {
  res.json({ version: CURRENT_TERMS_VERSION, content: TERMS_CONTENT });
});

app.post(
  '/api/terms/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    await db.run("UPDATE users SET terms_accepted_at = datetime('now'), terms_version = ? WHERE id = ?", [
      CURRENT_TERMS_VERSION,
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

app.patch(
  '/api/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { avatar_emoji, bio } = req.body || {};
    const updates = [];
    const values = [];
    if (typeof avatar_emoji === 'string' && avatar_emoji.length <= 8) {
      updates.push('avatar_emoji = ?');
      values.push(avatar_emoji);
    }
    if (typeof bio === 'string') {
      updates.push('bio = ?');
      values.push(bio.slice(0, 200));
    }
    if (updates.length === 0) return res.json({ ok: true });
    values.push(req.user.id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ ok: true });
  })
);

// ---------- SALAS ----------

app.get(
  '/api/rooms',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await db.all('SELECT * FROM rooms ORDER BY position ASC'));
  })
);

app.get(
  '/api/rooms/:id/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      'SELECT id, room_id, user_id, nickname, content, created_at, deleted FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.params.id]
    );
    res.json(rows.reverse());
  })
);

// ---------- MODERAÇÃO (BLUEX externo + fallback Groq direto — mesmo
// esquema do NEXT GAME) ----------

function isBluexConfigured() {
  return !!(process.env.BLUEX_API_URL && process.env.BLUEX_API_KEY);
}

async function bluexRequest(endpointPath, body) {
  const base = process.env.BLUEX_API_URL.replace(/\/+$/, '');
  const res = await fetch(base + endpointPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.BLUEX_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`BLUEX ${endpointPath} respondeu ${res.status}`);
  return res.json();
}

async function callGroqTextModeration(text) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { flagged: false, categories: [] };
  const prompt =
    'Você modera mensagens de texto de um app de bate-papo em grupo pra jovens (a partir de 13 anos) de um ' +
    'grupo/igreja. Analise a mensagem abaixo e responda SOMENTE um JSON válido, sem nenhum texto antes/depois, ' +
    'no formato: {"flagged": true/false, "categories": ["categoria1", ...], "reason": "explicação curta"}. ' +
    'Sinalize (flagged: true) se houver: exploração/abuso sexual infantil, aliciamento, assédio, conteúdo sexual, ' +
    'ameaça/violência, discurso de ódio, incentivo a automutilação/suicídio, drogas ilícitas, doxxing, spam/links ' +
    'maliciosos, ou tentativa de combinar encontro fora da plataforma sem líder/responsável ciente. ' +
    `Mensagem: ${JSON.stringify(text)}`;
  try {
    const textModel = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile';
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: textModel,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!apiRes.ok) return { flagged: false, categories: [] };
    const data = await apiRes.json();
    const raw = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = JSON.parse(raw || '{}');
    return { flagged: !!parsed.flagged, categories: parsed.categories || [], reason: parsed.reason || null };
  } catch (err) {
    console.error('Erro na moderação Groq:', err.message);
    return { flagged: false, categories: [] };
  }
}

async function moderateText(text) {
  if (isBluexConfigured()) {
    try {
      const result = await bluexRequest('/v1/analyze-text', { text });
      return { flagged: !!result.flagged, categories: result.categories || [], reason: result.reason || null };
    } catch (err) {
      console.error('BLUEX indisponível, usando Groq direto:', err.message);
    }
  }
  return callGroqTextModeration(text);
}

// ---------- DENÚNCIAS ----------

app.post(
  '/api/reports',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { message_id, reported_user_id, reason } = req.body || {};
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return res.status(400).json({ error: 'Descreva o motivo da denúncia' });
    }
    await db.run('INSERT INTO reports (id, message_id, reported_user_id, reporter_user_id, reason) VALUES (?, ?, ?, ?, ?)', [
      uuidv4(),
      message_id || null,
      reported_user_id || null,
      req.user.id,
      reason.trim().slice(0, 500),
    ]);
    res.json({ ok: true });
  })
);

// ---------- PAINEL DE LIDERANÇA ----------

app.get(
  '/api/leader/reports',
  requireAuth,
  requireLeader,
  asyncHandler(async (req, res) => {
    res.json(await db.all('SELECT * FROM reports ORDER BY created_at DESC LIMIT 200'));
  })
);

app.post(
  '/api/leader/reports/:id/resolve',
  requireAuth,
  requireLeader,
  asyncHandler(async (req, res) => {
    await db.run("UPDATE reports SET status = 'resolvida' WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  })
);

app.get(
  '/api/leader/flagged-messages',
  requireAuth,
  requireLeader,
  asyncHandler(async (req, res) => {
    res.json(await db.all('SELECT * FROM messages WHERE flagged = 1 ORDER BY created_at DESC LIMIT 200'));
  })
);

app.get(
  '/api/leader/users',
  requireAuth,
  requireLeader,
  asyncHandler(async (req, res) => {
    res.json(
      await db.all(
        'SELECT id, nickname, real_name, email, birth_date, is_leader, is_banned, ban_reason, timeout_until, created_at FROM users ORDER BY created_at DESC'
      )
    );
  })
);

app.post(
  '/api/leader/users/:id/ban',
  requireAuth,
  requireLeader,
  asyncHandler(async (req, res) => {
    const { reason } = req.body || {};
    await db.run('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?', [reason || null, req.params.id]);
    await db.run('INSERT INTO audit_logs (id, actor_id, actor_nickname, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      uuidv4(),
      req.user.id,
      req.user.nickname,
      'ban_user',
      'user',
      req.params.id,
      JSON.stringify({ reason }),
    ]);
    res.json({ ok: true });
  })
);

app.post(
  '/api/leader/users/:id/unban',
  requireAuth,
  requireLeader,
  asyncHandler(async (req, res) => {
    await db.run('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

app.post(
  '/api/leader/users/:id/timeout',
  requireAuth,
  requireLeader,
  asyncHandler(async (req, res) => {
    const { minutes } = req.body || {};
    const mins = Math.max(1, Math.min(1440, Number(minutes) || 10));
    const until = new Date(Date.now() + mins * 60 * 1000).toISOString();
    await db.run('UPDATE users SET timeout_until = ? WHERE id = ?', [until, req.params.id]);
    res.json({ ok: true, until });
  })
);

app.post(
  '/api/leader/users/:id/promote',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Só o administrador pode promover líderes' });
    await db.run('UPDATE users SET is_leader = 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

// ---------- SOCKET.IO ----------

io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.request.headers.cookie || '';
    const match = cookieHeader.match(/mc_session=([^;]+)/);
    if (!match) return next(new Error('sem sessão'));
    // cookie-session guarda o payload assinado — decodifica manualmente
    // (base64 + JSON) já que não passamos pelo middleware do Express aqui.
    const payload = JSON.parse(Buffer.from(decodeURIComponent(match[1]).split('.')[0], 'base64').toString('utf8'));
    const user = await db.get('SELECT * FROM users WHERE id = ?', [payload.userId]);
    if (!user || user.is_banned || !user.email_verified) return next(new Error('não autenticado'));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('sessão inválida'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  socket.join('user:' + user.id);

  socket.on('room:join', async (roomId) => {
    const room = await db.get('SELECT id FROM rooms WHERE id = ?', [roomId]);
    if (!room) return;
    socket.join('room:' + roomId);
  });

  socket.on('room:leave', (roomId) => {
    socket.leave('room:' + roomId);
  });

  socket.on('chat:message', async ({ roomId, content }) => {
    try {
      const fresh = await db.get('SELECT timeout_until, is_banned FROM users WHERE id = ?', [user.id]);
      if (fresh.is_banned) return;
      if (fresh.timeout_until && new Date(fresh.timeout_until) > new Date()) {
        socket.emit('chat:blocked', { reason: 'Você está em timeout e não pode mandar mensagem agora.' });
        return;
      }
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text || text.length > 1000) {
        socket.emit('chat:blocked', { reason: 'Mensagem vazia ou muito longa (máx. 1000 caracteres).' });
        return;
      }
      const room = await db.get('SELECT id FROM rooms WHERE id = ?', [roomId]);
      if (!room) return;

      const id = uuidv4();
      await db.run('INSERT INTO messages (id, room_id, user_id, nickname, content) VALUES (?, ?, ?, ?, ?)', [
        id,
        roomId,
        user.id,
        user.nickname,
        text,
      ]);
      const payload = { id, room_id: roomId, user_id: user.id, nickname: user.nickname, content: text, created_at: new Date().toISOString() };
      io.to('room:' + roomId).emit('chat:message', payload);

      // Moderação roda DEPOIS de já ter mostrado a mensagem (não trava o
      // envio — mesmo motivo do NEXT GAME: esperar a IA responder antes de
      // cada mensagem deixa o chat lento). Se vier sinalizada, apaga
      // retroativamente pra todo mundo que já viu.
      moderateText(text)
        .then(async (result) => {
          if (!result.flagged) return;
          await db.run('UPDATE messages SET flagged = 1, flag_categories = ?, deleted = 1 WHERE id = ?', [
            JSON.stringify(result.categories || []),
            id,
          ]);
          io.to('room:' + roomId).emit('chat:deleted', { id, room_id: roomId });
          console.warn(`[MODERAÇÃO] Mensagem ${id} de ${user.nickname} sinalizada: ${(result.categories || []).join(', ')}`);
        })
        .catch((err) => console.error('Erro na moderação assíncrona:', err.message));
    } catch (err) {
      console.error('Erro no chat:message:', err.message);
    }
  });
});

async function main() {
  await db.initDb();
  httpServer.listen(PORT, () => {
    console.log(`Mocidade Conecta rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Erro ao iniciar o servidor:', err);
  process.exit(1);
});
