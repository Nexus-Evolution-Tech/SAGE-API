# SAGE — Proposta de Arquitetura (rev. 3)

> Documento de decisão arquitetural. Base: auditoria da branch `primeiro-docker`
> (SAGE-API @ 05/fev/2026, SAGE @ 02/fev/2026), ~22.000 LOC, mais os 5 documentos
> internos em `docs/` e o catálogo de comportamento empírico da Control iD.
>
> **Restrições confirmadas com o cliente (rev. 3):**
> 1. Entrega **on-premise, caixa fechada**. Uma escola hoje; crescimento escola a escola.
> 2. **O sistema tem de funcionar localmente para sempre.** Perda de internet não pode derrubar
>    catraca nem sistema. Nuvem (futuro, via Centro Paula Souza) é camada adicional, nunca requisito.
> 3. **Confiabilidade é O requisito.** A versão anterior não entrou em produção por não ser
>    confiável. A escola não pode ficar sem sistema.
> 4. **Nós mantemos o código.** Equipe pequena, própria.
> 5. Há doc oficial da API Control iD, mas o hardware é **IDBlock antiga** — parte da API
>    funciona, parte não. O código atual acumulou conhecimento empírico que precisa ser preservado.
> 6. **Modo de operação: híbrido** (catraca autônoma + servidor). Escolhido deliberadamente para que
>    o desligamento do PC não pare a catraca; ao voltar, o sistema sincroniza.
> 7. **Velocidade de sincronização é requisito**, não otimização. A sync atual é lenta demais.
>    Já se usa a técnica de trazer os mais recentes primeiro para reduzir o tempo percebido.
> 8. **Hardware real: desktop com HD mecânico e 8 GB de RAM.** Nada pode assumir máquina potente.
>    Sem gargalos, sem desperdício de memória, sem I/O aleatório desnecessário.

---

## 0. Correção da rev. 1

Na rev. 1 recomendei **SaaS central + agente local fino**, e descartei a opção de instância
local completa com replicação para nuvem como "pior dos dois mundos".

**Estava errado, dada a restrição 2.** Num modelo de painel na nuvem, perda de internet derruba
a operação — exatamente o que não pode acontecer. A restrição de disponibilidade local permanente
elimina aquela topologia. A seção §2 abaixo substitui a recomendação anterior.

---

## 1. O que este sistema realmente é

**O SAGE é um sistema distribuído disfarçado de CRUD.** Está organizado como CRUD com telas, mas
a essência do domínio é:

1. **Convergência de estado com dispositivos físicos.** As catracas Control iD são *elas mesmas*
   bancos de dados com estado (usuários, cartões, grupos). O sistema mantém N dispositivos
   convergentes com o banco, sobre LAN não confiável, com dispositivos que ficam offline.
2. **Ingestão de eventos.** Logs de acesso fluem do dispositivo para o sistema; deles derivam
   presença e atraso — regras com semântica temporal e de calendário.
3. **Isolamento de dados entre escolas** (dados pessoais de menores, LGPD).
4. **Relatórios** sobre o acima.

Tudo o que dói, dói por (1), (2) e (3). O CRUD e as telas são commodity.

### 1.1 A percepção que reenquadra "a escola não pode ficar sem sistema"

**A catraca guarda a própria lista de usuários e os próprios logs.** Ela libera acesso sozinha,
sem servidor. Isso significa:

> **Servidor fora do ar ≠ porta fechada.** O controle de acesso físico continua funcionando.

O que quebra quando o servidor cai é: cadastro de novas pessoas, monitoramento ao vivo, relatórios
e — o único risco de perda real — **ingestão dos logs de acesso**.

E aqui está o número que transforma medo difuso em engenharia: a Catraca 02 tinha **48.057 logs
retidos** no equipamento (`docs/ANALISE_SYNC_CONTROL_ID.md`). Esse buffer *é* a garantia de
durabilidade. Enquanto ressincronizarmos antes de o buffer dar a volta, **nenhum acesso é perdido**.

Consequências de projeto:
- O **RPO** (janela aceitável de perda) não é "20 segundos" — é "o tempo até o buffer da catraca
  encher". Precisamos **medir** essa capacidade e a taxa de acessos por dia, e **alertar** quando
  a folga cair abaixo de um limite (ex.: menos de 7 dias de margem).
- O sistema pode ficar horas fora do ar sem perda de dados — desde que ninguém zere os logs do
  equipamento nesse intervalo. Existe uma função `zerarAccessLogsCatraca` no código:
  **ela precisa de trava** que impeça zerar logs não sincronizados.
- Isso rebaixa a prioridade de alta disponibilidade do servidor e **eleva** a de "nunca perder log"
  e "sempre saber o estado real". Prioridade correta = confiabilidade honesta, não uptime heroico.

---

## 2. Decisão nº 1 — Topologia: local-first permanente

**Uma aplicação, um código-fonte, instalada por escola, autossuficiente. Nuvem, quando existir,
é uma camada de agregação que recebe eventos — nunca um requisito de funcionamento.**

```
ESCOLA A                          ESCOLA B                    (FUTURO) NUVEM / CPS
┌──────────────────────┐          ┌──────────────────────┐    ┌─────────────────────┐
│ SAGE (instância)     │          │ SAGE (instância)     │    │ Agregação read-only │
│  ├ banco local       │          │  ├ banco local       │    │  ├ visão consolidada│
│  ├ painel local      │──push──▶ │  ├ painel local      │──▶ │  ├ relatório rede   │
│  └ worker catracas   │ (quando  │  └ worker catracas   │    │  └ gestão de frota  │
└──────┬───────────────┘  houver  └──────────────────────┘    └─────────────────────┘
       │ LAN               internet)
   [catracas]
```

Por que esta e não as alternativas:

- **Atende a restrição 2 por construção.** Internet é irrelevante para a operação. Nada de "modo
  degradado" a manter — o modo normal *é* local.
- **Mesmo código para os dois cenários.** A nuvem não é um segundo sistema; é um consumidor do
  fluxo de eventos que já vamos construir para as catracas (§4). Um único primitivo serve aos dois.
- **Isolamento de dados por construção** — cada escola tem seu banco. Vantagem LGPD real: um
  incidente numa escola não expõe outra.
- **Sem custo de nuvem** e sem você assumir papel de operador de dados de menores até que o CPS
  entre e queira isso contratualmente.

Custo a aceitar, e é o custo central deste modelo: **N escolas = N instalações para atualizar,
monitorar e restaurar.** É por isso que §6 (gestão de frota) deixa de ser luxo e passa a ser
requisito de arquitetura. Sem isso, na quinta escola você perde o controle.

### 2.1 ⚠️ A decisão que precisa ser tomada AGORA, ou fecha a porta para sempre

**Chaves primárias `INT AUTO_INCREMENT` vão colidir quando os dados das escolas se juntarem na nuvem.**

Escola A tem `Pessoa id=42`; Escola B tem `Pessoa id=42`. São pessoas diferentes. No dia da
agregação, ou você faz remapeamento de IDs de todas as escolas (migração de risco altíssimo, com
`Acesso`/`Presenca` apontando para IDs remapeados), ou você não agrega.

#### ⚠️ Reversão da recomendação anterior (decidida pela restrição 8 — hardware)

Eu havia recomendado **UUIDv7 como chave primária**. **Retiro a recomendação.** A restrição de
hardware decide contra:

No InnoDB a PK é o **índice clusterizado**, e **todo índice secundário carrega a PK**. `INT` = 4
bytes; UUID = 16. A tabela `Acesso` tem 3 índices secundários (`melhorias_sistema.sql:29-31`) e vai
para milhões de linhas ao longo dos anos. Cada entrada de índice secundário cresce 12 bytes.

Numa máquina de 8 GB com **HD mecânico** (~100-150 IOPS de I/O aleatório), o buffer pool do MySQL
comporta talvez 1,5-2 GB. Índices maiores = menos páginas em memória = **mais leitura aleatória em
disco mecânico**. É exatamente a máquina onde o inchaço de índice dói mais.

**Recomendação revisada:** manter `INT AUTO_INCREMENT` como PK e adicionar uma coluna
`uid BINARY(16) UNIQUE` (UUIDv7) em cada tabela de negócio, usada **apenas** na replicação futura
para a nuvem. Custo: 16 bytes por linha + um índice único, sem contaminar as chaves estrangeiras
nem os índices de consulta.

Benefício colateral relevante: preserva a aritmética `catracaUserId = OFFSET + pessoa.id`
(§5 #6), que **não funcionaria com UUID** — o que tirou de cima da mesa a migração forçada para
`registration` no mesmo passo, reduzindo bastante o risco da fase de migração.

Esta é a razão pela qual eu havia proposto decidir por prova de conceito: a restrição de hardware
inverteu a resposta.

---

## 3. Decisão nº 2 — Estilo arquitetural

**Monolito modular + Hexagonal (ports & adapters) na fronteira dos dispositivos.**

Não DDD cerimonial. Não microserviços — o time é pequeno (restrição 4), o domínio é coeso, e
transações cruzadas (criar pessoa + enfileirar sync em 3 catracas) são drasticamente mais simples
numa transação de banco. Microserviço aqui é custo sem retorno. Além disso: cada instância roda
num **PC de escola**, não num cluster. Ela precisa ser um processo, leve, que sobe sozinho.

| Módulo | Responsabilidade |
|---|---|
| `identity` | unidade, usuários, papéis, sessões, **auditoria** |
| `people` | pessoas, alunos, funcionários, credenciais físicas (RFID/QR) |
| `academics` | cursos, turmas, matérias, aulas, horários, salas, promoção |
| `access-control` | dispositivos, sincronização, ingestão de logs ← **o coração** |
| `attendance` | presença, atraso, justificativa |
| `reporting` | leitura e agregações (só lê, nunca escreve) |
| `fleet` | telemetria, versão, backup, diagnóstico, replicação p/ nuvem (§6) |

**Regra dura:** módulos se comunicam por interface pública ou evento — nunca `JOIN` direto em
tabela de outro módulo. Com teste de arquitetura que barra import cruzado no CI.

---

## 4. Decisão nº 3 — O coração: reconciliação declarativa

### Como está
Chamada HTTP imperativa à catraca dentro do request, com `sync_pendente` como rede de segurança.
Modo de falha estrutural: **se gravar a pendência falhar, o item se perde para sempre.**

### Como deve ser: desired state + outbox + reconciler

1. O banco guarda o **estado desejado** de cada dispositivo (quem deve ter acesso, com quais credenciais).
2. Toda mutação grava, **na mesma transação**, um registro em `device_command` (outbox).
   O request **nunca** chama a catraca. Responde `202`; o front acompanha por WebSocket (já existe).
3. Um **worker** consome comandos com idempotência, backoff exponencial e dead-letter queue.
4. Um **reconciler** periódico compara *estado desejado × estado real* e emite comandos corretivos.

O reconciler torna o sistema **auto-curável**: não depende de a falha ter sido registrada
corretamente. É estritamente mais robusto que fila de pendências e elimina por construção a classe
de bug mais perigosa da arquitetura atual.

**Bônus de convergência arquitetural:** esse mesmo log de eventos/outbox é o mecanismo de
replicação para a nuvem no futuro (§2). Um primitivo, dois problemas resolvidos.

### Idempotência na ingestão
`Acesso` precisa de `catraca_log_id` + `UNIQUE (dispositivo_id, catraca_log_id)`.

Hoje a dedup é `SELECT`-depois-`INSERT` (`accessService.js:190`) — *check-then-act* com race sob
polling concorrente. E a identidade é `(pessoa, dispositivo, data_hora)`, que **colide se a pessoa
passar duas vezes no mesmo segundo** e é irreconciliável com a fonte da verdade no equipamento.

Mesmo problema em `Presenca` (`presenceService.js:152`): falta `UNIQUE (pessoa_id, data)`.

### O adapter — maior valor estratégico
```
interface DeviceGateway {
  authenticate(device): Session
  upsertUser(user, credentials): void
  removeUser(userId): void
  listUsers(): User[]                    // necessário para o reconciler
  fetchAccessLogs(sinceLogId): AccessLog[]
  capabilities(): { facialModule: boolean, supportsWhereFilter: boolean, ... }
}

class ControlIdIDBlockAdapter implements DeviceGateway { ... }
```

Note `capabilities()`: é onde as diferenças entre IDBlock antiga e nova deixam de ser variável de
ambiente global e passam a ser **propriedade do dispositivo** (§5).

Valor: escola pública compra por **licitação**. É questão de tempo até uma ETEC ter Henry, Topdata
ou Intelbras. Com o adapter, isso é um arquivo novo. Sem ele, é reescrever o sistema.

---

## 5. Catálogo de comportamento real da Control iD (IDBlock antiga)

Este é o **ativo mais valioso do código atual** e o que uma reescrita destruiria. Cada item foi
aprendido em campo e não está (ou não confere com) a documentação oficial. **Cada um deve virar um
teste no simulador (§8) antes de qualquer refatoração.**

| # | Comportamento real | Onde | Como tratar |
|---|---|---|---|
| 1 | **HTTP 400 com corpo de erro vazio significa SUCESSO** em `modify_objects` | `controlId-utils.js:122` | Preservar; virar caso de teste explícito. É o tipo de manha que ninguém redescobre |
| 2 | Catraca antiga **sem módulo facial rejeita `user_images`** | `controlIdService.js:150`, flag `CATRACA_SKIP_USER_IMAGE` | Virar `capabilities().facialModule` **por dispositivo**, não env global — escolas terão modelos mistos |
| 3 | `load_objects` de `access_logs` devolve **todos** os logs (49k), estourando timeout de 10s | `CATRACA_LOAD_LOGS_TIMEOUT=60000` | Manter timeout separado. Ver #4 |
| 4 | **A doc interna e o código se contradizem** sobre filtro na origem: os docs dizem "a API não aceita filtro", mas `deviceService.obterLogsCatraca` já envia `where: { access_logs: { id: { '>': X } } }` | `docs/FLUXO_PAGINACAO_E_SYNC.md` vs. código | **Validar contra o equipamento real e fixar em teste.** Se o filtro funciona, resolve o problema de carga; se é ignorado silenciosamente, precisamos saber |
| 5 | **IDs de log são por dispositivo, não globais.** Um `CATRACA_MIN_LOG_ID` global descartou **48.057 logs → 0 inseridos**, silenciosamente | `docs/ANALISE_SYNC_CONTROL_ID.md` | Já mitigado com `Dispositivo.ultimo_log_id_sincronizado`. **Eliminar `CATRACA_MIN_LOG_ID` de vez** — é uma arma apontada para o pé |
| 6 | `catracaUserId = OFFSET + pessoa.id`. O offset **mudou entre versões** (110000000 na `main`, 111000000 no `.env.example` atual) | `controlIdService.js` | ⚠️ **Risco de migração:** catracas em campo com o offset antigo viram usuários órfãos. Precisa de estratégia de detecção/remapeamento antes de instalar em equipamento já usado |
| 7 | O vínculo correto seria o campo `registration`, não `id` — reconhecido em comentário no código, nunca corrigido | `controlId-utils.js:101` | Avaliar migração para `registration`; elimina a aritmética de offset do #6 |
| 8 | Push (catraca→servidor) exige abrir porta | `docs/MONITOR_CONTROL_ID.md` | ⚠️ **Reavaliado no §8.9** — na topologia local, a porta a abrir é o Firewall do Windows **da própria máquina do SAGE**, que o nosso instalador controla. Push passa de inviável a viável, e é a chave do tempo real |
| 9 | Notificação push traz `device_id` da Control iD, exigindo mapeamento `control_id_device_id` | `migration_control_id_device_id.sql` | Manter; tornar obrigatório com >1 dispositivo |

### 5.1 Dois problemas de confiabilidade no tratamento atual

**🔴 Falha silenciosa.** `obterLogsCatraca` tem `catch { return [] }`
(`deviceService.js`). **Uma falha de rede é indistinguível de "nenhum log novo".** O sistema
reporta sucesso enquanto perde dados. Este padrão, sozinho, explica boa parte da falta de confiança
no software — e é a primeira coisa a corrigir. Regra nova: *toda* falha de dispositivo é registrada,
contabilizada e **visível na tela**.

**🟠 Retry em operação não idempotente.** O interceptor do axios (`config/axios.js`) faz retry em
qualquer erro de rede, para **todos** os requests — incluindo `create_objects` de usuário e cartão.
Se a resposta se perder após o equipamento ter processado, o retry **duplica** o usuário/cartão.
Retry só é seguro depois que as operações forem idempotentes (§4).

---

## 6. Gestão de frota — o requisito que a topologia local cria

Com N instalações em escolas onde você não tem acesso físico, isto **é** arquitetura, não operação:

- **Atualização**: pacote assinado + auto-update com **rollback automático** se o health check
  pós-update falhar. Migrations sempre para frente, idempotentes, testadas em cópia do banco real.
- **Controle de versão de schema** — hoje inexistente: `setup-database.js:343` aplica os
  `migration_*.sql` na ordem alfabética do `readdir`, **sem tabela de controle do que já foi
  aplicado**. Funciona por acidente com um punhado de arquivos e uma instalação. Com 5 escolas em
  versões diferentes, é a receita para bancos divergentes e impossíveis de diagnosticar remotamente.
  Precisa de `schema_migrations` com versão, ordem explícita e registro de aplicação.
- **Telemetria mínima** (quando houver internet): versão, uptime, catracas online/offline, tamanho
  da fila, folga do buffer de logs, último backup bem-sucedido.
- **Backup local automático + restauração testada.** *Backup não verificado não é backup.* O
  restore precisa rodar automaticamente contra a cópia, periodicamente, e falhar ruidosamente.
- **Bundle de diagnóstico**: um clique gera um zip (logs, versões, config sem segredos, estado das
  filas) para a secretária te enviar. Substitui uma hora de telefone.
- **Página de status legível por leigo**: "Catraca 01: offline há 12 min. 43 acessos aguardando
  envio. Último backup: hoje 03:00." — quem opera é secretaria, não TI.

---

## 7. Bloqueadores no modelo de dados

### 7.1 Tenancy inconsistente
`unidade_id` existe em `Pessoa`, `Turma`, `Area`, `Sala`, `UnidadeFoto`, `RecuperacaoSenha`.
**Falta** em `Acesso`, `Presenca`, `Dispositivo`, `Curso`, `Materia`, `Aula`, `HorarioAula`,
`SolicitacaoAcesso`, `sync_pendente`, `Empresa`.

No modelo local (um banco por escola) isso é menos agudo que eu disse na rev. 1 — **mas continua
necessário**, por dois motivos: (a) a agregação na nuvem precisa da chave de tenant; (b) já existe
dano concreto — `Sala` tem `UNIQUE KEY unique_numero (numero)` **global** (`sage.sql:191`), e todo
FK de tenant é `ON DELETE SET NULL`, que **órfã** dados em vez de barrar a operação.

Correção: `unidade_id NOT NULL` com FK `RESTRICT`; uniques de negócio compostos com `unidade_id`;
escopo aplicado numa única camada de repositório, com teste que prova a impossibilidade de leitura
cruzada.

### 7.2 Não existe usuário, logo não existe auditoria
Autenticação é contra `UnidadeEscolar.login/senha`. Um token = escola inteira, poder total.
**"Quem excluiu este aluno?" não tem resposta** — e num sistema público com dados de menores,
precisa ter. O hash bcrypt do `admin` está **commitado em `sage.sql:397`**: toda escola instalada
nasce com a mesma senha de administrador.

Falta: `Usuario`, `Papel`, `Permissao`, `LogAuditoria` append-only (quem, o quê, quando,
antes/depois, IP).

### 7.3 🔴 Bomba-relógio: promoção de alunos com IDs hardcoded
`sage.sql:324-361`, procedure `atualizar_turmas_e_status()`:
```sql
SET a.turma_id = CASE WHEN a.turma_id = 1 THEN 3  WHEN a.turma_id = 2 THEN 4 ...
WHERE ... AND a.turma_id IN (5, 6, 8, 9);   -- → status CANCELADO, visivel = FALSE
```
IDs de turma da ETEC Taboão codificados como **lógica**, dentro do banco. Na segunda escola isso
promove aluno para turma errada e **cancela matrícula de quem não devia**. Silenciosamente, uma vez
por ano — descoberto em fevereiro, quando o aluno não passar na catraca.

Agravantes:
1. **Duas máquinas de promoção coexistem**: a procedure + `CREATE EVENT` anual (`sage.sql:405`),
   **e** o `promocaoAlunosService.js` em Node. O serviço Node é a **boa** implementação (deriva a
   próxima turma por nome/curso, escopa por `unidade_id`). A procedure é a versão antiga e
   perigosa — e `scripts/setup-database.js` executa `sage.sql` inteiro, instalando-a em **toda
   instalação nova**.
2. Critério de elegibilidade é `YEAR(p.updated_at) < YEAR(CURDATE())`: corrigir o telefone de um
   aluno em janeiro o exclui da promoção do ano. `updated_at` não significa "ano da última promoção".
3. O `EVENT` referencia `v_atualizados`, declarado na *procedure*, não no evento. Provavelmente
   falha ao ser criado — o que é a única razão pela qual o dano ainda não ocorreu.

**Ação:** eliminar procedure e EVENT; manter só o serviço Node; mover "ano da última promoção" para
tabela versionada por unidade; cobrir com teste antes de tocar.

---

## 8. Confiabilidade e desempenho — a agenda de engenharia (restrições 3, 7, 8)

A restrição 3 diz que confiabilidade é o requisito. Então ela precisa de agenda própria, com
métrica, não de boa intenção. As restrições 7 e 8 (velocidade de sync, hardware modesto) entram
aqui porque, neste sistema, **lentidão é percebida como falha** — e num HD mecânico as duas coisas
competem pelo mesmo recurso escasso: I/O aleatório.

### 8.1 🔴 O achado que muda tudo: o PC da escola é desligado

`.env.example`, comentário do `PROMOCAO_CRON`:
> *"PC desligado à meia-noite? Use horário em que esteja ligado."*

Isso revela a realidade de operação: **é um PC de escola, que alguém desliga.** Consequências, e
todas são de arquitetura:

- **Todo job agendado precisa ser "catch-up", não "dispara na hora".** O padrão correto é: ao subir
  e periodicamente, perguntar *"o que deveria ter rodado e não rodou?"* e executar. Cron puro
  perde silenciosamente qualquer execução com a máquina desligada. Hoje a promoção anual depende
  de o PC estar ligado às 08:10 de um dia específico — se estiver desligado, **os alunos não são
  promovidos naquele ano**.
- **Desligamento abrupto é o caso normal, não a exceção.** Nada crítico pode viver só em memória —
  o que condena a fila em `globalState` (§9) e reforça o outbox em banco (§4).
- **Serviço Windows com auto-restart e start no boot**, mais health check e watchdog.
- **Integridade do banco após queda de energia** é requisito: MySQL com InnoDB e
  `innodb_flush_log_at_trx_commit=1`. Escola pública raramente tem nobreak — vale recomendar um
  no manual de instalação, porque é a defesa mais barata que existe.

### 8.2 Princípios de confiabilidade a adotar

1. **Nunca falhar em silêncio.** Matar todo `catch { return [] }`. Falha é registrada,
   contabilizada e **exibida**. O sistema deve sempre saber e mostrar seu estado real.
2. **Idempotência em tudo que atravessa a rede** — precondição para retry seguro (§5.1).
3. **Convergência em vez de comando** — o reconciler (§4) conserta qualquer desvio, sem depender
   de a falha ter sido registrada.
4. **Estado durável, nunca só em memória** (§9).
5. **Backup verificado por restauração automática.**
6. **Degradação visível**: a UI diz o que não está funcionando, em português de secretaria.
7. **Trava de segurança em operação destrutiva**: `zerarAccessLogsCatraca` não pode apagar log não
   sincronizado; exclusão em massa exige confirmação e vai para auditoria.

### 8.3 Metas mensuráveis (proposta para discussão)
- **Perda de log de acesso: zero**, com alerta quando a folga do buffer da catraca cair de 7 dias.
- Recuperação de queda do serviço: **< 60s** (auto-restart), sem intervenção humana.
- Convergência após catraca voltar do offline: **< 5 min**, automática.
- Backup diário com **restauração verificada semanalmente**, automática.
- Nenhuma falha silenciosa: toda exceção de dispositivo visível na página de status.
- **Sync percebida: primeiros acessos na tela em < 3s** após o PC ligar (§8.6).
- **Backfill de 48k logs: < 2 min**, sem travar a interface (hoje: minutos, com a UI sofrendo).

---

### 8.4 🔴 Onde está o gargalo da sincronização — diagnóstico

O laço de sync em `accessService.js:162-215` faz, **por log e serialmente**:

```js
for (const log of logs) {                                    // 48.057 iterações
  const [pessoaResult] = await db.query('SELECT * FROM Pessoa WHERE id = ?')      // 1 query
  let [existe] = await db.query('SELECT * FROM Acesso WHERE pessoa_id=? AND ...') // 2ª query
  if (!existe[0]) [existe] = await db.query('SELECT * FROM Acesso WHERE ...')     // 3ª query (fallback de fuso)
  if (!existe) { await db.query('INSERT INTO Acesso ...')                         // 4ª query
                 emitToRoom(...); cacheMutation(...); emitNotification(...) }     // 3 efeitos colaterais
}
```

Custos, na máquina real (HD mecânico, 8 GB):

| Causa | Efeito |
|---|---|
| **2 a 4 queries `await` por log, em série** | 48k logs → **~100.000 a 190.000 round trips sequenciais** ao MySQL. A 0,5 ms cada, já são 50-95 s só de ida e volta — sem contar disco frio |
| **Cada `INSERT` é sua própria transação implícita** | Com durabilidade ligada (`innodb_flush_log_at_trx_commit=1`), **1 fsync por linha**. Um HD 7200 rpm faz ~100-200 fsync/s → **4 a 8 minutos apenas em fsync** para 48k linhas. **Este é o custo dominante** |
| **`SELECT *`** em `Pessoa` e `Acesso` | Trafega e desserializa colunas que ninguém usa, incluindo caminhos de foto |
| **3 efeitos colaterais por linha inserida** (WebSocket, invalidação de cache, notificação) | Num backfill de 48k, inunda o front e joga fora o cache continuamente. 14 chamadas desse tipo no arquivo |
| **Dupla checagem de duplicata por fuso** | O fallback "tenta UTC, depois Date" dobra as queries no caminho comum. É dívida da inconsistência de fuso (§6) pagando juros a cada log |
| **Se o filtro `where` da catraca não for honrado** (§5 #4) | Baixa-se 48k logs **a cada 20 segundos**. Não verificado — e é a diferença entre carga trivial e carga absurda |

Ponto importante: **não é falta de índice.** Os índices existem
(`melhorias_sistema.sql:29-31`, incluindo `idx_acesso_pessoa_data`) e o `setup-database.js` os
aplica. O problema é o **número de idas ao disco**, não o custo de cada uma.

### 8.5 A correção — e ela é a mesma da correção de correção

O `catraca_log_id` + `UNIQUE (dispositivo_id, catraca_log_id)` que propus no §4 **por correção**
elimina o gargalo **por construção**. Não são duas obras, é uma:

| Antes | Depois |
|---|---|
| `SELECT` de duplicata por log (1-2 queries) | **Nenhuma.** `INSERT ... ON DUPLICATE KEY UPDATE` deixa o banco decidir |
| `SELECT * FROM Pessoa` por log | **1 query por lote**: `SELECT id FROM Pessoa WHERE id IN (...)` → `Set` em memória |
| 1 `INSERT` + 1 fsync por log | **Lotes de ~500 numa transação explícita**: 48k linhas → **~96 fsyncs** em vez de 48.057 |
| 3 efeitos colaterais por linha | **1 evento agregado por lote** ("237 acessos novos"), com WebSocket só para o lote de primeiro plano |
| Dupla checagem de fuso | Some junto com a correção de fuso (§6) |

Ordem de grandeza esperada: de **~150.000 round trips e 48.000 fsyncs** para **~100 transações em
lote e 1 consulta de pessoas**. É a diferença entre minutos e segundos, e a maior parte vem só de
agrupar as transações.

### 8.6 Sync em dois níveis — formalizando a técnica que vocês já usam

A intuição de "trazer os mais recentes primeiro" está correta e deve virar arquitetura explícita,
com **duas trilhas de prioridade diferente**:

**Nível 1 — Primeiro plano (percepção do usuário), meta < 3s**
- Buscar **só os N logs mais recentes** (ex.: 200), usando `limit` + `order` desc — parâmetros que
  `obterLogsCatraca` **já aceita** e hoje não são usados no caminho de sync.
- Inserir em um único lote, emitir um evento WebSocket, pintar a tela.
- É o que a secretária vê ao ligar o computador. Precisa ser rápido e sempre acontecer primeiro.

**Nível 2 — Segundo plano (completude), deliberadamente lento**
- Preencher o histórico para trás em lotes, guiado por `ultimo_log_id_sincronizado`.
- **Throttle obrigatório, e não é detalhe:** num único HD mecânico, o backfill em velocidade máxima
  faz a UI (que lê do mesmo disco) engasgar. O backfill deve ter pausa entre lotes e **cair para
  marcha lenta enquanto houver usuário ativo na interface**, acelerando quando a máquina está ociosa.
- Progresso visível ("histórico: 31.200 de 48.057"), para que lentidão pareça trabalho, não travamento.

Isso preserva a percepção de rapidez sem sacrificar completude, e respeita o disco.

### 8.7 Orçamento de recursos na máquina real

O PC não roda só o SAGE: roda Windows, MySQL, Node **e o Chrome com o painel aberto** — que sozinho
come 1-2 GB. Orçamento proposto para 8 GB:

| Item | Alocação | Observação |
|---|---|---|
| `innodb_buffer_pool_size` | **1,5-2 GB** | O padrão do MySQL é **128 MB** — quase certamente é o que está rodando hoje, e num HD isso significa ler disco constantemente. Talvez o ajuste mais barato de todo o projeto |
| `innodb_flush_log_at_trx_commit` | **1** (durável) | Mantém durabilidade contra queda de energia; o custo é neutralizado pelos lotes do §8.5, não por relaxar a garantia |
| Heap do Node | **cap explícito** (`--max-old-space-size≈512`) | Impede o processo crescer até engasgar a máquina. Falhar rápido e reiniciar > degradar tudo |
| Logs da catraca em memória | paginar via `limit`/`offset` | 48k logs em JSON são dezenas de MB no pico (resposta + `JSON.parse`). Tolerável hoje, **não** se crescer para centenas de milhares |
| Redis | **não instalar** | Confirmado pela restrição 8: mais um processo e mais memória, para um ganho que o LRU local já dá |
| Antivírus | **excluir o diretório de dados do MySQL** | Item de manual de instalação. AV varrendo arquivos de banco em HD é uma das piores perdas de desempenho em Windows, e é gratuito de resolver |

### 8.8 🔴 "Monitorar com delay é pior que não monitorar" — o orçamento de latência

Requisito do cliente, textual: *"não adianta prometer monitoramento com dados entrando devagar.
Monitorar com delay é pior que não monitorar."* Isso é um requisito de **latência**, e latência se
projeta com orçamento, não com otimização difusa.

**Descoberta ao montar o orçamento: são dois problemas diferentes, com correções diferentes.**
Eu vinha tratando como um só.

#### Orçamento de latência de um acesso novo (evento único)

| Etapa | Com polling de 20s | Com push |
|---|---|---|
| Evento na catraca → servidor perceber | **10s em média, 20s no pior caso** | ~0,1s |
| Servidor processa e grava 1 linha (1 fsync) | ~0,01s | ~0,01s |
| WebSocket → tela renderizar | ~0,05s | ~0,05s |
| **Total** | **~10-20s** | **< 1s** |

O que isso mostra: **o intervalo de polling domina a latência por um fator de ~100x.** Otimizar
banco, índices e lotes **não melhora em nada** o tempo de aparecer *um* acesso na tela. Estava
otimizando o termo errado do orçamento.

Portanto, separando de vez:

| Problema | Causa dominante | Correção |
|---|---|---|
| **A — "monitoramento tem delay"** | Intervalo de polling (20s) | **Push** + polling curto e leve como rede de segurança (§8.8.1) |
| **B — "sync em massa é lenta e travando"** | N+1 e fsync por linha (§8.4) | Lotes + isolamento de prioridade (§8.8.2) |

São independentes. Resolver B não resolve A. É provável que a insatisfação com o monitoramento
venha inteiramente de A.

#### 8.8.1 Reavaliação: push é viável, e é a resposta para o tempo real

Na rev. 2 eu classifiquei o push como impraticável, porque "escola pública não abre porta". **Isso
estava errado para esta topologia**, e a razão é específica:

No modelo local (§2), a catraca e o servidor SAGE estão **na mesma LAN**. A porta que precisa ser
liberada é a do **Firewall do Windows da própria máquina onde o SAGE roda** — máquina que o
**nosso instalador** controla. Não depende da DTI, do Centro Paula Souza nem do roteador da escola.

> O instalador cria a regra de entrada do Windows Firewall para a porta do SAGE, restrita à
> sub-rede local. Push deixa de ser configuração manual de técnico e passa a ser padrão da instalação.

Isto reposiciona o desenho de monitoramento:

- **Push é o caminho primário** (latência < 1s, orientado a evento — a definição de tempo real).
- **Polling continua**, mas com dois papéis novos: (a) rede de segurança para push perdido —
  push sem confirmação **não é entrega garantida**; (b) fonte de completude e de reconciliação.
- Com push ativo, o polling pode ser **leve e mais frequente** (ex.: 50 logs mais recentes a cada
  5s) em vez de pesado e lento. Ele para de ser o mecanismo de latência e passa a ser o de garantia.

Segurança do push já está parcialmente pronta no código (`monitorCallbackAuth.js`, token,
whitelist de IP, janela anti-replay) — precisa ser **exigida**, não opcional, e a regra de firewall
deve ser restrita aos IPs das catracas.

Ressalva honesta: falta confirmar no equipamento real que a IDBlock antiga suporta o `set_configuration`
do Monitor de forma confiável. É item de verificação junto com §5 #4.

#### 8.8.2 Isolamento estrito de prioridade: o recente nunca espera pelo histórico

O requisito é explícito: sincronizar muitos dados pode levar segundos a mais — **mas não pode
travar os dados recentes**. Num único HD e um único MySQL, prioridade não é de graça: as duas
trilhas disputam o mesmo disco e o mesmo pool de conexões. Precisa de mecanismo, não de intenção.

1. **Reserva de conexões.** Hoje `connectionLimit` é global (10). Um backfill em andamento pode
   ocupar o pool e **fazer o caminho ao vivo esperar**. Correção: pool separado (ou cota) com
   conexões reservadas para o caminho ao vivo; o backfill fica limitado a **1 conexão**.
2. **Backfill cooperativo e interrompível.** Lotes pequenos (~200 linhas) e, **entre lotes**,
   verificação: "há trabalho ao vivo pendente? → cede a vez". Nunca uma transação longa segurando
   fila de fsync enquanto um acesso novo espera.
3. **Ordem sempre do mais recente para o mais antigo** — já é o comportamento atual
   (`accessService.js:151`) e está correto. Formalizar como invariante testada, não como detalhe.
4. **Caminho ao vivo nunca reconsulta a lista inteira.** Insere o evento e emite por WebSocket. O
   front aplica o evento na lista que já tem. Hoje há risco de o front refazer `GET /acessos`
   (com `COUNT(*)`, §8.8) a cada evento — o que torna o monitoramento mais lento quanto mais
   acessos acontecem, exatamente ao contrário do desejado.
5. **Poluição do buffer pool é o custo escondido no HD.** O backfill lê e escreve páginas que
   expulsam da memória justamente as que a UI e o caminho ao vivo usam. Efeito: durante o backfill,
   *tudo* fica lento mesmo sem contenção de lock. Mitigação: lotes pequenos, throttle (§8.6) e
   buffer pool dimensionado (§8.7).
6. **Detalhe de I/O que importa em disco mecânico:** o `INSERT` no índice clusterizado é
   **append sequencial** (PK auto-increment) — barato no HD. Mas **cada um dos 3 índices
   secundários de `Acesso` sofre escrita aleatória** por linha inserida. São eles, não o INSERT em
   si, o custo real de I/O do backfill. Vale (a) reavaliar se os 3 são todos necessários na tabela
   quente, e (b) para backfill grande, considerar carga com índice desabilitado e reconstrução ao
   final — medindo antes, porque reconstruir índice de tabela grande também custa.

#### 8.8.3 Metas de latência propostas

| Métrica | Meta |
|---|---|
| Acesso novo aparecer na tela (push) | **< 1s** |
| Idem, degradado para polling (push indisponível) | **< 5s** |
| Primeiros acessos na tela após ligar o PC | **< 3s** |
| Backfill de 48k logs | **< 2 min**, com o caminho ao vivo **sempre < 1s durante o backfill** |
| Impacto do backfill na latência ao vivo | **< 20%** de degradação — é esta a métrica que prova o §8.8.2 |

A última linha é a que realmente traduz o requisito. As outras são consequência.

### 8.9 Instalação do MySQL — vantagem de o instalador ser nosso

Como o `.exe` instala o banco, a configuração deixa de ser sorte e passa a ser decisão:

- **MySQL 8.4 LTS**, não a "mais recente". Para um sistema que roda por anos numa máquina que
  ninguém administra, LTS (suporte estendido, sem mudanças de comportamento a cada minor) vale mais
  que novidade. Atualizar MySQL remotamente em 20 escolas é exatamente o que não se quer fazer.
- **`my.ini` gerado pelo instalador em função da RAM detectada**, não copiado fixo: buffer pool
  (§8.7), `innodb_redo_log_capacity` maior (ajuda muito em carga em lote no HD),
  `innodb_io_capacity` **baixo** — o padrão pressupõe disco melhor que 7200 rpm, e valor alto faz
  flush agressivo que castiga o HD.
- **Regra de firewall** criada pelo instalador, restrita à sub-rede local (§8.8.1).
- ⚠️ **Windows Defender ≠ Firewall do Windows.** São coisas distintas: o Firewall filtra rede; o
  Defender faz varredura de arquivos em tempo real e vem **ligado por padrão no Windows 11**. Ele
  varrendo o diretório de dados do MySQL num HD mecânico é uma perda de desempenho real. O
  instalador deve adicionar a exclusão do diretório de dados (e conferir se há AV corporativo da
  rede da escola, que também vem ligado sem aviso).

### 8.10 Crescimento da tabela `Acesso` ao longo dos anos

Com ~1.000 pessoas × 2 passagens × ~200 dias letivos ≈ **400 mil linhas/ano**. Em 10 anos, milhões
de linhas num HD mecânico — e a restrição 1 diz que este sistema roda por anos.

Precisa de política desde já, não depois:
- **Índice de relatório por faixa de data** (`data_hora`), além dos existentes por pessoa/dispositivo.
- **Particionamento por ano** ou **arquivamento** de anos anteriores para tabela histórica, mantendo
  a tabela quente pequena o suficiente para caber no buffer pool.
- **Retenção definida** — que é também requisito de LGPD (dado pessoal de menor não se guarda para
  sempre "porque dá"). Precisa de decisão de negócio sobre o prazo.
- `SELECT COUNT(*)` sem filtro é usado na paginação (`accessController.js:94`,
  `genericControllerFactory.js:49`). Em tabela de milhões de linhas no InnoDB isso é varredura de
  índice **a cada troca de página**. Trocar por contagem aproximada, contador materializado, ou
  paginação por cursor (`WHERE id < ?`), que é mais rápida *e* estável sob inserção concorrente.

---

## 9. Estado em memória bloqueia durabilidade

`src/state/globalState.js` (330 LOC) mantém em memória de processo: `syncInProgress`, `syncQueue`,
`deviceStatus`, `catracaSessions`, `connectedUsers`, `stats`.

Combinado com §8.1 (a máquina é desligada), **a fila de sincronização é perdida a cada
desligamento** — e no modelo atual não há reconciler para reconstruí-la. Correção: fila e estado
de sync no banco (o outbox do §4 já resolve); sessões de catraca podem seguir em memória (são
descartáveis por natureza); `stats` derivado por consulta.

---

## 10. Stack — o que muda e o que fica

**Sou contra reescrever a stack.** 22k LOC funcionais e integração Control iD amadurecida em campo:
reescrita destrói o ativo do §5. Mudanças cirúrgicas:

| Camada | Decisão | Motivo |
|---|---|---|
| Linguagem | **TypeScript**, incremental (`allowJs`) | Restrição 4 (vocês mantêm) + 10 anos de vida. O bug `resultado[0].total` era erro de tipo |
| HTTP | **Express fica** | Trocar não paga o risco |
| Banco | **MySQL fica**, com tuning explícito | On-prem permanente (§2); durabilidade (§8.1) + buffer pool dimensionado (§8.7) |
| PK | **`INT` + coluna `uid` global** | §2.1 — revertido de UUIDv7 pela restrição de hardware |
| Front | **CRA → Vite** | CRA deprecado e sem manutenção. React e TanStack Query ficam. Bundle menor também ajuda a máquina modesta |
| Cache | Redis **fora** | Hoje há `redis` **e** `ioredis` instaladas. Com 8 GB e HD, é processo e memória a mais por ganho que o LRU local já dá |
| Testes | **Vitest + Testcontainers + Playwright** | Banco real nos testes de integração |
| **Simulador de catraca** | **construir primeiro** | Abaixo |

### 10.1 O investimento de maior retorno do projeto inteiro
Um **simulador de catraca Control iD IDBlock** — servidor HTTP fake que responde `login.fcgi`,
`load_objects`, `create_objects`, `modify_objects`, `destroy_objects`, emite logs de acesso, e
**reproduz cada manha do §5** (o 400-que-é-sucesso, ausência de módulo facial, devolver 49k logs,
IDs de log por dispositivo), com modos de falha injetáveis: offline, timeout, sessão expirada,
resposta parcial, resposta perdida após processar (para provar idempotência).

Sem ele, nenhuma refatoração do `access-control` é segura e o conhecimento do §5 permanece
folclore. Com ele, você testa em segundos o que hoje exige estar fisicamente na escola.
**É o primeiro item de código a escrever.**

---

## 11. Roadmap

| Fase | Entrega | Gate de saída |
|---|---|---|
| **0** | Consolidar branches; matar as 15 branches; purge de histórico (dados pessoais); remover arquivos de lixo | Uma branch que sobe e roda, sem feature perdida |
| **1** | **Simulador de catraca** codificando o §5 + Vitest + Testcontainers + CI + testes de caracterização | Suite verde reproduzindo cada manha do §5 |
| **2** | **Confiabilidade (§8.1-8.3)**: matar falhas silenciosas, jobs catch-up, serviço com auto-restart, backup com restore verificado, página de status, trava no zerar-logs | Teste: mata o processo no meio da sync → sobe → converge sem perda. Simula PC desligado no dia da promoção → promove ao ligar |
| **2b** | **Desempenho da sync (§8.4-8.8)**: migration `catraca_log_id` UNIQUE, lotes transacionais, fim do N+1, eventos agregados, sync em dois níveis com throttle, tuning do MySQL, cap de heap | 48k logs em **< 2 min** com a UI responsiva; primeiros acessos na tela em **< 3s**. Medido na máquina real, não na sua |
| **3** | `identity`: Usuario, Papel, Permissao, LogAuditoria. Remover senha semeada | Professor não deleta pessoa; toda mutação auditada |
| **4** | **Tenancy** (`unidade_id NOT NULL`, uniques compostos, escopo em camada única) + coluna `uid` global (§2.1) | Migration testada em cópia do banco real; teste prova isolamento |
| **5** | `access-control` hexagonal: `DeviceGateway` + `capabilities()`, outbox, worker, reconciler, `catraca_log_id` UNIQUE, retry só idempotente. **Matar procedure + EVENT** | Catraca offline → comando na fila → volta → reconcilia. Resposta perdida não duplica usuário. Resync não duplica acesso |
| **6** | Tempo em UTC + **calendário escolar** (dias letivos, feriados, recesso) | Feriado não gera falta; atraso correto na virada de horário |
| **7** | TypeScript incremental + modularização física em `modules/` | `tsc --strict` limpo; teste de arquitetura barra import cruzado |
| **8** | `fleet` (§6) + instalador Windows + auto-update com rollback + site de download | Instalação limpa em VM Windows 11; update com rollback provado |
| **9** | *Quando a 2ª escola entrar:* endurecer multi-instalação com base no aprendizado da 1ª | Duas escolas em produção |
| **10** | *Quando o CPS entrar:* camada de agregação em nuvem consumindo o event log | Visão consolidada, sem tocar o funcionamento local |

**Lógica da ordem** (importa mais que a lista):

- **Fase 1 primeiro, sem exceção.** Refatorar 22k LOC sem simulador é apostar o projeto. E o §5
  precisa virar teste antes que alguém "limpe" o 400-que-é-sucesso achando que é bug.
- **Fase 2 subiu para o segundo lugar** (na rev. 1 estava difusa). Se confiabilidade é o motivo de
  o software não ter entrado em produção, ela vem antes de qualquer refatoração estrutural. É
  também a fase que mais rápido converte em confiança do cliente.
- **Fase 4 (PK+tenancy) antes da 5** porque a chave atravessa toda tabela que a 5 vai tocar.
  E `identity` (3) antes da 4 porque você quer auditoria funcionando antes da maior migration
  da vida do banco.
- **Fase 8 depois** porque empacotar arquitetura errada distribui o problema para dentro de
  escolas onde você não alcança a máquina.

---

## 12. Onde isto pode dar errado

- **Meus números de desempenho (§8.4-8.5) são estimativas, não medições.** Derivei fsync/s de um HD
  7200 rpm típico e latência de query de valores usuais — mas eu **não medi na máquina da escola**.
  A ordem de grandeza do diagnóstico é sólida (o N+1 e o fsync por linha são fato no código), porém
  a Fase 2b tem de começar por **medir com um profiler no hardware real**, não por aplicar minhas
  suposições. Se o gargalo dominante for outro (rede da catraca, antivírus, CPU), o plano muda.
- **Lotes grandes têm efeito colateral em confiabilidade.** Agrupar 500 inserts numa transação
  significa que uma queda no meio descarta o lote inteiro. Como a catraca retém os logs, isso é
  recuperável por resync — mas o tamanho do lote é um **trade-off explícito** entre velocidade e
  retrabalho, e precisa ser ajustável, não constante mágica.
- **O throttle do backfill (§8.6) é fácil de errar.** Muito agressivo e a UI engasga; muito
  conservador e o histórico nunca completa. Não tem resposta correta no papel — precisa de medição
  e de um botão de "sincronizar agora com prioridade máxima" para quando alguém precisar do
  histórico completo na hora.
- **A Fase 4 (tenancy) segue sendo a mais perigosa do plano**, ainda que menos que na rev. 2.
  Tornar `unidade_id NOT NULL` em ~10 tabelas exige backfill, e os registros já órfãos por
  `ON DELETE SET NULL` **não têm como ser atribuídos automaticamente** a uma escola. Com uma escola
  é trivial; com dados sujos, é trabalho manual.
- **O item #6 do §5 pode já ter causado dano em campo.** Se alguma catraca foi sincronizada com
  offset 110000000 e depois com 111000000, existem usuários órfãos no equipamento hoje. Preciso
  inspecionar uma catraca real para saber. Se houver, a limpeza é manual.
- **Testes de caracterização (Fase 1) congelam bugs junto com o comportamento correto.** Se o
  cálculo de atraso está errado hoje, meu teste o consagra. Mitigação obrigatória: revisar as
  regras de presença/atraso/promoção **com você** antes de escrever os testes. O código me diz o
  que faz, não o que deveria fazer.
- **O simulador é derivado do código atual + doc oficial.** Onde os dois divergem (§5 #4, o filtro
  `where`), só o equipamento real decide. Preciso de uma janela de acesso a uma catraca, ou de
  logs de uma sessão real, para fechar esse buraco. **Até lá, o item #4 fica marcado como
  não verificado, não como resolvido.**
- **A topologia local só funciona se a gestão de frota (§6) for construída de verdade.** Se a Fase
  8 for cortada por prazo, o modelo do §2 vira uma armadilha: na quinta escola, atualizar todas
  manualmente inviabiliza o negócio. **Se a Fase 8 cair, a recomendação de topologia precisa ser
  reconsiderada** — este é o acoplamento mais importante do plano.
- **Estimativa: 50-70 PRs** no padrão ≤300 linhas da constituição do projeto. Se o prazo aperta:
  Fases 6, 7 e 9-10 são adiáveis. **Fases 1, 2 e 5 não são** — sem elas você reentrega o mesmo
  software que já não passou no teste de confiabilidade uma vez.
- **Zero testes hoje, e a Fase 1 não produz feature visível.** É a fase mais difícil de justificar
  para um cliente esperando entrega, e a que mais determina o resultado. Vale combinar isso
  explicitamente com o cliente, em vez de absorver a pressão no meio do caminho.
- **O que deliberadamente NÃO considerei:** app mobile, biometria facial, reconhecimento de placa,
  BI executivo, catraca de outro fabricante *implementada* (só deixei a porta aberta), e
  **integração com o sistema acadêmico do CPS (NSA/SIGA)**. Este último é o mais relevante: se
  entrar no acordo, ele redefine quem é a fonte da verdade sobre alunos e turmas — e metade deste
  documento muda, inclusive §2.1 e a Fase 4.

---

## 13. Perguntas abertas

1. **A regra correta de promoção de turma e de cálculo de atraso/presença** — preciso disso antes
   de escrever os testes que vão congelar o comportamento. É a dependência mais urgente.
2. **Acesso a uma catraca IDBlock real** (ou logs de sessão completa): fecha o §5 #4 e #6.
3. **PK: UUIDv7 ou `INT` + coluna `uid`?** Proposta: decidir por prova de conceito na Fase 1.
4. **Prazo com o cliente atual**, para saber se e onde cortar escopo.
5. **Quantas catracas por escola, e qual o volume de acessos/dia?** Define a folga real do buffer
   (§1.1), a meta de RPO e o crescimento da tabela `Acesso` (§8.8).
6. **Existe nobreak nas escolas?** Muda o quanto investir em recuperação de corrupção de banco.
7. **Qual o `innodb_buffer_pool_size` atual na máquina da escola?** Se estiver no padrão de 128 MB,
   é possível que uma parte grande da lentidão seja resolvida em uma linha de config — vale medir
   antes de refatorar. Peça também: modelo do HD, versão do MySQL e se há antivírus varrendo o
   diretório de dados.
8. **Qual o tempo de sync considerado aceitável?** "Rápido" precisa virar número para a Fase 2b ter
   critério de saída. Minha proposta é < 3s para os recentes e < 2 min para 48k de histórico — mas
   quem define é você e a escola.
9. **Por quanto tempo os dados de acesso devem ser guardados?** (retenção, §8.8) — decisão de
   negócio e de LGPD, e define particionamento/arquivamento.
