# Spec — Fase 1: Rede de segurança (simulador + testes + CI)

**Tier:** T2 (produção) · **Depende de:** Fase 0 concluída · **Bloqueia:** todas as seguintes

## Por que esta fase existe

Refatorar 22.000 LOC sem testes é apostar o projeto. E o conhecimento empírico da Control iD hoje
é **folclore em código** — alguém vai "consertar" o `HTTP 400 = sucesso` achando que é bug, e
quebrar a sincronização em produção. Esta fase transforma folclore em teste executável.

**Esta fase não entrega feature visível ao cliente.** É a fase que mais determina o resultado e a
mais difícil de justificar. Combinar isso explicitamente antes de começar.

---

## Entregável 1 — Simulador de catraca Control iD IDBlock

Servidor HTTP fake, em processo (para teste) e standalone (para desenvolvimento manual), que imita
uma IDBlock antiga.

### Endpoints a implementar
| Endpoint | Comportamento |
|---|---|
| `POST /login.fcgi` | Devolve `{ session }`. Sessão expira por tempo configurável |
| `POST /load_objects.fcgi?session=` | `users`, `cards`, `groups`, `access_logs`. Suporta `where`, `limit`, `offset`, `order` |
| `POST /create_objects.fcgi?session=` | Cria usuário/cartão/grupo/vínculo |
| `POST /modify_objects.fcgi?session=` | Edita. **Ver quirk Q1** |
| `POST /destroy_objects.fcgi?session=` | Remove |
| `POST /set_configuration.fcgi?session=` | Configuração do Monitor (push) |
| — | Emissão de evento push para uma URL de callback |

### Quirks obrigatórios (o coração da fase)
Cada um vira um teste nomeado. Referência: `ARQUITETURA-PROPOSTA.md` §5.

| ID | Comportamento a simular | Origem |
|---|---|---|
| **Q1** | `modify_objects` responde **HTTP 400 com corpo de erro vazio quando teve sucesso** | `controlId-utils.js:122` |
| **Q2** | Sem módulo facial: rejeita `user_images` | `controlIdService.js:150` |
| **Q3** | `load_objects` de `access_logs` devolve **todos** os logs (dataset de 48k) e demora | doc interna |
| **Q4** | Modo configurável: honra o filtro `where { id: { '>': X } }` **ou o ignora silenciosamente** — os dois modos, porque não sabemos qual é o real (B-2) | código vs. doc divergem |
| **Q5** | IDs de `access_logs` são **por dispositivo**, faixas diferentes por instância | doc interna |
| **Q6** | `user_id` na catraca = `OFFSET + pessoa.id`; suportar dois offsets (110000000 e 111000000) para testar detecção de órfãos | `controlIdService.js` |
| **Q7** | Aceitar vínculo por `registration` além de `id` (para avaliar migração futura) | `controlId-utils.js:101` |

### Modos de falha injetáveis (não opcionais)
`offline` · `timeout` · `sessão expirada no meio da operação` · `resposta parcial/truncada` ·
**`processa a requisição e perde a resposta`** (o modo que prova idempotência) ·
`lentidão configurável` · `perda de evento push`.

### Critério de aceite
- Cada quirk Q1-Q7 tem teste nomeado que falharia se o quirk fosse "corrigido".
- O simulador roda in-process nos testes sem porta fixa (porta efêmera).
- Dataset sintético de 48.057 logs gerável de forma determinística (seed fixa).

---

## Entregável 2 — Infraestrutura de teste

- **Vitest** como runner (unit + integração).
- **Testcontainers** com MySQL real na versão alvo (8.4 LTS). Sem SQLite fingindo ser MySQL — as
  diferenças de fuso, ENUM e constraint são exatamente o que precisamos testar.
- Fixtures de banco: schema aplicado pelo caminho real (`setup-database.js`), não por dump paralelo
  — assim o próprio instalador fica sob teste.
- Helpers: fábrica de pessoa/turma/dispositivo, relógio controlável (fake timers) para testes de
  fuso e de job catch-up.
- Meta de tempo: suite de unit < 30s; integração < 3 min.

## Entregável 3 — Testes de caracterização

Travam o comportamento **atual** antes de qualquer refatoração.

Cobertura mínima:
1. **Sincronização de pessoa → catraca**: criar, editar, deletar; com dispositivo online, offline e
   com resposta perdida.
2. **Ingestão de logs**: filtro por `ultimo_log_id_sincronizado`, deduplicação, conversão de fuso,
   ordenação recente-primeiro.
3. **Presença e atraso** ⚠️ **bloqueado por B-1**.
4. **Promoção de alunos** ⚠️ **bloqueado por B-1**.
5. **Importação/exportação XLSX**: planilha modelo → registros esperados.
6. **Autenticação atual** (por escola) — para não quebrar antes da Fase 3 substituir.

> ⚠️ **Regra crítica:** teste de caracterização congela bug junto com acerto. Para os itens 3 e 4,
> **não escrever teste antes de B-1 ser respondido.** Onde o comportamento atual for confirmado
> como errado, o teste nasce marcado `.fails()` com link para a issue, nunca consagrando o erro.

## Entregável 4 — CI

- Pipeline: `lint` → `typecheck` (quando existir) → `test:unit` → `test:integration`.
- Barra merge com pipeline vermelho.
- Roda em push e em PR.

---

## Definition of Done
- [ ] Simulador cobre Q1-Q7 e os 7 modos de falha, cada um com teste nomeado
- [ ] Testcontainers com MySQL 8.4 subindo o schema pelo caminho real de instalação
- [ ] Testes de caracterização dos itens 1, 2, 5, 6 verdes
- [ ] Itens 3 e 4 escritos **somente após** B-1, ou marcados como pendência explícita
- [ ] CI verde, barrando merge vermelho
- [ ] Nenhum teste desabilitado sem justificativa registrada
- [ ] Diff em PRs de ≤300 linhas

## Riscos
- **O simulador é derivado do código atual + doc oficial.** Onde divergem (Q4), só o equipamento
  real decide — por isso Q4 tem dois modos. Até B-2, Q4 fica **não verificado**, não resolvido.
- **Testes de caracterização podem consagrar bugs.** Mitigado pela regra acima; ainda assim é o
  risco central desta fase.
- **Testcontainers em máquina modesta** é pesado no desenvolvimento. Se doer, considerar MySQL local
  compartilhado para o loop rápido e Testcontainers só no CI.
