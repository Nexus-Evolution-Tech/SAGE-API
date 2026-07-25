# Spec — Fase 0: Consolidação das branches

**Tier:** T2 · **Bloqueia:** tudo · **Base:** mapa de conflitos verificado com `git merge-tree` (Git 2.50.1)

## Objetivo
Uma única branch `integration` em cada repositório, contendo todo o conteúdo único, sem feature
perdida e sem lixo. Nenhum trabalho pode começar antes disso, sob risco de ser feito na cópia errada.

---

## 🔴 Decisão bloqueante D-1 — nome da coluna de toggle de sync

**A mesma feature (desativar sincronização por dispositivo) foi implementada 3 vezes, de formas
incompatíveis.** Isto é a causa de quase todos os conflitos do backend.

| | `primeiro-docker` (ponta) | `terceira-versao` | `nao-funcional` |
|---|---|---|---|
| Coluna | `sincronizar` | `sync_enabled` | `sync_ativo` |
| Migration | `migration_sincronizar_dispositivo.sql` | `migration_dispositivo_sync_enabled.sql` (+índice) | `migration_sync_ativo.sql` |
| Helper | — | `isSyncEnabled()` em `utils/syncFlags.js` | comparação inline |
| Rota | — | `DELETE /dispositivos` (limparUsuarios) | `POST /dispositivos/:id/toggle-sync` |

**Recomendação: padronizar em `sync_enabled`** (a de `terceira-versao`), porque é a única com helper
dedicado, índice e semântica explícita. Requer migration de renomeação para bancos já migrados.

⚠️ **Decidir antes de qualquer merge no backend.** Sem isso, `deviceController.js` conflita em 3
branches e as migrations criam 3 colunas redundantes.

## Decisões secundárias (recomendação já embutida na ordem de merge)

| # | Item | Recomendação |
|---|---|---|
| D-2 | `accessService.js:111` — fallback quando a catraca devolve 0 logs | **Manter a da ponta** (tem proteção `monitorLimit` contra processar 49k logs em modo monitor). A de `nao-funcional` remove essa proteção |
| D-3 | `scheduledJobs.js:124` — pendentes de dispositivo com sync off | **Manter a de `terceira-versao`** (`disabledDevices` + `error_message`). A de `nao-funcional` trata como *offline*, gerando **retry infinito** para dispositivo desligado de propósito |
| D-4 | `deviceRoutes.js:29` — duas rotas novas | **Manter as duas.** Conflito só posicional |
| D-5 | `accessService.js:283` — guardas `isDeviceZerando` e sync-off | **Manter as duas.** São complementares |
| D-6 | Frontend: 4 implementações concorrentes de Relatórios | **Base = ponta**; portar só `SimularAcesso.jsx` e `BotaoExportar.jsx` de `relatorios-principal`. Descartar `relatorios` e `copilot/add-relatorios-screen` |
| D-7 | Frontend `Home.js`: `nao-funcional` (+15) vs `relatorios` (reescrita de 317) | **`nao-funcional`.** Mutuamente exclusivos |
| D-8 | API `primeira-versao` | **Descartar** — é versão anterior de `accessService.js` e usa `USER_ID_OFFSET=110000000`, que quebra o pareamento com `controlIdService` (111000000) |
| D-9 | API `Relatorio` — commita `.env` com 46 linhas | Avaliar a feature **depois** da `integration` estável; **nunca** trazer o `.env` |
| D-10 | API `sync`/`syncronism`, `authentication` | **Descartar.** 19 conflitos cada, base de meses atrás, feature já presente na ponta |

---

## Execução

### SAGE (frontend) — caminho fácil
1. `git switch -c integration origin/primeiro-docker`
2. Merge `origin/nao-funcional` — **conflito zero, verificado**
3. Copiar isoladamente `SimularAcesso.*` e `BotaoExportar.*` de `relatorios-principal` + rota em `App.js`
4. Merge `origin/primeira-versao` (2 conflitos pequenos: `App.js`, `api.js`) → tela DadosEscolares
5. Aplicar as 3 linhas de `refatoracao` manualmente
6. Cherry-pick só `catalog-info.yaml` de `origin/main`

### SAGE-API (backend) — a ordem importa
1. **Resolver D-1 primeiro**
2. `git switch -c integration origin/primeiro-docker`
3. Merge `origin/terceira-versao` (`ef9d45f`) — **1 conflito, 1 linha**. Traz a base arquitetural
   (`syncFlags.js`, `syncOrder.js`, `catracaImportService.js`)
4. Merge `origin/nao-funcional` (`3b96082`) — nesta ordem, os conflitos já ficam enquadrados por D-1.
   Ordem inversa obriga a resolver o mesmo conflito duas vezes
5. Cherry-pick só `catalog-info.yaml` de `origin/main`
6. `Relatorio` e `dev` ficam para depois da `integration` estável

## Limpeza (arquivos de lixo — estão na própria ponta)
`src/services/exportService 2.js` · `src/services/networkDiscoveryService 2.js` ·
`src/routes/subjectRoutes.js.bak` · `database/~$PlanilhaDadosEscolares.xlsx`

## Purge de histórico (LGPD)
Remover do histórico dos dois repositórios, com `git-filter-repo`: fotos de pessoas
(`src/uploads/pessoas/*`), SQL com dados reais (`database/pessoas_etec.sql`), exports
(`exports/*.xlsx`), e o `.env` da branch `Relatorio`.
Depois: rotacionar toda credencial que já esteve no histórico.

---

---

## ✅ EXECUÇÃO — registro do que foi feito

### Decisões extras tomadas durante a execução

| # | Item | Decisão | Motivo |
|---|---|---|---|
| D-11 | `SimularAcesso.jsx` de `relatorios-principal` | **Não portado** | É ferramenta de debug com **10 nomes reais de alunos hardcoded** (`const pessoas = [...]`). Trazer isso importa dado pessoal de menores para a branch consolidada. Depende também de `criarAcesso`, inexistente na `api.js` da ponta |
| D-12 | `BotaoExportar.jsx` de `relatorios-principal` | **Não portado** | 11 linhas puramente apresentacionais, sem nenhuma implementação de export por trás. Portar geraria botão que não faz nada. Reimplementar junto com a feature é mais barato |
| D-13 | `refatoracao` (frontend) | **Nada a aplicar** | Verificado: as 3 linhas (opção `INT` em divisão, remoção de botão morto) **já estão na ponta** |
| D-14 | Semântica do quick-add de dispositivo | **Preservada**, com `TODO` | A ponta criava dispositivo com sync **desligado** por padrão, divergindo do `DEFAULT 1` da coluna. Consolidação preserva comportamento; a correção é decisão de produto, marcada em `deviceController.js` |

### 🔴 Defeitos encontrados que o merge limpo escondia

O `git merge-tree` previa auto-merge sem conflito nestes arquivos — e todos estavam **quebrados**:

1. **`sage.sql` criaria DUAS colunas** (`sync_enabled` e `sync_ativo`) no mesmo `CREATE TABLE`.
2. Referências residuais à coluna antiga em `sync_catracas.js`, `sync.js`, `deviceController.js`
   (toggleSync inteiro), `importService.js` e `accessService.js` (`COALESCE(sincronizar, 1)`).
   Nenhuma gerou marcador de conflito; todas quebrariam em runtime.
3. O frontend chamava `toggle-sync` com `sync_ativo` — contrato desalinhado.

**Confirmação da tese da spec:** merge limpo não é sinal de segurança. Só a varredura manual por
referência de coluna pegou isso, e não havia teste algum para pegar.

### 🔴 Defeitos pré-existentes na ponta (não causados pela consolidação)

**O frontend da `primeiro-docker` não compilava.** Dois motivos:
1. Faltava a peer dependency `@fortawesome/fontawesome-svg-core`. Como o `Dockerfile` roda
   `npm run build`, **a imagem Docker do frontend nunca pôde ter sido construída** — o "primeiro
   docker" nunca funcionou de fato.
2. `faArrowsRotateSlash` (vindo de `nao-funcional`) é ícone **Pro** do FontAwesome, inexistente no
   pacote free. Substituído por `faBan`. Isso provavelmente explica o nome da branch.

Ambos corrigidos, porque o DoD da fase é "sobe e roda".

### Verificação executada
- ✅ Backend: 111 arquivos `.js` sem erro de sintaxe; `require('./src/app')` resolve todo o grafo
  de módulos (rotas, controllers, services)
- ✅ Frontend: `npm run build` **passa** (298 kB gzip)
- ✅ Nenhum marcador de conflito remanescente
- ✅ Nenhuma referência residual a `sincronizar` / `sync_ativo` no código
- ⚠️ **Não verificado:** comportamento em runtime com banco e catraca reais. Não há teste
  automatizado — é exatamente a lacuna que a Fase 1 fecha

### Pendências que ficaram fora (exigem sua autorização)
- **Purge de histórico** (fotos de pessoas, `pessoas_etec.sql`, exports, `.env` da branch `Relatorio`)
- **Rotação de credenciais** que já estiveram no histórico
- **Deletar branches obsoletas no remoto**
- **Push da `integration`**
- Verificar `conserto_erro_dependencia_circular_sync` e `authentication` linha a linha antes de descartar
- Avaliar branches `Relatorio` e `dev` (API) como trabalho separado

---

## Definition of Done
- [ ] D-1 decidida e migration de renomeação escrita
- [ ] `integration` em ambos os repos, subindo e rodando
- [ ] Todo conteúdo único preservado ou descartado **com decisão registrada** neste documento
- [ ] Arquivos de lixo removidos
- [ ] Purge de histórico concluído e credenciais rotacionadas
- [ ] Branches obsoletas deletadas no remoto
- [ ] `README` atualizado dizendo qual é a branch de trabalho

## Riscos
- **`git merge-tree` prevê merge automático, não correção semântica.** `scheduledJobs.js` e
  `accessService.js` auto-mergeiam **sem marcador de conflito** e ainda assim podem quebrar em
  runtime por causa do problema de nome de coluna (D-1). **Merge limpo aqui não é sinal de
  segurança** — por isso a Fase 1 vem logo depois.
- Não há teste para provar que a consolidação não regrediu nada. A Fase 0 é feita **no escuro**, e
  esse é o argumento mais forte para a Fase 1 vir imediatamente a seguir.
- `conserto_erro_dependencia_circular_sync` e `authentication` foram classificados como
  descartáveis **por inferência de data**, não por verificação linha a linha. Verificar antes de
  deletar o remoto.
- Purge de histórico reescreve SHAs e quebra clones existentes. Combinar com quem mais tem cópia.
