# Fluxo: paginação, sincronização e tela de monitoramento

Documento que explica como funciona o esquema de dados (catraca → banco → tela) e como a sincronização se encaixa.

---

## 1. A tela puxa da catraca ou do banco?

**A tela puxa só do banco.** A catraca não é consultada quando o usuário abre o monitoramento ou troca de página.

- **GET /acessos?page=1&limit=10** → a API lê **direto do MySQL** (`SELECT ... FROM Acesso ORDER BY id DESC LIMIT 10 OFFSET 0`).
- Paginação = ler páginas diferentes do **mesmo** banco (LIMIT/OFFSET). Rápido, porque não há chamada à catraca nessa hora.

Resumo: **catraca → (sync em background) → banco → (GET /acessos) → tela.** A catraca entra só no processo de sync, não na listagem.

---

## 2. De onde vêm os ~49k logs?

Os ~49k ficam **na memória da catraca**. O que acontece é:

1. **Sync (job em background)**  
   - De tempos em tempos (ex.: a cada 20 s, `MONITOR_POLLING_INTERVAL_MS`) o backend chama a catraca: **uma requisição** por dispositivo (`load_objects` com `object: 'access_logs'`). Não faz uma requisição por pessoa/registro.
   - A API da Control iD **não aceita filtro** nessa chamada: a catraca envia **todos** os logs (ex.: 49k) em uma resposta só.
   - O backend recebe essa lista **uma vez** e, a partir daí, só processa em memória e grava no MySQL (SELECT/INSERT no nosso banco). Ele:
     - Filtra em JS (ex.: `log.time > timestampInicial`, `log.id > MIN_ID`, evita duplicata por pessoa/dispositivo/data_hora).
     - **Só insere no MySQL os que ainda não existem** na tabela `Acesso`.

2. **Banco**  
   - A tabela `Acesso` vai acumulando **só o que a sync já “passou” e inseriu**. Pode ter 500, 5k ou 50k linhas, conforme o que já foi sincronizado e não foi apagado.

3. **Tela**  
   - A tela mostra **só o que está no banco**, paginado (10, 20, 50, 100). Nada é puxado “ao vivo” da catraca na hora de listar.

Conclusão: a API **não** puxa os 49k e guarda tudo de uma vez na hora que você abre a tela. Ela **já** foi puxando aos poucos (sync em background) e guardando no banco; a tela só lê esse banco.

---

## 3. Esquema de sincronização (como é hoje)

- **Direção:** só **catraca → backend**.  
  - Lemos os logs da catraca e inserimos/atualizamos o nosso banco.  
  - **Não** há hoje: “apagar aqui e apagar na catraca” nem “modificar aqui e modificar na catraca”. Ou seja, não é sincronização bidirecional.

- **Evitar retrabalho:**  
  - Antes de inserir, checamos se já existe registro com mesmo `pessoa_id`, `dispositivo_id`, `data_hora`. Se existir, não inserimos de novo.  
  - Assim, se a sync rodar de novo (ou você parar e voltar), ela **continua de onde parou** no sentido de “não duplica o que já está no banco”.

- **Onde ainda é pesado:**  
   - A Control iD, nessa API, **não** oferece “me dê só os logs após o id X” (ou após um timestamp). Por isso, **cada** rodada de sync ainda **pede todos os logs** à catraca; o alívio é só no backend (filtrar em JS e não inserir duplicatas).  
   - Melhorar isso de verdade depende de: API permitir filtro por id/timestamp, ou guardar “último id sincronizado” por dispositivo e, mesmo recebendo tudo, processar só a partir desse id (reduz trabalho de INSERT, não o tamanho da resposta da catraca).

---

## 3.1 Estratégia de otimização (sem novos endpoints na catraca)

Por enquanto **não** criamos novos contatos com os endpoints da catraca (isso fica para estudo depois). Só otimizamos backend e frontend para a tela de monitoramento funcionar sem esperar 49k logs.

1. **Sync por ordem de horário (mais recente primeiro)**  
   - Depois de receber os logs da catraca, o backend **ordena por `time` DESC** e processa nessa ordem.  
   - Assim os **últimos acessos** entram no banco primeiro; o usuário vê a informação o mais rápido possível (ex.: 10, 20, 50 itens já na primeira página) enquanto a sync continua em background com o resto.

2. **Paginação: só contagem + página atual**  
   - O backend **nunca** retorna todos os registros: faz `SELECT ... LIMIT ? OFFSET ?` (só a página pedida) e `SELECT COUNT(*) AS total` (só a contagem).  
   - A tela mostra **“X de Total registros”** (ex.: “10 de 1098”) e **só renderiza a página atual**; o total pode crescer conforme a sync insere mais (sem travar a tela).

3. **Novos endpoints na catraca**  
   - Filtros por id/timestamp, “continuar de onde parou” na própria API, etc. ficam para depois, quando for estudar a API da Control iD a fundo.

- **Processo à parte:**  
  - A sync roda em **job em background** (intervalo ou cron). Não bloqueia a API que atende GET /acessos. O usuário **já vê em segundos** o que está no banco (últimos acessos, na ordem que você definiu), enquanto a sync continua trazendo mais dados em background. Novos acessos podem aparecer na tela por refetch (polling do front) ou por WebSocket quando a sync inserir no banco.

---

## 4. Resumo visual

```
[Catraca ~49k logs]
        │
        │  Sync (background, ex.: a cada 20 s)
        │  - Chama load_objects (catraca manda todos)
        │  - Ordena por time DESC (mais recente primeiro)
        │  - Filtra em JS (timestamp, MIN_ID, duplicata)
        │  - INSERT só dos novos
        ▼
[Banco MySQL - tabela Acesso]
        │
        │  GET /acessos?page=&limit=
        │  - SELECT ... LIMIT/OFFSET (só banco)
        ▼
[Tela de monitoramento]
        - Paginação 10/20/50/100
        - Mostra só o que já está no banco
        - Novos acessos entram quando a sync inserir + refetch ou WebSocket
```

---

## 5. O que já atende ao que você descreveu

- **“Pego os últimos do banco de acordo com a paginação e mostro”** → Sim. A tela lê só do banco e mostra os últimos (ordenados por id/data) com a paginação que você escolheu.
- **“Sincronizar tudo no meu banco”** → A sync vai trazendo os logs da catraca e inserindo no banco (sem duplicar). O “tudo” é limitado pelo que a catraca ainda guarda e pelo que já foi processado.
- **“Continuar de onde parou, otimizado”** → Já evita retrabalho ao não inserir duplicatas. A parte ainda não otimizada é a chamada à catraca (sempre recebendo todos os logs), por limitação da API.
- **“Usuário vê os últimos em segundos; sync em processo à parte”** → A listagem/paginação vem do banco (rápido). A sync roda em job separado; quando inserir novos acessos, a tela pode atualizar por refetch ou WebSocket.

---

## 6. Sincronização bidirecional (apagar/modificar “aqui” e refletir “lá”)

Hoje **não** fazemos:

- Apagar um acesso no nosso banco e apagar na catraca.
- Modificar um acesso aqui e modificar na catraca.

Isso seria **outro fluxo** (backend → catraca), dependendo de a API da Control iD expor endpoints para apagar/alterar logs de acesso. O desenho atual é apenas **catraca → backend**.

---

## 7. Referências no código

| O quê | Onde |
|-------|------|
| Sync (puxar logs da catraca e inserir no banco) | `src/services/accessService.js` → `sincronizarAcessos` |
| Ordenação mais recente primeiro (logs.sort por time DESC) | `src/services/accessService.js` → antes do for em sincronizarAcessos |
| Chamada à catraca (load_objects, todos os logs) | `src/services/deviceService.js` → `obterLogsCatraca` |
| Job de sync em background | `src/jobs/scheduledJobs.js` → `pollingMonitoramentoJob` (intervalo) e `sincronizarAcessosJob` (cron) |
| Listagem paginada (só banco) | `src/controllers/accessController.js` → `listar` (SELECT ... LIMIT/OFFSET) |
| Tela de monitoramento / paginação | Frontend: `Home.js` (GET /acessos?page=&limit=) |

Este documento pode ser atualizado quando houver mudança no fluxo (ex.: API passar a aceitar filtro por id/timestamp, ou implementação de sync bidirecional).
