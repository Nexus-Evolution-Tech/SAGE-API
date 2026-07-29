# Spec — Fase 8 antecipada: instalador Windows alfa de campo

**Tier:** T2 — toca autenticação, banco, serviço do sistema, firewall e distribuição.
**Estado:** proposta para revisão humana antes da implementação.
**Alvo:** Windows 11 x64, 8 GB RAM, HD mecânico, operação local sem internet.

## 1. Por que antecipar

O instalador será o veículo para colocar o SAGE na primeira escola, observar o comportamento da
IDBlock real, gerar diagnóstico e distribuir correções. Não é apenas um exercício de empacotamento.

A primeira instalação será uma **homologação de campo**. Ela pode monitorar e operar o painel, mas
não deve ser anunciada como release estável até fechar os gates de hardware, atualização e
segurança desta spec.

## 2. Resultado esperado

Um único `SAGE-Setup-<versao>-x64.exe`:

1. funciona offline depois do download;
2. instala painel, API, Node e uma instância privada do MySQL;
3. inicia automaticamente com o Windows e reinicia após falha;
4. abre o painel local sem exigir Git, npm, Docker ou conhecimento técnico;
5. preserva banco, uploads, logs e backups em reinstalação/upgrade;
6. gera diagnóstico sanitizado para suporte;
7. conhece sua versão e deixa o layout pronto para update com rollback;
8. desinstala código e serviços sem apagar dados escolares por padrão.

## 3. Decisões de arquitetura

### 3.1 Componentes fixados

| Componente | Escolha inicial | Razão |
|---|---|---|
| Instalador | Inno Setup 6.7.3 | EXE único, UAC, uninstall, modo silencioso e assinatura |
| Serviço da API | WinSW 2.12.0 x64 | Última versão estável; WinSW 3 ainda não é estável |
| Runtime | Node 24 LTS x64 ZIP | Node 20 está EOL; Node 24 tem janela de suporte maior que 22 |
| Banco | MySQL 8.4.11 LTS x64 ZIP | Instância controlada pelo SAGE, sem depender do MySQL global |

Versão e SHA-256 de todo binário entram num manifesto versionado. O build falha se qualquer hash
divergir. `node_modules` é produzido e testado num runner Windows x64 por causa do `bcrypt` nativo.

### 3.2 Layout

```text
C:\Program Files\SAGE\
  runtime\node\
  runtime\mysql\
  service\
  releases\<versao>\api\
  releases\<versao>\web\

C:\ProgramData\SAGE\
  config\
  current.json
  mysql\data\
  logs\
  backups\
  uploads\
  exports\
```

Código e runtimes são imutáveis. Todo estado gravável fica em `ProgramData`, com ACL limitada à
conta dos serviços e administradores.

`current.json` aponta a versão ativa. Uma atualização instala a nova versão ao lado, executa
migrations, inicia, valida readiness e só então troca o marcador. Se falhar, mantém a versão
anterior e registra a causa.

### 3.3 Um processo web

A API serve o build React pelo mesmo host e porta. Isso elimina nginx, segundo serviço e CORS entre
frontend e backend. O frontend usa URLs same-origin e não contém `localhost:3000` hardcoded.

### 3.4 Serviços

- `SAGE-MySQL`: MySQL privado na porta 3307, bind apenas em `127.0.0.1`, sem regra de firewall.
- `SAGE-API`: WinSW executa o Node empacotado por caminho absoluto, depende do MySQL, possui
  restart com backoff e logs rotativos.
- A dependência de serviço não basta: a API faz retry limitado até o banco estar realmente pronto.

### 3.5 Rede

A porta HTTP do SAGE recebe regra de entrada apenas no perfil Private/Domain e inicialmente para a
sub-rede local. Quando os IPs reais das catracas forem conhecidos, a regra passa a aceitar somente
esses IPs. O MySQL nunca é exposto à LAN.

**Reversão da arquitetura anterior:** o instalador não cria exclusão automática no Defender. A
Microsoft alerta que exclusões reduzem a proteção. Só será criada uma exceção mínima se medição no
hardware provar impacto material e o administrador optar por ela conscientemente.

### 3.6 Segredos

O instalador gera com CSPRNG:

- senha do usuário MySQL do SAGE;
- `JWT_SECRET`;
- `MONITOR_CALLBACK_TOKEN`;
- credencial administrativa inicial de uso único.

Nenhum segredo vai para código, argumento de processo ou log. O arquivo de configuração recebe ACL
restrita. O setup nunca cria nem redefine `etec/etec123`.

DPAPI/Credential Manager é a direção final; ACL em arquivo é aceitável apenas para o alfa se a
revisão de segurança documentar o risco residual.

### 3.7 Banco e update

- O processo normal não usa `root`.
- Migrations possuem versão, ordem, checksum e estado (`in_progress`, `applied`, `failed`) em
  `schema_migrations`.
- O runner grava `in_progress` antes do SQL, `applied` somente depois da conclusão e `failed` quando
  captura erro. Encontrar `in_progress` ou `failed` na partida interrompe o update e exige
  intervenção; DDL parcialmente aplicado não é reexecutado às cegas.
- Antes de registrar `failed`, o runner tenta `ROLLBACK`; migration que retorna deixando transação
  aberta é rejeitada e desfeita.
- Migration roda antes de ativar o release.
- Falha de migration impede a troca de versão.
- Migration de produção é para frente; rollback volta o código, não desfaz dados destrutivamente.
- A credencial privilegiada de instalação/backup não é a mesma credencial do runtime.
- Backup verificado e sua associação ao update pertencem ao fluxo F8.6; instalação limpa não exige
  backup de um banco ainda inexistente.

### 3.8 Readiness e diagnóstico

`/health` atual não serve como gate porque não consulta o banco. O instalador/updater precisa de um
readiness que prove:

- banco acessível;
- versão de schema compatível;
- rotas essenciais carregadas;
- diretórios graváveis disponíveis.

Logs persistentes têm rotação e limite. O bundle de diagnóstico inclui versões, estado dos
serviços, readiness e logs sanitizados, sem credenciais nem dados pessoais.

## 4. Bloqueios antes do primeiro EXE utilizável

1. Remover o seed/reset conhecido `etec/etec123` e exigir credencial gerada.
2. Fazer falha do seed/setup propagar exit diferente de zero.
3. Provar backend inteiro em Node 24 + MySQL 8.4 no CI.
4. Corrigir frontend para same-origin e remover URLs hardcoded.
5. Separar caminhos graváveis de `Program Files`.
6. Criar readiness real.
7. Servir o build React pela API.
8. Definir licença para redistribuir MySQL Community antes da landing page pública.
9. Obter certificado Authenticode antes de chamar o artefato de release público.

## 5. Fatias de implementação

Cada item abaixo é um PR de comportamento independente, com alvo de até 300 linhas de diff.

### PR F8.0 — runtime suportado

- CI Node 24 + MySQL 8.4;
- suíte completa, setup bom e setup quebrado;
- sem alteração de comportamento do produto.

### PR F8.0b — dependências de produção

- atualizar dependências com correção disponível e repetir a suíte completa;
- substituir ou isolar `xlsx`, que processa upload hostil e não possui correção no npm atual;
- `npm audit --omit=dev` sem vulnerabilidade alta aceita silenciosamente.

### PR F8.1 — bootstrap seguro

- credencial inicial obrigatória e gerada;
- setup nunca redefine credencial existente;
- falha de seed encerra com erro;
- testes em banco limpo e em upgrade.

### PR F8.2 — contrato de diretórios

- `SAGE_DATA_DIR` como raiz de logs, uploads, exports e backups;
- caminhos absolutos independentes do `cwd`;
- teste com código somente leitura e caminho contendo espaços/acentos.

### PR F8.3a — frontend same-origin (`SAGE`)

- remover URLs fixas;
- build configurado para API e Socket.IO same-origin.

### PR F8.3b — frontend servido pela API (`SAGE-API`)

- API serve o build React;
- smoke de SPA, API e Socket.IO no mesmo processo;
- ausência do artefato web faz o readiness falhar no pacote de produção.

### PR F8.4 — release Windows reproduzível

- manifesto de versões/hashes;
- build Windows monta Node, MySQL, WinSW, API e frontend;
- máquina de destino não executa `npm install`.

### PR F8.5 — serviços e provisionamento

- PowerShell idempotente para MySQL, config, ACL, WinSW e firewall;
- Inno Setup chama o bootstrap e falha alto;
- uninstall preserva `ProgramData`.

### PR F8.6 — update e rollback

- releases lado a lado e `current.json`;
- migration antes da ativação;
- readiness pós-update;
- rollback automático do código.

### PR F8.7 — prova em Windows 11

- CI Windows x64 para build/smoke;
- VM limpa no VMware Fusion;
- instalação, reboot, kill/restart, upgrade quebrado, rollback e uninstall;
- operador sem conhecimento técnico abre e usa o painel.

## 6. Gates

O instalador alfa só vai à escola quando:

- backend: suíte completa sem skips em Node 24 + MySQL 8.4;
- frontend: build e lint limpos;
- instalação limpa e offline passa em Windows 11 x64;
- serviços sobrevivem a reboot e reiniciam após kill;
- upgrade preserva dados e rollback é provado;
- uninstall preserva dados por padrão;
- nenhum segredo aparece em logs, linha de comando ou artefato;
- firewall não expõe MySQL;
- diagnóstico não contém dados pessoais;
- vulnerabilidades de produção estão corrigidas ou têm exceção explícita, mitigada e revisada;
- diff de cada PR permanece pequeno e revisável.

Desempenho em HD mecânico e callback da IDBlock continuam sendo gates no hardware real.

## 7. O que vem depois do instalador

1. Concluir assinatura, canal de release e update/rollback do alfa.
2. Instalar o alfa na escola em modo de homologação e capturar o payload real da IDBlock.
3. Fechar B-2: existência de `values.id`, monotonicidade e reinício de `log.id`.
4. Medir linha de base e decidir PR #4 da Fase 2b com dados reais.
5. Construir a landing page consumindo o manifesto de releases; ela só oferece artefato assinado,
   checksum e notas da versão.
6. Promover para estável somente após update/rollback e uma instalação feita por pessoa externa.

A landing page pode ser desenhada em paralelo, mas o botão de download não deve publicar um EXE
sem assinatura, manifesto e gate Windows.

## 8. Onde isto pode dar errado

- Redistribuir MySQL Community pode exigir conformidade GPL ou licença OEM; precisa de validação
  jurídica antes da distribuição pública.
- WinSW 2.12 é estável, porém antigo e sem digest upstream forte do asset.
- ACL de `.env` não equivale a criptografia em repouso.
- Migrations para frente limitam o rollback: código antigo precisa tolerar o schema novo.
- IP por DHCP pode quebrar o callback; a instalação precisa orientar reserva de endereço.
- Windows ARM não serve como prova do alvo x64. O Mac disponível é Intel e permite VM x64.
- Sem Authenticode, SmartScreen pode bloquear ou assustar o operador.
- A VM não prova desempenho no HD real nem as peculiaridades da IDBlock.
