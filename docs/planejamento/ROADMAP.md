# ROADMAP — SAGE

> Now / Next / Later. Cada fase tem spec própria em `docs/specs/`.
> Regra: só se detalha a spec da fase quando ela entra em **Now** — spec escrita hoje para a Fase 7
> estará errada quando chegar a vez dela.

**Natureza:** refatoração. Stack mantida (Node/Express/MySQL/React). Arquitetura interna muda.

---

## NOW

### 🟣 Fase 8a — Instalador Windows alfa de campo
`spec: specs/F8-instalador-alpha-campo.md`

Antecipada por decisão do produto: o instalador será o veículo para homologar o SAGE na primeira
escola, observar a IDBlock real e distribuir correções. Não substitui o restante da Fase 8.
**Gate:** EXE offline em VM Windows 11 x64; painel servido pela API, API e MySQL como serviços; reboot,
upgrade com rollback e uninstall preservando dados provados.

### ✅ Fase 0 — Consolidação — **CONCLUÍDA (local)** `spec: specs/F0-consolidacao.md`
Branch `integration` nos dois repos. Backend: 4 commits, grafo de módulos carrega, 111 arquivos sem
erro de sintaxe. Frontend: `npm run build` passa.
Achados: o merge limpo escondia referências à coluna errada em 5 arquivos, e `sage.sql` criaria
**duas** colunas. O frontend da ponta **não compilava** (peer dep faltando + ícone Pro do
FontAwesome) — logo a imagem Docker nunca pôde ter sido construída.
Migration `sync_enabled` **verificada em MySQL 9.5 real**: 10/10 asserts, 4 cenários, idempotente.
**Pendente de autorização:** push, purge de histórico, rotação de credenciais, deleção de branches
remotas.

### 🔴 Fase 0b — Instalador (novo) `doc: ACHADOS-INSTALADOR.md`
Descoberto ao verificar a Fase 0 contra MySQL real:
- **A-1** `sage.sql` fixava o nome do banco, ignorando `DB_NAME` → instalação criava **zero tabelas**
  no destino e reportava **exit 0**. ✅ **corrigido e verificado** (27 tabelas, zero erros)
- **A-2** `setup-database.js` termina com exit 0 mesmo com migrations falhando — ⏳ aberto.
  Será corrigido **com teste**, depois da infra da Fase 1
- **A-3** seed de `UnidadeEscolar` sem `UNIQUE` e com hash de senha do `admin` commitado — ⏳ aberto

### 🔄 Fase 1 — Rede de segurança — **EM ANDAMENTO** `spec: specs/F1-rede-de-seguranca.md`
Simulador de catraca Control iD codificando as 9 manhas empíricas + Vitest + Testcontainers + CI +
testes de caracterização.
**Gate:** suite verde reproduzindo cada comportamento do catálogo; CI barrando merge vermelho.
**Depende de B-1** para os testes de domínio (presença/atraso/promoção). A parte de infra e
simulador não depende.

### Fase 2 — Confiabilidade `spec: specs/F2-confiabilidade.md`
Matar falhas silenciosas, jobs catch-up, serviço com auto-restart, backup com restore verificado,
página de status, trava no zerar-logs.
**Gate:** mata o processo no meio da sync → sobe → converge sem perda. PC desligado no dia da
promoção → promove ao ligar.

### Fase 2b — Desempenho e tempo real `spec: specs/F2b-desempenho.md`
Migration `catraca_log_id` UNIQUE, lotes transacionais, fim do N+1, push como padrão de instalação,
isolamento de prioridade, tuning do MySQL.
**Gate:** acesso novo na tela < 1s (push); 48k logs em < 2 min com latência ao vivo degradando < 20%.
Medido no hardware real.

---

## NEXT

### Fase 3 — Identidade e auditoria
`Usuario`, `Papel`, `Permissao`, `LogAuditoria` append-only. Remover senha de admin semeada no
schema. RBAC nas rotas.
**Gate:** professor não deleta pessoa; toda mutação gera registro de auditoria.

### Fase 4 — Tenancy e identidade global
`unidade_id NOT NULL` com FK RESTRICT, uniques compostos, escopo em camada única de repositório,
coluna `uid BINARY(16)` para replicação futura.
**Gate:** teste prova impossibilidade de leitura cruzada entre escolas. Migration testada em cópia
do banco real.

### Fase 5 — Núcleo de sincronização hexagonal
`DeviceGateway` + `capabilities()` por dispositivo, outbox transacional, worker idempotente,
reconciler. Matar a procedure e o EVENT de promoção.
**Gate:** catraca offline → comando na fila → volta → reconcilia sozinho. Resposta perdida não
duplica usuário.

---

## LATER

### Fase 6 — Tempo e calendário escolar
UTC no armazenamento, IANA `America/Sao_Paulo` na borda, entidade calendário (dia letivo, feriado,
recesso, sábado letivo). Resolve a divergência de ENUM `TERÇA`/`TERCA`.
**Gate:** feriado não gera falta; atraso correto na virada de horário.

### Fase 7 — TypeScript e modularização
`allowJs` → migração incremental → `strict`. Módulos físicos em `modules/` com teste de arquitetura
barrando import cruzado.

### Fase 8 — Frota e distribuição
`schema_migrations` versionado, instalador Windows (MySQL 8.4 LTS, `my.ini` por RAM detectada,
regra de firewall sem exclusão automática do Defender), serviço, auto-update com rollback, telemetria, bundle de
diagnóstico. Site com download.
**Gate:** instalação limpa em VM Windows 11 por alguém de fora; update com rollback provado.

### Fase 9 — Segunda escola
Endurecer multi-instalação com o aprendizado da primeira.

### Fase 10 — Camada de nuvem (só se o CPS entrar)
Agregação read-only consumindo o event log. Não altera o funcionamento local.

---

## Lógica da ordem

- **Fase 1 antes de tudo.** Refatorar 22k LOC sem simulador é apostar o projeto. E o catálogo da
  Control iD precisa virar teste antes que alguém "conserte" o `400-que-é-sucesso` achando ser bug.
- **Fase 2/2b antes da refatoração estrutural.** Se confiabilidade é o motivo de o software não ter
  entrado em produção, ela vem antes de arquitetura bonita — e é o que mais rápido vira confiança.
- **Fase 3 antes da 4.** Auditoria precisa existir antes da maior migration da vida do banco.
- **Fase 4 antes da 5.** A chave de tenant atravessa toda tabela que a Fase 5 vai tocar.
- **Fase 8 tarde.** Empacotar arquitetura errada distribui o problema para dentro de escolas onde
  não se alcança a máquina.

## Se o prazo apertar

**Adiáveis:** 6, 7, 9, 10.
**Não adiáveis:** 1, 2, 2b, 5 — sem elas reentrega-se o software que já reprovou no teste de
confiabilidade uma vez.

## Estimativa

50-70 PRs no padrão ≤300 linhas da constituição do projeto. Fases 0-2b concentram ~20.
