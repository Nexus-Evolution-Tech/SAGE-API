# Simulador de catraca Control iD IDBlock

Servidor HTTP em processo que imita uma **IDBlock antiga** (sem módulo facial, firmware velho) —
o equipamento que está instalado no cliente.

**Este simulador é deliberadamente estranho.** Ele reproduz bugs e comportamentos ilógicos do
equipamento real. Se algo aqui parecer errado, provavelmente *é* errado — e é errado **de propósito**,
porque o equipamento é assim. Antes de "consertar" qualquer coisa, leia a seção do quirk
correspondente e rode `npx vitest run`: o teste que quebrar te diz o que você acabou de apagar.

O valor deste diretório não é o código: é transformar conhecimento empírico ("a catraca faz uma
coisa esquisita quando…") em conhecimento **verificável**.

---

## Uso

```js
const { createCatracaSimulator } = require('./test/fakes/controlid');

const sim = await createCatracaSimulator({
  seed: 42,                       // dataset determinístico
  sessaoTtlMs: 60 * 60 * 1000,    // tempo de vida da sessão do login.fcgi
  deviceId: 1,                    // device_id informado no push do Monitor
  quirks: { honorsWhereFilter: false, moduloFacial: false }
});

sim.url            // '127.0.0.1:54321' — mesmo formato que deviceService.linkCatraca produz
sim.dispositivo    // objeto no formato da tabela Dispositivo, pronto para o deviceService
sim.store          // acesso direto ao estado em memória (asserções de efeito)
sim.requisicoes    // histórico de requisições recebidas (inclusive as cujo resposta foi perdida)

sim.seedAccessLogs(48057, { idInicial: 6169 });   // Q3 + Q5
sim.seedUsuarios([1, 2, 3], [110000000, 111000000]); // Q6 (usuários órfãos)
sim.setQuirk('honorsWhereFilter', true);
sim.setFailureMode('offline', { vezes: 1 });
await sim.emitirEventoPush({ id: 1, time: 1700000000, user_id: 111000001, portal_id: 1, card_value: '12345678' });
await sim.stop();
```

### Endpoints implementados

| Endpoint | Comportamento |
|---|---|
| `POST /login.fcgi` | `{ session }`. Expira por tempo (`sessaoTtlMs`) |
| `POST /session_is_valid.fcgi` | `{ session_is_valid: true }` |
| `POST /load_objects.fcgi?session=` | `users`, `cards`, `user_groups`, `groups`, `user_images`, `access_logs`. Suporta `where`, `limit`, `offset`, `order`, `columns` |
| `POST /create_objects.fcgi?session=` | `users`, `cards`, `user_groups`, `user_images` |
| `POST /modify_objects.fcgi?session=` | Altera — **ver Q1** |
| `POST /destroy_objects.fcgi?session=` | Remove. `users` derruba `cards`/`user_groups`/`user_images` em cascata |
| `POST /set_configuration.fcgi?session=` | Guarda `{ monitor: {...} }` (push) |
| `POST /user_set_image_list.fcgi?session=` | Envio de foto — **ver Q2** |
| `POST /user_destroy_image.fcgi?session=` | Remove foto |
| — | `sim.emitirEventoPush()` faz o POST do Monitor para o callback configurado |

`where` é aceito nos dois formatos que a produção envia (`deviceService.zerarAccessLogsCatraca`):
objeto (`{ access_logs: { id: { '>=': 0 } } }`) e array de condições (firmware antigo).
Operadores suportados: `>`, `>=`, `<`, `<=`, `=`, `!=`, `eq`, `like`, `regex`.

---

## Os quirks

### Q1 — `modify_objects` responde HTTP 400 com corpo vazio **quando deu certo**

- **Flag:** `quirks.modifyRetorna400NoSucesso` (padrão `true`)
- **Onde a produção trata:** `src/utils/controlId-utils.js:125` —
  `if (status === 400 && !apiError?.error) { sucesso }`
- **Comportamento:** modify que altera ≥ 1 registro → `HTTP 400` com `Content-Length: 0`.
  Modify que não casa com nada (erro de verdade) → `HTTP 400` com `{ error: {...} }`.
  A **única** diferença entre sucesso e falha é a presença da chave `error` no corpo.
- **Se fosse "corrigido"** (simulador passando a responder 200): o teste
  *"QUEBRARIA se o simulador passasse a responder 200"* falha. E, pior, alguém olharia o
  `if (status === 400 …)` da produção, concluiria que é código morto/defensivo, apagaria — e toda
  edição de pessoa passaria a ser reportada como falha em produção.
- **Modo de comparação:** `modifyRetorna400NoSucesso: false` responde `200 { changes: n }`. Serve
  para documentar o contraste, **não** representa o equipamento instalado.

### Q2 — catraca sem módulo facial **rejeita** `user_images`

- **Flag:** `quirks.moduloFacial` (padrão `false` = catraca antiga, que é o parque instalado)
- **Onde a produção trata:** `src/services/controlIdService.js:167` — o envio de foto só acontece
  se `CATRACA_SKIP_USER_IMAGE` não for `true`/`1`; e `controlId-utils.criarImagemUser` engole
  qualquer erro em `try/catch` vazio.
- **Comportamento:** `user_set_image_list.fcgi` e `create_objects` de `user_images` respondem
  `400 { error }`. Com `moduloFacial: true`, aceitam.
- **Se fosse "corrigido"** (aceitar foto sempre): a env `CATRACA_SKIP_USER_IMAGE` pareceria
  inútil e o `catch` vazio de `criarImagemUser` pareceria descuido. Ambos existem porque o
  equipamento recusa foto — e a recusa **não pode** derrubar a edição de pessoa.

### Q3 — `access_logs` devolve **todos** os logs, e devagar

- **Flags:** `quirks.ignoraLimitEmAccessLogs` (padrão `false`),
  `quirks.latenciaAccessLogsMs` (padrão `0`)
- **Onde a produção trata:** `deviceService.obterLogsCatraca` usa
  `CATRACA_LOAD_LOGS_TIMEOUT=60000` (só para este endpoint);
  `accessService.sincronizarAcessos` tem a proteção `maxProcessarMonitor`, que corta a lista em
  memória "se a API da catraca ignorar limit e devolver 49k".
- **Comportamento:** com `ignoraLimitEmAccessLogs: true`, `limit`/`offset` são descartados e a
  resposta traz o dataset inteiro (48.057 logs). A latência é aplicada **só** em `access_logs`.
- **Se fosse "corrigido"** (sempre respeitar `limit`): o timeout de 60s e a proteção
  `maxProcessarMonitor` pareceriam paranoia, e o modo monitor voltaria a travar processando 48k
  registros a cada 20 segundos.

### Q4 — o filtro `where { access_logs: { id: { '>': X } } }` pode ser **ignorado em silêncio**

- **Flag:** `quirks.honorsWhereFilter` — **os dois modos são obrigatórios**
- **Onde a produção depende:** `deviceService.obterLogsCatraca` monta
  `body.where = { access_logs: { id: { '>': lastLogId } } }` a partir de
  `dispositivo.ultimo_log_id_sincronizado`, assumindo que o filtro funciona.
- **Por que dois modos:** **não sabemos** qual é o comportamento real do firmware antigo. O código
  assume que o `where` é honrado; `docs/ANALISE_SYNC_CONTROL_ID.md` registra que "chamamos
  `load_objects` **sem** filtro na API; a catraca envia **todos** os logs". Código e doc divergem, e
  só o equipamento real decide (pendência **B-2** da spec da Fase 1). Até lá, Q4 está
  **não verificado**, não resolvido: todo código de sync precisa funcionar nos dois modos.
  - `honorsWhereFilter: true` → filtra de verdade.
  - `honorsWhereFilter: false` → descarta o `where`, sem erro e sem aviso, e devolve tudo.
- **Se um dos modos fosse removido:** perde-se justamente a incerteza que o simulador existe para
  representar. Otimização baseada em `lastLogId` que só passa no modo (a) é otimização que pode
  não existir no campo.

### Q5 — ids de `access_logs` são **por dispositivo**

- **Presets:** `PRESETS_FAIXA.instanciaA` (`idInicial: 6169`, 48.057 logs) e
  `PRESETS_FAIXA.instanciaB` (`idInicial: 1`, 5 logs) — os números da Catraca 02 e da Catraca 01
  em `docs/ANALISE_SYNC_CONTROL_ID.md`.
- **Onde a produção trata (mal):** `accessService.sincronizarAcessos` lê um
  `CATRACA_MIN_LOG_ID` **global** e descarta `log.id <= MIN_ID`.
- **O bug reproduzido:** com `CATRACA_MIN_LOG_ID=73975` em produção, a Catraca 02 (ids de 6169 a
  ~54k) teve **48.057 logs lidos e 0 inseridos**. O teste
  *"reproduz o bug documentado: CATRACA_MIN_LOG_ID=73975 global descarta TODOS os 48.057 logs"*
  trava esse fato.
- **Nota de fidelidade:** o documento original registra 48.057 logs *e* faixa `[6169, 53148]`, o que
  é aritmeticamente incompatível (a faixa cabe ~46.980 ids). O gerador prioriza a **quantidade**
  (48.057) e o **id inicial** (6169), com gaps ocasionais, terminando em ~54.2k. A conclusão que
  importa — maior id **abaixo** de 73975 — é preservada.
- **Se fosse "corrigido"** (faixa global compartilhada entre instâncias): a explicação do incidente
  desapareceria e um `MIN_ID` global voltaria a parecer aceitável.

### Q6 — `user_id` na catraca = `OFFSET + pessoa.id`, com **dois** offsets na base real

- **Flag:** `quirks.userIdOffset` (padrão `111000000`); `sim.seedUsuarios(pessoaIds, [offsets])`
- **Onde a produção trata:** `controlIdService.js:11` usa default **110000000**;
  `accessService.js:8` usa default **111000000**. O `.env.example` documenta 111000000. Ou seja: o
  mesmo `pessoa.id` pode ter sido gravado na catraca com **dois** user_id diferentes ao longo do
  tempo, e quem lê procura só um deles.
- **Comportamento:** `seedUsuarios([1,2,3], [110000000, 111000000])` cria 6 usuários. Quem calcula
  `111000000 + pessoa.id` nunca encontra os 3 do offset antigo: são **órfãos** na catraca.
- **Detalhe cruel:** `accessService.userIdCatracaParaPessoaId` só subtrai o offset se
  `user_id >= OFFSET`; abaixo disso pega os **7 últimos dígitos**. `110000001` → `0000001` → pessoa
  1 "por acidente". Funciona por coincidência de formato, não por design.
- **Se fosse "corrigido"** (normalizar tudo para um offset): a detecção de órfãos ficaria sem
  cenário de teste, e a divergência 110000000/111000000 continuaria viva no código de produção sem
  nada apontando para ela.

### Q7 — vínculo por `registration` além de `id`

- **Flag:** `quirks.aceitaVinculoPorRegistration` (padrão `true`)
- **Onde a produção trata:** `controlId-utils.js:101-109` — `editarUsuario` filtra por `id`, com um
  comentário dizendo que `registration` "na verdade é o ideal de se trabalhar para relacionar com o
  banco do sistema". E `criarUsuario` envia `registration: ''` com o comentário
  "NÃO PODE SER NULL JAMAIS".
- **Comportamento:** `where: { users: { registration: '1' } }` funciona em load/modify/destroy. Com
  `aceitaVinculoPorRegistration: false`, o firmware recusa o filtro (`400`) e só `id` funciona.
- **Por que os dois modos:** o vínculo por `registration` é a **migração futura** cogitada no
  código. O modo `false` existe para medir o risco: se o firmware instalado não indexar
  `registration`, a migração é inviável sem troca de equipamento.
- **Regra que não pode ser esquecida:** `registration: null` faz o equipamento recusar a criação do
  usuário — o simulador responde `400` nesse caso, honrando o comentário em caixa alta do código.

---

## Modos de falha injetáveis

`sim.setFailureMode(modo, opcoes)` — `opcoes.vezes` limita a quantas requisições a falha se aplica
(padrão: até ser desligada com `setFailureMode(null)`).

| Modo | O que faz | Para que serve |
|---|---|---|
| `offline` | derruba o socket sem responder | cliente vê erro de rede, sem `response` |
| `timeout` | nunca responde | valida o timeout do **cliente** (`CATRACA_LOAD_LOGS_TIMEOUT`) |
| `sessaoExpirada` | expira as sessões na N-ésima operação autenticada (`opcoes.aposOperacoes`) | sequência multi-passo (criar user → cartão → grupo) morre no meio e deixa **estado parcial** |
| `respostaParcial` | declara o `Content-Length` cheio e envia metade do JSON, cortando a conexão | resposta ilegível: nem JSON válido, nem status aproveitável |
| `perdeRespostaAposProcessar` | **processa** a requisição e derruba a conexão sem responder | **o modo que prova idempotência**: o efeito aconteceu, o cliente acha que falhou |
| `lentidao` | atrasa `opcoes.ms` e responde normalmente | fronteira de timeout, sem erro |
| `perdeEventoPush` | `emitirEventoPush` não envia nada (guarda em `sim.eventosPushPerdidos`) | prova que o push **sozinho** não é confiável: sem polling, o acesso é perdido para sempre |

O `perdeRespostaAposProcessar` é o mais importante: os testes mostram que uma retentativa ingênua de
`create_objects` de usuário falha com "já existe" (o equipamento não tem upsert), enquanto
`destroy_objects` é naturalmente idempotente (`changes: 0` na segunda vez). Qualquer camada de
sincronização precisa tratar esses dois casos de forma diferente.

---

## Dataset determinístico

`sim.seedAccessLogs(quantidade, { idInicial, seed, userIdOffset, pessoaIds, offsetsExtras })` gera
os logs com um PRNG `mulberry32` (`prng.js`). Mesma seed → **exatamente** os mesmos registros, sem
fixture em disco. 48.057 logs são gerados em memória em poucas centenas de milissegundos.

Campos de cada log (o que o código de produção lê):
`{ id, time, user_id, portal_id, card_value, event, device_id }` — `time` em **segundos Unix UTC**,
`card_value` com 8 dígitos (interpretado como QRCODE por `mapearMetodo`) ou 9 dígitos (RFID),
`portal_id` 1 (entrada) ou 2 (saída), e ~1% dos logs com `user_id: 0` (acesso não identificado).

**Nenhum dado pessoal real.** Nomes são sempre `Pessoa Teste N`. Este projeto lida com dados de
menores de idade; fixture com nome real é vazamento, não conveniência.

---

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `index.js` | `createCatracaSimulator`, servidor HTTP, quirks e modos de falha |
| `store.js` | estado em memória + `where`/`limit`/`offset`/`order` no formato Control iD |
| `geradorLogs.js` | gerador determinístico de `access_logs` e `PRESETS_FAIXA` |
| `prng.js` | PRNG determinístico (mulberry32) |

Testes: `test/simulador-controlid.test.js` (o simulador em si),
`test/quirks-controlid.test.js` (Q1–Q7), `test/modos-de-falha-controlid.test.js`.
