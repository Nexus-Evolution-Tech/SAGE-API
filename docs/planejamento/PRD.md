# PRD — SAGE (Sistema de Automação e Gerenciamento Escolar)

> Documento de produto. Complementa `ARQUITETURA-PROPOSTA.md` (decisões técnicas) e
> `ROADMAP.md` (sequência de execução).
> **Natureza do trabalho: refatoração de sistema existente (~22.000 LOC), não construção nova.**

---

## 1. Problema

Existe um sistema de controle de acesso escolar por catraca, funcional, construído para a ETEC de
Taboão da Serra. **Ele nunca entrou em produção — não por falta de funcionalidade, mas por falta de
confiabilidade.** A escola não pode arriscar depender de um sistema que falha em silêncio, sincroniza
devagar e cujo estado real é desconhecido.

O objetivo deste trabalho não é adicionar features. É **transformar um sistema que funciona numa
demonstração em um sistema em que uma escola pública aposta a operação diária, por anos.**

## 2. Objetivo do produto

Um software instalável em Windows 11 que a escola baixa de um site, instala, e usa para controlar e
monitorar o acesso de alunos, professores e funcionários via catracas Control iD — com
confiabilidade suficiente para operar sem suporte no dia a dia, e manutenível o bastante para
crescer para outras ETECs ao longo dos anos.

## 3. Usuários

| Perfil | Uso principal | Implicação de produto |
|---|---|---|
| **Secretaria / Administrativo** | Cadastrar pessoas, emitir credenciais, consultar frequência, monitorar acessos | Não é TI. Mensagens em português claro, sem jargão. Estado do sistema legível sem treinamento |
| **Direção / Coordenação** | Relatórios de frequência, atraso, presença | Confiabilidade do número é o produto. Relatório contestável = produto inútil |
| **Portaria / Inspetoria** | Monitorar acessos em tempo real | Latência é a feature. Delay torna o monitoramento pior que inexistente |
| **Nós (fornecedor)** | Instalar, atualizar, diagnosticar remotamente | Com N escolas, sem gestão de frota o suporte inviabiliza o negócio |
| **Aluno / Professor** | Passar na catraca | Nunca deve ser barrado por falha do servidor |

## 4. Requisitos não-funcionais — são o produto

Estes vêm antes dos funcionais, deliberadamente. É a inversão que este projeto exige.

### RNF-1 — Disponibilidade local permanente
O sistema funciona sem internet, para sempre. Nuvem futura é camada adicional, nunca requisito.
**Perda de internet não pode afetar catraca nem painel.**

### RNF-2 — A catraca nunca para
Queda do servidor não fecha a porta. O controle de acesso físico é autônomo no equipamento
(modo híbrido, já adotado). O servidor é responsável por cadastro, monitoramento e relatório.

### RNF-3 — Zero perda de log de acesso
O buffer da catraca (~48k registros observados) é a garantia de durabilidade. Requisito:
ressincronizar antes de o buffer dar a volta, e **alertar quando a folga cair abaixo de 7 dias**.
Nenhuma operação pode apagar log não sincronizado.

### RNF-4 — Nenhuma falha silenciosa
Toda falha é registrada, contabilizada e **visível na interface**. Falha de rede jamais pode ser
indistinguível de "nada novo". O sistema sempre sabe e mostra seu estado real.

### RNF-5 — Monitoramento em tempo real
Acesso novo visível em **< 1s** (push) ou **< 5s** (degradado, polling).
*Monitorar com delay é pior que não monitorar.*

### RNF-6 — O recente nunca espera pelo histórico
Sincronização em massa pode levar segundos a mais, mas **não pode atrasar os dados recentes**.
Durante backfill, latência ao vivo degrada no máximo 20%.

### RNF-7 — Opera em hardware modesto
Alvo real: desktop, **HD mecânico 7200 rpm 500 GB, 8 GB de RAM**, Windows 11, com o navegador
aberto. Nada assume máquina potente. Sem gargalo, sem desperdício de memória, sem I/O aleatório
desnecessário.

### RNF-8 — Sobrevive a desligamento abrupto
O PC da escola é desligado, inclusive no meio de operações. Nada crítico vive só em memória.
Trabalho agendado é *catch-up* ("o que deveria ter rodado?"), nunca "dispara na hora".

### RNF-9 — Manutenível por anos, por equipe pequena
Tipos estáticos, testes automatizados, fronteiras de módulo explícitas, migrations versionadas.
Rotatividade de pessoas não pode significar perda de conhecimento — em especial o conhecimento
empírico da Control iD, que deve viver em teste, não em folclore.

### RNF-10 — Gerenciável em escala de frota
N escolas, sem acesso físico às máquinas: atualização com rollback automático, backup verificado
por restauração, bundle de diagnóstico de um clique, telemetria de versão e saúde.

### RNF-12 — Manutenível remotamente
O sistema roda numa escola onde não convivemos. O que chega é feedback humano e log. Requer:
telemetria outbound best-effort, rastreamento de erros com `correlation_id`, **bundle de
diagnóstico de um clique que funciona sem internet**, e capacidade de transformar incidente de
produção em teste local que falha. Acesso remoto permanente é proibido; "modo suporte" é ativado
pela escola, expira sozinho e é auditado. Detalhe em `MANUTENCAO-REMOTA.md`.
**Sequenciamento: entra na Fase 2, não na 8** — se a primeira instalação em produção acontecer sem
observabilidade, perdemos os dados do período que mais importa.

### RNF-11 — Conformidade com LGPD
Dados pessoais de menores. Requer: identidade por usuário, auditoria append-only de quem fez o quê,
isolamento entre escolas, retenção definida, criptografia de segredo em repouso.

## 5. Requisitos funcionais

Quase todos **já existem** no código atual. A tabela marca o que muda.

| ID | Requisito | Situação |
|---|---|---|
| RF-1 | Cadastro de pessoas (aluno, professor, admin, terceirizado, responsável) com foto | Existe |
| RF-2 | Credenciais físicas: RFID e QR Code, geração e vínculo | Existe |
| RF-3 | Estrutura acadêmica: cursos, turmas, matérias, aulas, horários, salas, áreas | Existe |
| RF-4 | Cadastro e status de dispositivos (catracas), descoberta na rede | Existe |
| RF-5 | Sincronização de pessoas/credenciais para as catracas | Existe — **rearquitetar** (outbox + reconciler) |
| RF-6 | Ingestão de logs de acesso das catracas | Existe — **rearquitetar** (idempotência + lotes) |
| RF-7 | Monitoramento de acessos em tempo real | Existe — **rearquitetar** (push primário) |
| RF-8 | Presença, atraso e ausência | Existe — **revalidar regra** (bloqueado, ver §7) |
| RF-9 | Relatórios de acesso e frequência, histórico por pessoa | Existe |
| RF-10 | Importação/exportação por planilha XLSX | Existe |
| RF-11 | Promoção automática de alunos na virada do ano | Existe em duplicidade — **remover a versão perigosa** |
| RF-12 | Autenticação e recuperação de senha | Existe (por escola) — **substituir por identidade de usuário** |
| RF-13 | Solicitação de acesso e aprovação | Existe |
| RF-14 | **Usuários, papéis e permissões (RBAC)** | **Não existe — criar** |
| RF-15 | **Auditoria append-only** | **Não existe — criar** |
| RF-16 | **Calendário escolar** (dia letivo, feriado, recesso) | **Não existe — criar.** Sem ele, relatório de falta é contestável |
| RF-17 | **Página de status do sistema legível por leigo** | **Não existe — criar** |
| RF-18 | **Backup automático com restauração verificada** | **Não existe — criar** |
| RF-19 | **Instalador Windows + serviço + auto-update** | **Não existe — criar** |
| RF-20 | **Site com download do instalador** | **Não existe — criar** |

## 6. Fora de escopo (explicitamente)

App mobile · biometria facial · reconhecimento de placa · BI executivo · integração com o sistema
acadêmico do CPS (NSA/SIGA) · catraca de outro fabricante *implementada* (a arquitetura deixa a
porta aberta via `DeviceGateway`, mas nenhum adapter novo será escrito) · nuvem multi-tenant
(preparada, não construída).

> ⚠️ Se **integração com NSA/SIGA** entrar no acordo, ela redefine quem é a fonte da verdade sobre
> alunos e turmas, e invalida parte substancial do desenho atual. Precisa ser decidido antes da Fase 4.

## 7. Dependências bloqueantes

| # | Bloqueio | Bloqueia | Responsável |
|---|---|---|---|
| B-1 | **Regra correta de presença, atraso e promoção de turma** | Testes da Fase 1 (sem isso, os testes congelam o comportamento atual, incluindo erros) | Cliente/Caio |
| B-2 | **Acesso a uma catraca IDBlock real** (ou captura de sessão completa) | Verificação do filtro `where` e do suporte a Monitor push; fidelidade do simulador | Cliente/Caio |
| B-3 | Decisão de retenção de dados de acesso | Particionamento/arquivamento (Fase 6+) | Cliente |
| B-4 | Definição de "sync aceitável" em números | Critério de saída da Fase 2b — proposta em RNF-5/6 | Cliente |

**B-1 e B-2 não bloqueiam as Fases 0, 1 (infra) e 2.** Bloqueiam a Fase 1 (testes de domínio) e a
validação final da Fase 2b.

## 8. Critérios de sucesso do projeto

1. O sistema entra em produção numa escola e opera **um trimestre letivo sem intervenção nossa**.
2. Nenhum log de acesso perdido nesse período, comprovável por reconciliação com a catraca.
3. Monitoramento com latência dentro de RNF-5, medida em produção.
4. Instalação limpa em Windows 11 por alguém que não é da equipe, seguindo só o guia.
5. Cobertura de teste automatizada sobre o núcleo (sync, ingestão, presença, promoção), com o
   catálogo de comportamento da Control iD (§5 da arquitetura) inteiro em teste.
6. Uma segunda escola instalada **sem trabalho de engenharia**, apenas instalação e configuração.
