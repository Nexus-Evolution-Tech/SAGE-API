# AGENTS.md — Regras para agentes de código no SAGE

> Este arquivo é lido por Claude Code, Codex e qualquer outro agente que trabalhe neste
> repositório. **Leia por inteiro antes da primeira alteração.**
>
> `CLAUDE.md` aponta para cá. Existe um só conjunto de regras.

---

## 0. Coordenação entre máquinas — leia antes de qualquer outra coisa

O trabalho acontece em **duas máquinas que não enxergam o disco uma da outra**:

| Quem | Onde | Faz |
|---|---|---|
| **Arquiteto** (Claude) | macOS | Plano, spec, ADR, revisão de PR |
| **Implementador** (Codex) | Windows, `C:\SAGE-WS` | Código, teste, PR |

**O GitHub é o único canal entre as duas. Não existe outro.** Se você mudou algo e não
empurrou, para a outra máquina aquilo **não existe**.

### As quatro regras

1. **Antes de começar qualquer pacote, atualize o plano:**
   ```
   git -C C:\SAGE-WS\SAGE-arquitetura pull
   ```
   O plano muda — recebeu enxerto de uma segunda auditoria e um ADR novo depois que a
   implementação já tinha começado. Trabalhar sobre versão velha é retrabalho garantido.

2. **Nada que só existe no seu disco conta como feito.** Commit e push ao fim de cada
   sessão de trabalho, mesmo que o pacote esteja pela metade — branch `wip/` serve para isso.
   **Isto já custou caro:** 23 arquivos modificados e 3 arquivos novos da R0-07, incluindo a
   barreira de CI, ficaram órfãos numa máquina que caiu da rede. Foram recuperados por sorte,
   não por processo.

3. **Reporte estado verificado, nunca estado presumido.** "Os jobs estão executando" quando
   eles já terminaram vermelhos é a mesma família de defeito que a R0-04 conserta no produto:
   falha apresentada como sucesso. Cole a saída real do CI; não resuma o que você espera que
   tenha acontecido.

4. **Repositório certo.** O código vive em `C:\SAGE-WS\SAGE-API`. Existe um clone velho em
   `C:\Users\Admin\Documents\Projects\SAGE-API` que nem conhece as branches atuais — **não é
   aquele.** Confira com `git log --oneline -1` antes de escrever.

### Quem decide o quê

O arquiteto não escreve código de produção; o implementador não decide arquitetura. Se a
issue estiver ambígua **ou** se o plano contradisser o que você está vendo no código,
**pare e pergunte** — não escolha por conta própria e não "conserte" o plano.

---

## 1. O que é o SAGE

Plataforma de presença e autorização escolar da ETEC de Taboão da Serra. Registra entrada e
saída de alunos e funcionários por catraca Control iD, gera folha de ponto e folha de presença,
controla autorizações (visitante, saída de menor, exceções) e apresenta indicadores à secretaria.

**A catraca é um sensor e um atuador — não é o produto.** O produto é a interpretação
do que acontece no portão.

Roda **on-premise**, num PC Windows dentro da escola, desligado toda noite, mantido
remotamente por uma pessoa que não está no local. Isso explica quase toda decisão de
arquitetura deste repositório: se algo falha, ninguém tecnicamente capaz está por perto.

---

## 2. Leia antes de codar

Ordem de leitura, conforme o que você vai fazer:

| Documento | Quando é obrigatório |
|---|---|
| `C:\SAGE-WS\SAGE-arquitetura\PLANO-POS-AUDITORIA.md` | **Sempre, e atualizado (`git pull`).** É o que manda hoje |
| `docs/produto/roadmap.md` | **Sempre.** Manda nos outros documentos |
| `docs/arquitetura/sincronizacao.md` | Qualquer coisa que fale com a catraca |
| `docs/arquitetura/presenca.md` | Presença, pareamento, fechamento de período |
| `docs/arquitetura/atualizacao.md` | Atualização, versionamento, rollback |
| `docs/operacao/manutencao-remota.md` | Log, telemetria, dado pessoal |
| `docs/operacao/diagnostico.md` | Código de erro, support bundle |
| `docs/operacao/instalacao.md` | Instalador, empacotamento |

Índice completo em `docs/README.md`.

Se um documento conflitar com o `docs/produto/roadmap.md`, o roadmap vence — exceto ADR,
que registra decisão já tomada e vale por si. Se você achar um conflito, **abra uma issue
de decisão** em vez de escolher por conta própria.

**Precedência sobre comportamento do hardware:** os documentos em `docs/` do repositório
SAGE-API que descrevem comportamento observado da catraca (`ANALISE_SYNC_CONTROL_ID.md`,
`ORDEM_SYNC_CATRACA.md`, `FLUXO_PAGINACAO_E_SYNC.md`, `MONITOR_CONTROL_ID.md`) vencem a
documentação de arquitetura quando houver divergência. Aquilo é fato medido em campo; esta
é projeto. Não sobrescreva esses arquivos.

---

## 3. Papéis — saiba qual é o seu

- **Arquiteto** — define o quê e o porquê, escreve especificação, revisa entrega. Não escreve código de produção.
- **Implementador** (provavelmente você) — executa a especificação da issue. **Não decide arquitetura.**
- **Revisor** — confere a entrega contra os critérios de aceite antes do merge.
- **Dono do produto** (Caio) — prioridade, negociação com a escola, aprovação do merge.

Se você é o implementador e a issue está ambígua, **pergunte na issue**. Não invente
a decisão que falta. Uma pergunta custa minutos; uma decisão arquitetural errada custa semanas.

---

## 4. Regras invioláveis

Quebrar qualquer uma destas reprova o PR, mesmo que a funcionalidade esteja perfeita.

### 4.1 Nunca invente dado

Registro de presença é insumo de folha de ponto (salário) e folha de presença (registro
escolar). Se falta uma saída, **o registro fica pendente para um humano resolver** — não vira
horário estimado. Preencher lacuna com palpite é a falha mais grave possível neste projeto.

### 4.2 Nunca engula erro

```js
// PROIBIDO
try { ... } catch (e) { }
try { ... } catch (e) { return { sucesso: true }; }
```

Todo `catch` registra com `logger.error`, incluindo contexto (`pessoa_id`, `dispositivo_id`,
operação). Falha parcial é **falha**, nunca sucesso com aviso. Já tivemos bug em produção por
causa exatamente disso.

### 4.3 Nunca registre dado pessoal em log

Logue `pessoa_id=4821`. Nunca `pessoa=João Silva`.

Proibido em log, telemetria, mensagem de erro, issue e PR: nome, CPF, RG, e-mail, telefone,
endereço, foto, QR code, número de cartão, token.

**Atenção — não existe camada de redação hoje.** `src/config/redact.js` está previsto no
WP-05 e ainda não foi construído (verificado em 2026-08-05). Até ele existir, a única
proteção é o cuidado ao escrever cada linha de log. Não presuma que alguma camada vai
limpar o que você logou.

### 4.4 Nunca comite segredo

Sem senha, token, chave ou `.env` real no repositório. Só `.env.example` com valores de
exemplo. Isso inclui código de exemplo em comentário e teste.

### 4.5 Escrita na catraca é sempre idempotente

Use `create_or_update_objects`, nunca `create_objects`. A rede cai no meio da requisição e
você não sabe se ela chegou — vai reenviar. Operação que duplica objeto ao ser repetida está errada.

### 4.6 Decisão de segurança falha fechada

Configuração ausente **nega**, nunca libera.

```js
// ERRADO — sem a variável configurada, a rota fica aberta
if (!isDev && key !== undefined && req.query.key !== key) return res.status(401)...

// CERTO
if (!isDev && (!key || req.query.key !== key)) return res.status(401)...
```

Exceção documentada: **entrada** de pessoas na catraca libera em caso de falha (barrar cria
fila e atrito). **Saída de menor e entrada de visitante bloqueiam.** Ver ADR-05 no roadmap.

### 4.7 Escrita multi-passo usa transação

Importação de planilha, criação de pessoa com vínculos, fechamento de período. Se falha na
etapa N, nada das etapas anteriores permanece.

### 4.8 O atualizador nunca toca em `dados/`

Código é descartável, dado é sagrado. `releases/` é substituível; `dados/`, `config/` e
`logs/` jamais são tocados por atualização.

---

## 5. Disciplina de escopo

**Faça exatamente o que a issue pede. Nada além.**

Se você encontrar outro bug enquanto trabalha:

1. **Não corrija junto.**
2. Abra uma issue nova usando o template de bug.
3. Mencione na sua issue atual: "encontrado durante #42, aberto como #57".
4. Siga com o escopo original.

Motivo: PR misturado é impossível de revisar e impossível de reverter. Se a correção
oportunista quebrar algo, você perde também a entrega principal.

**Não faça sem pedido explícito:** renomear coisas fora do escopo, trocar biblioteca,
reformatar arquivo inteiro, "melhorar" código adjacente, atualizar dependência.

---

## 6. Testes

- **Correção de bug exige teste de regressão que falha antes e passa depois.** Sem exceção.
- Funcionalidade nova exige teste dos critérios de aceite da issue.
- Redação de PII tem teste que reprova o build se CPF, RG, e-mail ou JWT sintético vazar.
- Integração com catraca testa contra o simulador, nunca contra hardware real no CI.

Rodar: `npm test` (Vitest).

---

## 7. Convenções

**Branches**

```
wp/00-emergencia          pacote de trabalho
fix/57-qr-corrompido      correção de bug
docs/arquitetura          documentação
```

**Commits** — Conventional Commits, descrição em português:

```
fix(sync): unifica CATRACA_USER_ID_OFFSET num módulo único

O default divergia entre controlIdService (110000000) e deviceController
(111000000), fazendo o log da catraca ser atribuído à pessoa errada quando
a variável não estava definida.

Closes #42
```

**Código**

- `camelCase` para variável e função, `PascalCase` para classe
- Comentário de negócio em português; explique **por quê**, não **o quê**
- Nome de domínio em português (`Pessoa`, `Turma`, `RegistroPresenca`) — o domínio é escolar brasileiro
- Sem `console.log` em código de produção. Use o `logger` (Winston)

**Pull request**

- Um PR por issue, referenciando com `Closes #N`
- Preencha o template. A checklist de critérios de aceite não é enfeite
- PR que não passa nos critérios da issue não é revisado

---

## 8. Como criar uma issue

Se você precisa registrar trabalho, use os templates em `.github/ISSUE_TEMPLATE/`:

| Template | Use quando |
|---|---|
| **Pacote de trabalho** | Entrega planejada, vinda do roadmap |
| **Bug** | Comportamento errado em código existente |
| **Decisão de arquitetura** | Escolha que muda desenho e precisa de aprovação humana |

Regras de conteúdo, mesmo com repositório privado:

- **Nunca cole log cru.** Use o código de erro (`CAT-CONN-03`) e o identificador de ocorrência (`7K2M-9XQ4`)
- **Nunca cole print com pessoa real.** Use dados sintéticos do ambiente de teste
- **Nunca cole IP interno, credencial ou trecho de `.env` real**
- Repositório privado ainda tem equipe, ainda pode virar público por engano, e dado pessoal
  em repositório continua sendo tratamento de dado sob a LGPD

A issue deve ser autossuficiente: alguém (ou outro agente) precisa conseguir executá-la
lendo só ela e os documentos referenciados.

---

## 9. Armadilhas conhecidas deste repositório

Coisas que já causaram bug aqui. Verifique antes de mexer nas áreas correspondentes.

- **`CATRACA_USER_ID_OFFSET`** precisa ser o mesmo em escrita e leitura. **Diverge agora**, não "já divergiu": `controlIdService.js:11` usa `110000000` e `accessService.js:8` / `deviceController.js:105` usam `111000000`. A variável está comentada no `.env`, então valem os defaults. Quem gravou usuário na catraca com o offset antigo continua órfão mesmo depois de unificar — a correção precisa tratar a transição, não só a constante.
- **`CATRACA_MIN_LOG_ID` é global e descarta log cedo demais.** É um único valor para todas as catracas, aplicado no primeiro `if` do laço — antes da conversão de `user_id`. Foi a causa medida do caso dos 48.057 logs com zero inseridos (ver `ANALISE_SYNC_CONTROL_ID.md`, onde `ignoradosPessoa=0` prova que os logs morreram antes da conversão). Não confunda com o bug de offset: são dois defeitos independentes que produzem o mesmo sintoma. Corrigir só um não resolve.
- **`deviceService.obterSessao`** não pode disparar sincronização — gera recursão via `verificarSyncPendentes`.
- **Editar cartão** apaga e recria. Se falhar no meio, a pessoa fica sem credencial e não entra na escola. Precisa de compensação.
- **Trocar aluno de turma** adiciona ao novo grupo antes de remover do antigo. Nunca o inverso — senão existe um instante sem acesso.
- **`destroy_objects`** é irreversível no hardware. Exige backup verificado por releitura antes.
- **Relógio da catraca** é próprio dela. Em modo standalone, as regras de horário usam esse relógio.
- **Catraca antiga sem módulo facial** rejeita envio de foto. Ver `CATRACA_SKIP_USER_IMAGE`.
- **Logs em volume** — a catraca não filtra na origem; ela devolve todos. Já houve caso de 70 mil.

---

## 10. Em caso de dúvida

Ordem de preferência:

1. Procure no `docs/arquitetura/`
2. Pergunte na issue e aguarde
3. **Nunca** decida arquitetura por conta própria e siga em frente

Uma pergunta não respondida custa um dia. Uma decisão errada assumida em silêncio custa semanas
e, neste projeto, pode custar dado de presença que ninguém consegue reconstruir.
