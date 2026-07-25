# Spec — Fase 2b: Desempenho e tempo real

**Tier:** T2 · **Depende de:** Fases 1 e 2 · **PRD:** RNF-5, 6, 7

## Objetivo
Tornar o monitoramento efetivamente em tempo real e a sincronização em massa rápida — **sem que o
histórico atrase o recente**. Alvo: desktop com HD 7200 rpm e 8 GB de RAM.

> **Primeiro passo obrigatório: medir no hardware real.** Todos os números abaixo são estimativa
> derivada do código e de valores típicos de HD mecânico, **não medição**. Se o gargalo dominante
> for outro (rede da catraca, CPU, Defender), esta spec muda.

---

## E0 — Medição de linha de base
Profiler na máquina da escola antes de tocar em código. Coletar: `innodb_buffer_pool_size` atual
(se for o padrão de 128 MB, parte do problema é config, não código), tempo de sync por fase,
IOPS, latência de query, uso de memória com o navegador aberto.

## E1 — Idempotência que também é a correção de desempenho
Migration: `Acesso.catraca_log_id` + `UNIQUE (dispositivo_id, catraca_log_id)`.

| Antes | Depois |
|---|---|
| `SELECT` de duplicata por log (1-2 queries) | **Nenhuma** — `INSERT ... ON DUPLICATE KEY UPDATE` |
| `SELECT * FROM Pessoa` por log | **1 query por lote** → `Set` em memória |
| 1 INSERT + 1 fsync por log (48k → 4-8 min só de fsync) | **Lotes de ~500 em transação explícita** → ~96 fsyncs |
| 3 efeitos colaterais por linha (WebSocket, cache, notificação) | 1 evento agregado por lote |
| Dupla checagem de fuso | Removida junto com a correção de fuso |

Também: `UNIQUE (pessoa_id, data)` em `Presenca` (hoje a dedup é check-then-act em código).
Tamanho do lote **configurável**, não constante mágica — é trade-off entre velocidade e retrabalho
em caso de queda no meio.

## E2 — Push como padrão de instalação (o item de maior impacto no tempo real)
O intervalo de polling domina a latência por ~100x. Otimizar banco **não melhora** o tempo de um
acesso aparecer na tela.

- Instalador cria a regra de entrada do **Firewall do Windows da própria máquina do SAGE**,
  restrita à sub-rede local. Não depende da rede da escola.
- Push é o caminho primário; segurança (`monitorCallbackAuth.js`: token, whitelist de IP,
  janela anti-replay) passa a ser **exigida**, não opcional.
- **Polling muda de papel**: deixa de ser o mecanismo de latência e vira rede de segurança e fonte
  de completude — leve e frequente (50 logs a cada ~5s).
- 🔴 **Detecção de push morto:** se a catraca perder a configuração do Monitor, o push para de chegar
  e o sistema fica lento **sem erro nenhum** — exatamente o padrão que a Fase 2 acabou de matar. O
  polling de segurança precisa detectar acessos que o push deveria ter trazido, e **alertar**.
- ⚠️ Depende de B-2: confirmar que a IDBlock antiga suporta `set_configuration` de forma confiável.

## E3 — Isolamento estrito de prioridade
1. **Reserva de conexões.** Hoje `connectionLimit` é global (10) — backfill pode ocupar o pool e
   fazer o caminho ao vivo esperar. Backfill limitado a 1 conexão; caminho ao vivo com cota reservada.
2. **Backfill cooperativo:** lotes de ~200 e, entre lotes, "há trabalho ao vivo? → cede a vez".
   Nunca transação longa segurando fila de fsync.
3. **Ordem recente-primeiro** como invariante testada (hoje já é o comportamento, `accessService.js:151`).
4. **Caminho ao vivo nunca reconsulta a lista inteira** — insere e emite por WebSocket; o front
   aplica o evento na lista que já tem. Hoje há risco de o front refazer `GET /acessos` (com
   `COUNT(*)`) a cada evento, deixando o monitoramento **mais lento quanto mais acessos acontecem**.
5. **Botão "sincronizar agora com prioridade máxima"** para quando alguém precisa do histórico na hora.
6. Progresso visível do backfill ("histórico: 31.200 de 48.057") — lentidão vira trabalho, não travamento.

## E4 — Tuning de banco e recursos
- `innodb_buffer_pool_size` **1,5-2 GB** (padrão é 128 MB), `innodb_redo_log_capacity` maior,
  `innodb_io_capacity` **baixo** (o padrão pressupõe disco melhor que 7200 rpm).
- Cap explícito de heap do Node.
- Paginação de logs da catraca via `limit`/`offset` (já suportado por `obterLogsCatraca`).
- Redis removido.
- **Windows Defender ≠ Firewall**: excluir o diretório de dados do MySQL da varredura em tempo real.
- Reavaliar se os 3 índices secundários de `Acesso` são todos necessários — em HD, o INSERT no
  índice clusterizado é append sequencial (barato), mas **cada índice secundário é escrita
  aleatória** por linha. São eles o custo real do backfill.
- Paginação por cursor (`WHERE id < ?`) no lugar de `COUNT(*)` + OFFSET.

---

## Critérios de saída (medidos no hardware real)
| Métrica | Meta |
|---|---|
| Acesso novo na tela (push) | < 1s |
| Idem, degradado para polling | < 5s |
| Primeiros acessos após ligar o PC | < 3s |
| Backfill de 48k logs | < 2 min |
| **Latência ao vivo durante o backfill** | **< 1s, degradação < 20%** |

A última linha é a que traduz o requisito do cliente. As outras são consequência.
⚠️ Números propostos por nós — **B-4: o cliente precisa confirmar o que é aceitável.**

## Definition of Done
- [ ] Linha de base medida antes e depois, na máquina real
- [ ] `catraca_log_id` UNIQUE + lotes transacionais + fim do N+1
- [ ] Push por padrão na instalação, com detecção de push morto
- [ ] Isolamento de prioridade com **teste que mede latência ao vivo durante backfill**
- [ ] Tuning aplicado e documentado no instalador
- [ ] Testes das Fases 1 e 2 continuam verdes

## Riscos
- Números são estimativa, não medição — E0 existe por isso.
- Lote grande piora recuperação: queda no meio descarta o lote. Recuperável por resync, mas o
  tamanho precisa ser ajustável.
- Throttle é fácil de calibrar errado: agressivo demais engasga a UI, conservador demais nunca
  completa o histórico. Sem o teste de latência-durante-backfill, é ajuste no escuro.
- Se o filtro `where` da catraca não for honrado (B-2), baixa-se 48k logs a cada ciclo.
