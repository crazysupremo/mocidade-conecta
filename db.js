// db.js - banco de dados do Mocidade Conecta (libSQL — funciona local em
// arquivo, ou em produção apontando pro Turso, igual o NEXT GAME já faz).
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

async function run(sql, args = []) {
  return client.execute({ sql, args });
}
async function get(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows[0] || null;
}
async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

async function ensureColumn(table, columnDef) {
  const columnName = columnDef.split(' ')[0];
  const info = await client.execute(`PRAGMA table_info(${table})`);
  const exists = info.rows.some((r) => r.name === columnName);
  if (!exists) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

async function initDb() {
  await client.executeMultiple(`
    -- Apelido é o que aparece pra todo mundo — nome real fica guardado só
    -- pra responsabilização em caso de denúncia grave/acionamento de
    -- autoridade, nunca exibido publicamente (item pedido: "conhecerem
    -- anonimamente" — apelido, não anonimato total sem rastro nenhum, que
    -- seria perigoso demais num espaço com adolescentes).
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL UNIQUE,
      real_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_code TEXT,
      verification_expires TEXT,
      birth_date TEXT NOT NULL,
      avatar_emoji TEXT NOT NULL DEFAULT '🙂',
      bio TEXT,
      is_leader INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      ban_reason TEXT,
      timeout_until TEXT,
      terms_accepted_at TEXT,
      terms_version TEXT,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_agent TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked INTEGER NOT NULL DEFAULT 0
    );

    -- Salas de GRUPO (várias pessoas, sempre visível quem é quem por
    -- apelido) — de propósito NÃO existe pareamento 1-a-1 com desconhecido
    -- aleatório (tipo Omegle), que é um padrão de risco alto demais pra um
    -- espaço com adolescentes, mesmo com moderação automática.
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT NOT NULL DEFAULT '💬',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Só texto — item pedido: "não é possível mandar imagem também". Sem
    -- coluna de anexo nenhuma de propósito, não é só uma trava de UI.
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      content TEXT NOT NULL,
      flagged INTEGER NOT NULL DEFAULT 0,
      flag_categories TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at);

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      reported_user_id TEXT,
      reporter_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_nickname TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Salas padrão — cria só se ainda não existir nenhuma.
  const existingRooms = await get('SELECT COUNT(*) as c FROM rooms');
  if (Number(existingRooms.c) === 0) {
    const defaultRooms = [
      { name: 'Sala Geral', description: 'Bate-papo livre — se apresente e converse à vontade.', icon: '💬', position: 0 },
      { name: 'Conhecendo uns aos outros', description: 'Perguntas pra quebrar o gelo e se conhecer melhor.', icon: '🤝', position: 1 },
      { name: 'Pedidos de oração', description: 'Compartilhe motivos de oração e ore pelos outros.', icon: '🙏', position: 2 },
      { name: 'Avisos', description: 'Avisos e novidades da mocidade — só líderes postam aqui.', icon: '📣', position: 3 },
    ];
    const { v4: uuidv4 } = require('uuid');
    for (const r of defaultRooms) {
      await run('INSERT INTO rooms (id, name, description, icon, position) VALUES (?, ?, ?, ?, ?)', [
        uuidv4(),
        r.name,
        r.description,
        r.icon,
        r.position,
      ]);
    }
  }
}

module.exports = { client, run, get, all, ensureColumn, initDb };
