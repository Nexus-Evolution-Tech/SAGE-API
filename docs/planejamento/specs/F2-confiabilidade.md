# Spec — Fase 2: Confiabilidade e observabilidade

**Tier:** T2 · **Depende de:** Fase 1 (sem testes, não se mexe nisso) · **PRD:** RNF-3, 4, 8, 10, 12

## Objetivo
Fazer o sistema **sempre saber e mostrar seu estado real**, sobreviver a desligamento abrupto, e ser
diagnosticável de longe. É a fase que ataca diretamente o motivo pelo qual o software não entrou em
produção.

> Observabilidade está aqui, e não na Fase 8, porque se a primeira instalação em produção acontecer
> sem ela, ficamos cegos exatamente no período das primeiras falhas reais. Ver `MANUTENCAO-REMOTA.md` §0.

---

## E1 — Matar as falhas silenciosas
- Eliminar todo `catch { return [] }` / `catch` que engole erro. Alvo conhecido:
  `deviceService.obterLogsCatraca` — hoje **falha de rede é indistinguível de "nenhum log novo"**.
- Toda falha de dispositivo: registrada, contabilizada por categoria, e **exposta na API de status**.
- Distinguir explicitamente, no retorno de toda operação de dispositivo: `sucesso` ·
  `falha_transitória` (vai reter) · `falha_permanente` (precisa de humano).
- **Teste:** simulador em modo `offline` durante a sync → o sistema reporta erro, não sucesso vazio.

## E2 — Jobs catch-up (o PC é desligado)
- Substituir "dispara no horário" por "o que deveria ter rodado e não rodou?", avaliado no boot e
  periodicamente.
- Tabela de execuções: `job_execution (nome, competencia, executado_em, resultado)`.
- Alvo prioritário: **promoção anual de alunos** — hoje depende de o PC estar ligado às 08:10 de um
  dia específico. Desligado = alunos não promovidos naquele ano, em silêncio.
- **Teste:** relógio falso avança um ano com o processo parado → ao subir, promove exatamente uma vez.

## E3 — Durabilidade e recuperação
- Nada crítico só em memória. Fila de sync migra de `globalState` para tabela (prepara o outbox da Fase 5).
- Serviço Windows com auto-restart e start no boot; health check e watchdog.
- MySQL com `innodb_flush_log_at_trx_commit=1`.
- **Teste:** matar o processo no meio da sync → subir → converge sem perda e sem duplicata.

## E4 — Backup verificado
- Backup local diário, com rotação e retenção.
- **Restauração automática de verificação** contra a cópia, periódica, falhando ruidosamente.
  *Backup não verificado não é backup.*
- Expor no status: último backup e última restauração verificada.

## E5 — Trava em operação destrutiva
- `zerarAccessLogsCatraca` **não pode** apagar log não sincronizado. Verificação obrigatória +
  confirmação explícita + registro em auditoria.
- Exclusão em massa exige confirmação e é auditada.

## E6 — Página de status legível por leigo
Em português de secretaria, não de TI:
> "Catraca da entrada: sem comunicação desde 14:32. Os acessos continuam sendo registrados no
> equipamento e serão importados quando ela voltar."

Conteúdo: catracas e latência · fila e item mais antigo · **folga do buffer da catraca em dias**
(RNF-3) · último backup · versão · erros recentes agrupados.
Ações seguras que a própria escola executa: sincronizar agora, testar catraca, reiniciar serviço,
**gerar diagnóstico**.

## E7 — Observabilidade remota
- **Logging estruturado** com `correlation_id` por requisição e por ciclo de sync, propagado ao worker.
- **Rastreamento de erros** com buffer local em disco quando offline, agrupamento por assinatura,
  breadcrumbs.
- **Telemetria** outbound HTTPS best-effort a cada 15 min (nunca bloqueia nada): versão, uptime,
  catracas, fila, folga de buffer, backup, contadores de erro, latência p50/p95.
- **Bundle de diagnóstico** de um clique, funcionando **sem internet** — logs sanitizados, versões,
  config sem segredos, estado das filas, auto-diagnóstico (conectividade, integridade do banco,
  espaço em disco, buffer pool, Defender varrendo o data dir).

### 🔴 Sanitização LGPD — requisito, não boa prática
Nenhum dado que sai da escola pode conter nome, CPF, RG, e-mail, telefone, foto, RA/RM ou endereço.
Permitido: IDs internos, códigos de erro, stack traces, contadores, tempos.
**Teste automatizado obrigatório que falha se um campo pessoal aparecer no payload de telemetria.**
Sem esse teste, a regra é decorativa.

---

## Definition of Done
- [ ] Nenhum `catch` que engole erro no caminho de dispositivo
- [ ] Todo job é catch-up, com tabela de execuções
- [ ] Processo morto no meio da sync → converge ao subir, sem perda nem duplicata
- [ ] Backup diário com restauração verificada automaticamente
- [ ] `zerarAccessLogs` com trava e auditoria
- [ ] Página de status compreensível por não-técnico
- [ ] Telemetria + erros + bundle funcionando, **com o teste de sanitização passando**
- [ ] Testes da Fase 1 continuam verdes

## Riscos
- **Telemetria vaza dado pessoal por descuido**: um `logger.error(pessoa)` basta. O sanitizador
  precisa ser a única saída possível.
- **Coletor de erros self-hosted é mais um sistema para manter.** Com equipe pequena, SaaS pode ser
  a escolha certa — mas aí a sanitização precisa ser ainda mais rigorosa e formalizada com a escola.
- **Jobs catch-up podem disparar em rajada** após longo desligamento (férias). Precisam de trava de
  concorrência e de limite de "quantas competências atrasadas processar de uma vez".
- **Custo recorrente** de coletor e endpoint de telemetria: pequeno, mas existe e entra na conta.
