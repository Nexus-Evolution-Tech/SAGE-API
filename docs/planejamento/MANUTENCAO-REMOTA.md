# Manutenção remota — como consertar um sistema que você não vê

> Restrição: o sistema roda numa escola onde não convivemos. O que chega é **feedback humano e
> logs**. Precisamos corrigir com precisão e facilidade, sem estar lá.

---

## 0. A consequência de sequenciamento — leia antes do resto

**Observabilidade não pode ficar na Fase 8 (frota/instalador). Ela precisa estar pronta no dia da
primeira instalação em produção.**

Se a escola começa a usar e nós estamos cegos, perdemos exatamente os dados do período que mais
importa: o das primeiras falhas reais. Depois não dá para voltar no tempo.

Por isso, o núcleo deste documento (§1 a §4) **entra na Fase 2**, junto com "nenhuma falha
silenciosa" — porque são a mesma preocupação vista de dentro e de fora:

> RNF-4 (o sistema sempre sabe seu estado) visto de fora é **manutenção remota**.

O que fica na Fase 8 é só a parte de distribuição: auto-update, rollback, canário.

---

## 1. Princípio: a arquitetura já reduz a necessidade de manutenção

Antes de ferramenta, desenho. Três decisões já tomadas diminuem a quantidade de coisas que exigem
nossa intervenção remota:

| Decisão | Efeito na manutenção |
|---|---|
| **Reconciler** (Fase 5) | Divergência com a catraca se conserta sozinha. A classe de chamado "sumiu o cadastro da catraca" deixa de existir |
| **Outbox durável** | Trabalho perdido em queda é retomado ao ligar, sem alguém pedir |
| **Jobs catch-up** | PC desligado deixa de gerar "não promoveu os alunos" |
| **Idempotência** | Reprocessar é sempre seguro — o conserto padrão passa a ser "manda sincronizar de novo", que a própria secretaria faz |

**Isto é o mais importante deste documento.** Ferramenta de diagnóstico ajuda a entender problema;
arquitetura auto-curável faz o problema não virar chamado. Priorizar a segunda.

---

## 2. Camada 1 — Telemetria (saber que há problema antes do cliente ligar)

Heartbeat periódico, **outbound HTTPS apenas**, best-effort: se não tem internet, enfileira e manda
depois. Nunca bloqueia nada.

**Conteúdo (sem dado pessoal):**
- versão do SAGE, do Node, do MySQL, do Windows
- uptime, quantidade de reinícios recentes
- catracas: quantas, online/offline, latência média
- fila: comandos pendentes, dead-letter, idade do item mais antigo
- **folga do buffer da catraca em dias** (RNF-3 — o alerta mais importante)
- último backup bem-sucedido e última restauração verificada
- contadores de erro por categoria
- métricas de latência de sync (p50/p95)

**Frequência:** a cada 15 min, com backoff. Payload de poucos KB.

**Valor real:** você descobre que a catraca 02 está offline há 3 dias **antes** de a escola
perceber que faltam registros de frequência.

## 3. Camada 2 — Rastreamento de erros

Erro não tratado, falha de dispositivo e exceção de job vão para um coletor (Sentry ou GlitchTip
self-hosted — o segundo evita mandar dado de escola pública para SaaS de terceiro).

Requisitos:
- **Buffer local em disco** quando offline; envia quando voltar.
- **Agrupamento** por assinatura, para 400 ocorrências do mesmo erro virarem 1 item com contador.
- **Breadcrumbs** dos últimos N eventos antes da falha.
- **`correlation_id`** por requisição e por ciclo de sincronização, propagado do front ao worker.
  Sem isso, correlacionar "a secretária diz que travou às 10h20" com o log é adivinhação.

### 🔴 Regra inegociável de LGPD
São dados de menores. **Nenhum log que sai da escola pode conter dado pessoal.**

- Proibido em log remoto: nome, CPF, RG, e-mail, telefone, foto, RA/RM, endereço.
- Permitido: IDs internos, tipo de entidade, código de erro, stack trace, contadores, tempos.
- **Sanitizador obrigatório na saída**, com lista de campos bloqueados — e **teste automatizado que
  falha se um campo pessoal aparecer no payload de telemetria.** Sem esse teste, a regra é decorativa.
- Log local completo (com dado pessoal) pode existir na máquina da escola, com rotação e prazo
  curto — mas **nunca é enviado automaticamente**.

## 4. Camada 3 — Bundle de diagnóstico (o cavalo de batalha)

Botão na tela de status: **"Gerar diagnóstico"**. Produz um `.zip` que a secretaria envia por
e-mail ou WhatsApp. Funciona **sem internet** — é o caminho que sempre funciona.

Conteúdo:
- logs da aplicação do período (com sanitização aplicada, ou com aviso explícito se o usuário optar
  por incluir dados para investigação de caso específico)
- versões, config efetiva **sem segredos**
- estado das filas, dos dispositivos, das últimas sincronizações
- resultado de auto-diagnóstico: conectividade com cada catraca, integridade do banco, espaço em
  disco, tamanho do buffer pool, se o Defender está varrendo o diretório de dados
- últimos N erros agrupados

**Meta:** que o bundle responda 80% dos chamados sem uma segunda pergunta. Cada vez que precisarmos
pedir informação adicional, isso é um bug do bundle — e vira item de melhoria dele.

## 5. Camada 4 — Reprodução local: o que realmente conserta bug

Este é o diferencial que o simulador (Fase 1) viabiliza.

**Objetivo: transformar incidente de produção em teste local que falha.**

Com o simulador de catraca + o log de eventos + o bundle de diagnóstico, um chamado como
*"o acesso do aluno X não apareceu dia 12"* vira:

1. Do bundle: os logs da catraca daquele período e o estado das filas.
2. Alimenta o simulador com aquele dataset e aquele modo de falha.
3. Escreve o teste que reproduz. **Ele falha.**
4. Corrige. **Ele passa.**
5. O teste fica na suíte para sempre — aquele bug não volta.

Sem isso, conserto remoto é palpite com deploy em cima. **É a razão pela qual a Fase 1 vem antes de
tudo**, e o argumento mais forte para justificá-la ao cliente: ela é o que torna manutenção remota
possível.

## 6. Camada 5 — Intervenção remota, quando é inevitável

Ordem de preferência — sempre a menos invasiva que resolve:

| Nível | Mecanismo | Quando |
|---|---|---|
| 1 | **A própria secretaria resolve** pela página de status: "Sincronizar agora", "Testar catraca", "Reiniciar serviço" | Maioria dos casos. Ações seguras, idempotentes, auditadas |
| 2 | **Feature flag / kill switch remoto** — desligar um subsistema problemático (ex.: push, promoção automática) sem deploy | Contenção imediata de dano enquanto se prepara correção |
| 3 | **Atualização dirigida** — publicar correção para *aquela* escola, com rollback automático | Correção de bug |
| 4 | **Modo suporte** — túnel de acesso **ativado pela escola**, com prazo de expiração e auditoria | Último recurso |

### 🔴 Sobre acesso remoto permanente: não
Backdoor sempre ligada numa máquina com dados pessoais de menores é passivo de segurança e
jurídico. O "modo suporte" precisa ser: **ativado por alguém da escola**, **expirar sozinho** (ex.:
2 horas), **registrar em auditoria tudo que foi feito**, e **avisar na tela que está ativo**.

Se optarem por ferramenta pronta (AnyDesk, TeamViewer), a mesma regra vale — e ela fica desligada
por padrão, não instalada como serviço permanente.

## 7. Camada 6 — Distribuição de correção (Fase 8)

- **Canário obrigatório**: nunca atualizar todas as escolas ao mesmo tempo. Uma primeiro, observar
  a telemetria por alguns dias, depois o resto. Com 1 escola isso é trivial; com 10, é o que evita
  derrubar a rede inteira com um bug.
- **Rollback automático** se o health check pós-update falhar.
- **Migrations reversíveis ou aditivas.** Nunca destrutivas num update automático — é o tipo de erro
  que não tem volta remotamente.
- **Janela de atualização fora do horário letivo**, respeitando que o PC pode estar desligado
  (mesma lógica catch-up dos jobs).
- **Versão visível na UI**, para a secretaria saber informar sem procurar.

## 8. Camada 7 — O canal humano

O feedback vem de gente que não é técnica. Precisa ser projetado, não improvisado:

- **Página de status em português de secretaria**: "Catraca da entrada: sem comunicação desde
  14:32. Os acessos continuam sendo registrados no equipamento e serão importados quando voltar."
  Isso previne o chamado e ensina o usuário.
- **Formulário de reporte dentro do sistema**, que anexa o bundle automaticamente — em vez de
  depender de o usuário descrever o problema com precisão.
- **Registro de chamados** com versão, data, sintoma e causa raiz. Chamado repetido é sinal de
  falha de arquitetura, não de usuário.

---

## Métricas de saúde da operação remota

| Métrica | Meta |
|---|---|
| Incidentes detectados por telemetria **antes** do cliente reportar | > 70% |
| Chamados resolvidos só com o bundle, sem informação adicional | > 80% |
| Bugs de produção que viraram teste automatizado | **100%** |
| Necessidade de "modo suporte" | < 1 por trimestre por escola |
| Falha de update com rollback acionado | Zero em produção após canário |

---

## Onde isto pode dar errado

- **Telemetria e LGPD são fáceis de errar por descuido.** Um `logger.error` com o objeto `pessoa`
  inteiro vaza nome e CPF para fora da escola. O sanitizador precisa ser a única saída possível, e
  o teste que o valida é obrigatório — não "boa prática".
- **A escola pode não ter internet estável nem para telemetria.** Tudo aqui é best-effort e nada
  pode bloquear a operação. Se a telemetria não chegar, o bundle manual (§4) é o caminho que sempre
  funciona — por isso ele não é plano B, é o alicerce.
- **Coletor de erro self-hosted é mais um sistema para nós mantermos.** Se a equipe é pequena, um
  SaaS pode ser a escolha certa apesar do dado sair — mas aí a sanitização precisa ser ainda mais
  rigorosa, e vale registrar isso formalmente com a escola.
- **Canário exige mais de uma escola para fazer sentido.** Com uma só, a primeira instalação *é* o
  canário, e o rollback é a única rede.
- **"Modo suporte" com prazo pode expirar no meio de uma investigação** e irritar quem está
  ajudando. Prever renovação explícita em vez de prazo rígido demais.
- **Não considerei o custo recorrente** de coletor de erros e endpoint de telemetria. É pequeno,
  mas existe e precisa entrar na conta do produto.
