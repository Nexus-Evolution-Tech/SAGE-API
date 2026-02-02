# Segurança e compatibilidade: catracas e monitoramento

Este documento descreve a compatibilidade do SAGE com catracas antigas (apenas QR, RFID e senha) e as práticas de segurança adotadas nos fluxos de backup, zeragem e sincronização.

---

## 1. Compatibilidade com catracas antigas (QR, RFID, senha)

O SAGE foi pensado para catracas Control iD que suportam **usuário + cartão (RFID) + QR Code (ou valor numérico como cartão)**, sem depender de módulos opcionais (facial, biometria).

### O que o sistema envia à catraca

- **Usuário** (`users`): nome e registration (obrigatório na API).
- **Cartão RFID**: objeto `cards` com `value` gerado a partir do número do cartão (quando a pessoa tem `cartao_rfid`).
- **QR Code**: no código atual o QR é enviado como **cartão** (`cards`) com valor numérico de 8 dígitos, compatível com modelos que não têm o objeto `qrcodes` (ex.: V2). Modelos mais novos podem usar o objeto `qrcodes`; no SAGE usamos cartão para máxima compatibilidade.
- **Grupo** (`user_groups`): vínculo ao grupo padrão para liberar acesso.
- **Imagem/facial**: envio de foto do usuário para a catraca **só é tentado na edição** e pode ser desligado em catracas sem módulo facial.

### Catracas sem módulo facial

Se a catraca **não tem reconhecimento facial** (só QR, RFID e eventualmente senha):

1. **Não é necessário configurar nada extra**  
   O sistema já trata falha no envio de imagem com try/catch e não quebra a edição.

2. **Evitar tentativa de envio de imagem (recomendado)**  
   No `.env` da API:

   ```env
   CATRACA_SKIP_USER_IMAGE=true
   ```

   Com isso, o SAGE **não tenta** enviar foto na edição de pessoa, evitando requisições desnecessárias e possíveis erros em equipamentos antigos.

### Resumo

- O sistema **não envia** biometria, templates ou outros módulos que sua catraca não tenha.
- Só usuário, cartão(s) e grupo são obrigatórios; imagem é opcional e pode ser desligada com `CATRACA_SKIP_USER_IMAGE=true`.

---

## 2. Segurança nos fluxos de backup, zeragem e monitoramento

### 2.1 Autenticação

- **Todas** as rotas de dispositivos (status, logs-info, backup-logs, zerar-logs, configurar-monitor, diagnostico-acessos) usam o middleware **autenticar** (JWT).
- Sem token válido o backend responde 401/403 e não executa a ação.

### 2.2 Validação de entrada

- **ID do dispositivo** (`:id` nas rotas): é validado como **inteiro positivo** antes de qualquer uso em banco ou serviços. Valores inválidos (não numéricos, zero ou negativos) retornam **400** (ID inválido).
- **Zerar logs**: o body aceita apenas `apagarAcessosNoSistema` (booleano). Não há outros parâmetros livres que possam ser injetados em SQL ou em caminhos de arquivo.

### 2.3 Backup e caminho do arquivo

- O arquivo de backup é gerado **sempre** pelo backend, com nome fixo: `acessos_catraca_<id>_<timestamp>.jsonl`, em que `id` vem do banco (nunca do cliente).
- Antes de enviar o arquivo na resposta (**download**), o backend verifica se o caminho resolvido está **dentro** da pasta `backups/` e **não contém** `..`. Se não estiver, responde **403** (caminho inválido) e não envia o arquivo.
- Assim evitamos path traversal (acesso a arquivos fora de `backups/`).

### 2.4 Zeragem e backup na catraca

- **Zerar logs** sempre **gera backup antes** de apagar nada na catraca. Se o backup falhar, a zeragem é **cancelada** e o cliente recebe erro.
- Backup e zeragem usam apenas dados já validados (dispositivo existente no banco, sessão na catraca). Não há uso de dados brutos do cliente em comandos destrutivos.

### 2.5 Boas práticas recomendadas

1. **HTTPS em produção**  
   Use sempre HTTPS na API e no front para proteger token e dados em trânsito.

2. **Token JWT**  
   Mantenha tempo de expiração adequado e renovação (refresh) se aplicável. Não exponha o token em URLs (só em header `Authorization`).

3. **Firewall e rede**  
   - Exponha a API apenas em portas necessárias.  
   - Se a catraca acessa a API (ex.: Monitor), use regras de firewall que restrinjam origem (IP da catraca) quando possível.

4. **Rate limiting (recomendado)**  
   Para rotas sensíveis (ex.: `POST .../zerar-logs`, `POST .../backup-logs`), considere rate limiting (por IP ou por usuário) para evitar abuso. Isso pode ser feito com middleware (ex.: `express-rate-limit`) ou no proxy/reverso.

5. **Papel de administrador (futuro)**  
   Hoje qualquer usuário autenticado pode zerar logs e gerar backup. Se o sistema tiver papéis (admin, operador, etc.), recomenda-se restringir zeragem e backup a **administradores**.

6. **Logs e auditoria**  
   As operações de zeragem e backup são registradas em log (incluindo dispositivo e resultado). Manter logs e revisar acessos ajuda a detectar uso indevido.

7. **Pasta de backups**  
   A pasta `backups/` está no `.gitignore`. Garanta permissões de arquivo adequadas no servidor (apenas o processo da API deve escrever/ler nessa pasta).

---

## 3. Monitor da catraca (callback): abrindo porta com segurança

Quando você usa o **Modo 2 (Monitor push)**, a catraca envia POST para o seu servidor. Isso exige **abrir uma porta** para receber essas requisições. O sistema já implementa camadas de segurança para que isso seja feito com o mínimo de risco.

### 3.1 As três camadas (comunicação, autenticação, integridade)

| Camada | Objetivo | O que o SAGE faz / o que você configura |
|--------|----------|-----------------------------------------|
| **Comunicação (túnel)** | Dados não podem ser “escutados” na rede. | **HTTPS**: em produção, coloque a API atrás de um proxy reverso (nginx, Caddy) com HTTPS. A catraca será configurada com `https://seu-servidor:443` (ou a porta do HTTPS). Rede: recomenda-se **VLAN** separada para catracas (sub-rede diferente de Wi-Fi de visitantes e PCs de usuários). |
| **Autenticação (quem fala com quem)** | Servidor só aceita POST de origem confiável. | **Token**: configure `MONITOR_CALLBACK_TOKEN` no .env; o sistema grava na catraca a URL com `?token=CHAVE`. O servidor só processa o evento se o token bater. **Whitelist de IP**: configure `MONITOR_IP_WHITELIST` com os IPs das catracas (vírgula); o servidor rejeita 403 se o IP não estiver na lista. |
| **Integridade (a prova de replay/erros)** | Evitar que alguém reenvie um evento antigo ou injete dados inválidos. | **Timestamp**: eventos com `time` mais antigos que `MONITOR_MAX_EVENT_AGE_SECONDS` (padrão 300 s = 5 min) são descartados (proteção contra replay). **Sanitização**: todos os campos do payload são tipados (Number, String com limite de tamanho); inserts no banco usam sempre parâmetros (proteção contra SQL injection). |

### 3.2 Passo a passo para o técnico (Monitor com segurança)

Siga na ordem para não deixar a porta “aberta” de forma genérica.

1. **Rede e firewall (antes de abrir porta)**  
   - De preferência, coloque as catracas em uma **VLAN/sub-rede** separada (ex.: 192.168.10.0/24) e o servidor da API em outra (ex.: 192.168.1.0/24).  
   - No firewall do servidor (ou do roteador na frente dele), **liberar apenas** a porta da API (ex.: 3000 ou 443) **para os IPs das catracas** (ou da VLAN das catracas). Não liberar essa porta para “qualquer um” (0.0.0.0/0) a não ser que seja realmente necessário.

2. **Token compartilhado (obrigatório em produção)**  
   - Gere uma chave longa e aleatória (ex.: `openssl rand -hex 32`).  
   - No `.env` do servidor:  
     `MONITOR_CALLBACK_TOKEN=CHAVE_ULTRA_SECRETA_GERE_UMA_LONGA`  
   - Reinicie a API. Ao **configurar o Monitor** na catraca (tela Dispositivos → Verificar status, ou ao cadastrar dispositivo), o sistema já envia para a catraca a URL com `?token=CHAVE`. A catraca passará a enviar POST para essa URL; o servidor só processa se o token coincidir.

3. **Whitelist de IP (recomendado)**  
   - No `.env`:  
     `MONITOR_IP_WHITELIST=192.168.10.101,192.168.10.102`  
     (um IP por catraca, separados por vírgula, sem espaços).  
   - O servidor rejeita com 403 qualquer POST para `/api/notifications/dao` cuja origem não esteja nessa lista. Assim, mesmo que alguém descubra a URL com token, não conseguirá enviar de outro IP.

4. **Idade máxima do evento (replay)**  
   - Já existe por padrão: eventos com mais de 5 minutos são ignorados (`MONITOR_MAX_EVENT_AGE_SECONDS=300`).  
   - Para ajustar: `MONITOR_MAX_EVENT_AGE_SECONDS=600` (10 min) ou `120` (2 min). Use 0 para desativar (não recomendado em produção).

5. **Abrir a porta no servidor**  
   - A API escuta em `0.0.0.0:PORT` (ex.: 3000). Garanta que o firewall do **servidor** permita entrada nessa porta (pelos IPs/VLAN definidos no passo 1).  
   - Em produção, use **HTTPS**: coloque um proxy reverso (nginx/Caddy) na frente da API, expondo HTTPS (443); na catraca configure `https://seu-dominio ou IP` e porta 443. O path continua sendo o mesmo (ex.: `api/notifications/dao?token=...`).

6. **Configurar o Monitor na catraca**  
   - No SAGE: Dispositivos → cadastre o dispositivo (ou já cadastrado) → **Verificar status**. O sistema envia para a catraca o host, a porta e o **path com token** (se `MONITOR_CALLBACK_TOKEN` estiver definido).  
   - Confira nos logs da API a mensagem `[MONITOR] Monitor configurado em ... -> host:port/api/notifications/dao?token=...`.

7. **Testar**  
   - Passe alguém na catraca; o acesso deve aparecer na tela de monitoramento.  
   - Se testar com `curl` de outro PC, **sem** o token correto: deve retornar 401. **Sem** o IP na whitelist (quando configurada): deve retornar 403.

### 3.3 O que o sistema cuida sozinho

- **Token na URL**: quando `MONITOR_CALLBACK_TOKEN` está definido, o path enviado à catraca já inclui `?token=CHAVE`; não é preciso editar nada na catraca à mão.  
- **Validação do token**: middleware `monitorCallbackAuth` verifica `req.query.token` ou o header `X-Monitor-Token` antes de processar.  
- **Whitelist de IP**: o mesmo middleware compara o IP da requisição com `MONITOR_IP_WHITELIST`.  
- **Timestamp (replay)**: em `processarNotificacaoMonitorDao`, eventos com `time` fora da janela (mais antigos que N segundos ou no futuro) são descartados.  
- **Sanitização**: campos do payload são convertidos para número ou string com limite de tamanho; todos os acessos ao banco usam parâmetros preparados (sem concatenação de SQL).

### 3.4 Resumo Monitor

| Configuração | .env | Efeito |
|-------------|------|--------|
| Token | `MONITOR_CALLBACK_TOKEN=chave` | URL na catraca ganha `?token=chave`; servidor só aceita se token bater. |
| IP whitelist | `MONITOR_IP_WHITELIST=ip1,ip2` | Servidor só aceita POST desses IPs. |
| Idade máxima evento | `MONITOR_MAX_EVENT_AGE_SECONDS=300` | Eventos com mais de 5 min são ignorados (replay). |

Documentação detalhada do fluxo do Monitor: [MONITOR_CONTROL_ID.md](MONITOR_CONTROL_ID.md).

---

## 4. Referência rápida

| Tópico | Onde / Como |
|--------|-------------|
| Catraca só QR/RFID/senha | Não precisa configurar nada; use `CATRACA_SKIP_USER_IMAGE=true` para não enviar foto. |
| Autenticação nas rotas de dispositivo | Middleware `autenticar` em todas as rotas de dispositivo. |
| Validação do ID do dispositivo | Helper `parseDispositivoId` no deviceController; 400 se inválido. |
| Path do backup no download | Verificação `resolvedPath.startsWith(backupsDir)` e sem `..`; 403 se inválido. |
| Zeragem | Sempre gera backup antes; se backup falhar, zeragem não é executada. |
| **Monitor – token** | `MONITOR_CALLBACK_TOKEN` no .env; path na catraca com `?token=...`; middleware valida. |
| **Monitor – IP** | `MONITOR_IP_WHITELIST` no .env; middleware rejeita IP não listado. |
| **Monitor – replay** | `MONITOR_MAX_EVENT_AGE_SECONDS` (padrão 300); eventos antigos descartados. |
| **Monitor – sanitização** | Payload tipado e limitado; banco sempre com parâmetros (SQL injection). |
