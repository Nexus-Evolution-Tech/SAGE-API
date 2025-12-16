# SAGE API – Visão Geral para Devs

## Stack
- Node.js + Express (REST)
- MySQL + Knex (query builder) e mysql2 (driver raw)
- Swagger UI (doc em /docs)
- Multer (upload), Joi (validação), JWT (auth), node-cron (jobs), axios (HTTP com retry), winston (log)

## Fluxo de inicialização
- `npm start` → `scripts/start-with-setup.js`
  - Verifica conexão MySQL
  - Cria DB se faltar
  - Executa migrations/seeds (scripts/setup-database.js)
  - Sobe `index.js` (Express) com nodemon em dev
- `src/app.js`
  - carrega middlewares (CORS, compress, JSON, logger de request)
  - registra rotas via `config/loadRoutes.js`
  - expõe `/health` e `/docs`
  - inicia sincronização pendente de catracas (background)

## Banco de dados
- Migrations: `database/sage.sql` (estrutura), `melhorias_sistema.sql` (índices/ajustes), `dados_etec_taboao.sql` (seeds)
- Seed inicial: unidade ETEC com senha bcrypt, cursos/turmas/professores/aulas, catracas demo
- Scripts de setup tratam DELIMITER, criam DB, aplicam seeds e ignoram erros de objetos já existentes (idempotente)

## Logs
- Winston configurado em `src/config/logger.js`
  - níveis info/warn/error/http
  - usado no app, jobs e setup
- Axios com retry em `src/config/axios.js` (padrão: 3 tentativas, timeout 10s, backoff incremental)

## Graceful shutdown
- `index.js` captura SIGINT/SIGTERM
  - fecha servidor HTTP
  - para cron jobs (`src/jobs/scheduledJobs.js`)
  - encerra pool do banco

## Sincronização com catracas (Control iD)
- Serviço: `src/services/controlIdService.js`
- Controller: `src/controllers/peopleController.js`
  - CRUD de pessoas sincroniza com catracas em **background** (não bloqueia a resposta HTTP)
  - Falhas registram `sync_pendente` para retry posterior
- Sync pendente:
  - endpoint `/pessoas/sincronizar` chama `utils/sync_catracas.js`
  - app na inicialização dispara sincronização pendente automaticamente

## Uploads e QR Code
- Upload de foto: multer + `middlewares/uploadFoto.js`, salva em `/uploads/pessoas`, sincroniza imagem na catraca se disponível
- QR Code: `controlIdService.generateQrCode` grava em `Pessoa.qr_code`

## Jobs
- Definidos em `src/jobs/scheduledJobs.js`
- Usam node-cron; iniciados no boot e parados no graceful shutdown

## Middlewares e rotas
- Autenticação: `middlewares/autenticar.js` (JWT)
- Upload de foto: `middlewares/uploadFoto.js`
- Rotas em `src/routes/*` agrupadas por recurso (pessoa, aula, acesso, etc.)

## Comandos úteis
- `npm start` – verifica/cria DB, aplica migrations/seeds e inicia servidor
- `npm run dev` – nodemon sem verificação de setup (usa DB já existente)
- `npm run setup` – roda apenas o setup do banco

## Variáveis de ambiente (principais)
- DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
- PORT, NODE_ENV
- CORS_ORIGINS (lista separada por vírgula)
- CATRACA_RETRY_ATTEMPTS, CATRACA_TIMEOUT_MS (axios retry)

## Resiliência
- Todas as operações persistem primeiro no MySQL (ACID)
- Sincronizações externas são assíncronas + fila `sync_pendente`
- Startup reprocessa pendências automaticamente
- Seeds e migrations são idempotentes
