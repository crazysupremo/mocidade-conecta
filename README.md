# Mocidade Conecta

Espaço seguro e moderado pra jovens de um grupo/igreja se conhecerem por apelido — salas de **grupo** (nunca conversa 1-a-1 com desconhecido aleatório), **só texto** (sem foto/imagem/vídeo em lugar nenhum), com moderação automática via BLUEX + fallback Groq, e conformidade com o ECA / ECA Digital.

## O que já está pronto

- Cadastro com apelido (público) + nome real (reservado, só pra segurança/responsabilização) + data de nascimento obrigatória (mínimo 13 anos).
- Cadastro entra direto (sem confirmação de e-mail bloqueante — removida a pedido).
- Termo de Uso + Proteção ECA/ECA Digital — checkbox obrigatória no cadastro.
- 4 salas de grupo prontas: Sala Geral, Conhecendo uns aos outros, Pedidos de oração, Avisos.
- Toda mensagem passa por moderação (BLUEX externo se configurado, senão Groq direto) — mensagem sinalizada é apagada retroativamente pra todo mundo.
- Denúncia de mensagem/usuário, disponível em qualquer mensagem.
- Painel de liderança: ver denúncias, ver mensagens sinalizadas, banir/desbanir, aplicar timeout, listar membros.
- Visual próprio (quente, acolhedor — não é o tema escuro "gamer"), já responsivo pra celular (gaveta de salas desliza no mobile).

## O que falta você configurar antes de publicar de verdade

### 1. Banco de dados
Sem configurar nada, o site usa um arquivo local (`local.db`) — funciona, mas se apagar/reiniciar o servidor sem Turso configurado, os dados de teste zeram. Pra produção de verdade, crie um banco no [Turso](https://turso.tech) (gratuito no plano inicial) e defina:
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

### 2. Moderação (BLUEX)
Se você já tem o Protection BLUEX rodando (mesmo serviço que o NEXT GAME usa), só apontar pra ele:
- `BLUEX_API_URL` (ex: `https://protection-bluex.onrender.com`)
- `BLUEX_API_KEY` (gere uma chave nova no painel do Protection BLUEX pra esse app)

Sem isso configurado, a moderação usa o Groq diretamente (ainda funciona, só não tem o painel de denúncias/estatísticas do BLUEX).

### 3. Groq (moderação de texto + fallback)
- `GROQ_API_KEY`

### 5. Segurança da sessão
- `SESSION_SECRET` — qualquer texto longo e aleatório (troque o valor de exemplo que está no código).

### 6. Admin garantido (opcional)
Por padrão, a primeira conta cadastrada já nasce admin/líder. Se você quer GARANTIR que uma conta específica (a sua) seja sempre admin — mesmo que não seja a primeira a se cadastrar, ou mesmo que já tenha se cadastrado antes —, defina:
- `ADMIN_EMAILS` — um ou mais e-mails separados por vírgula (ex: `voce@gmail.com,outroadmin@gmail.com`). No próximo boot do servidor, essas contas (se já existirem) são promovidas automaticamente; contas novas com esse e-mail já nascem admin.

## Rodando localmente

```
npm install
npm start
```

Abre em `http://localhost:3300`. A primeira conta criada já nasce como administrador/líder.

## Publicando (Render, mesmo fluxo do NEXT GAME)

1. Suba esta pasta num repositório do GitHub.
2. No Render, crie um "Web Service" novo apontando pro repositório.
3. Build command: `npm install` — Start command: `npm start`.
4. Configure as variáveis de ambiente da seção acima em Render → Environment.
5. Depois de publicado, crie sua conta (vira admin/líder automaticamente por ser a primeira) e promova outros líderes em `/api/leader/users/:id/promote` (ou peça pra eu montar um botão de "promover a líder" no painel, se quiser).
