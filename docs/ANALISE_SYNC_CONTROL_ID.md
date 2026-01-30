# Análise: sincronização de acessos com Control iD

Documento para dar dois passos atrás, entender o sistema e montar um plano de estudos com fontes oficiais (API, GitHub, Postman).

---

## 1. Estado atual do sistema

### 1.1 Fluxo da sync (polling)

1. **Job** (`scheduledJobs.js`): a cada `MONITOR_POLLING_INTERVAL_MS` (20 s) chama `sincronizarTodosAcessos()`.
2. **Por dispositivo**: para cada catraca, `sincronizarAcessos(dispositivo)`:
   - Obtém sessão na catraca (login).
   - Lê no banco o **último acesso** do dispositivo (`ORDER BY id DESC LIMIT 1`).
   - Calcula `timestampInicial = último_acesso - 1h` (margem de segurança).
   - Chama **Control iD**: `load_objects` com `object: 'access_logs'` (sem filtro de tempo na API).
   - Filtra em JS: `log.time > timestampInicial`.
   - Para cada log restante:
     - Descarta se `log.id <= CATRACA_MIN_LOG_ID`.
     - Descarta se `log.user_id` vazio ou inválido.
     - Converte `user_id` → `pessoa_id` (offset 111000000).
     - Se pessoa não existe → ignora (contador `ignoradosPessoa`).
     - Verifica duplicata: `(pessoa_id, dispositivo_id, data_hora)` no banco (UTC e Date).
     - Se já existe → ignora (contador `ignoradosDuplicata`).
     - Senão → INSERT em `Acesso`, invalida cache, emite WebSocket.
3. **Tela**: Home chama `GET /acessos?page=1&limit=50` (ordenado por `id DESC`). Resposta vem do cache ou do banco.

### 1.2 O que os logs mostraram

- **Catraca 01**: `logs=5`, `inseridos=0`, `ignorados(pessoa)=0`, `ignorados(duplicata)=0`  
  → Os 5 logs estão sendo descartados **antes** de chegar em pessoa/duplicata, ou seja no primeiro `if`:  
  `if (log.id <= MIN_ID || log.time <= timestampInicial) continue`.

- **Catraca 02**: `logs=48057`, `inseridos=0`, `ignorados(pessoa)=0`, `ignorados(duplicata)=0`  
  → Os 48.057 logs também são todos descartados no **primeiro** filtro.

Conclusão: com `CATRACA_MIN_LOG_ID=73975`, **qualquer log com `id <= 73975` é ignorado**.  
Se a Catraca 02 (ou a 01) usa IDs de log nesse intervalo (por exemplo, IDs próprios por dispositivo ou sequência que não passa de 73975), **nenhum log é processado**. Por isso “rodar 20 vezes” não insere nada.

---

## 2. Causa raiz provável

- **MIN_ID global**: hoje um único `CATRACA_MIN_LOG_ID` vale para **todas** as catracas.  
  Em sistemas Control iD, o `id` de `access_logs` pode ser:
  - por dispositivo (cada catraca tem sua própria sequência 1, 2, 3…), ou
  - global (sequência única no equipamento/serviço).

Se for **por dispositivo**, 73975 pode ser “alto” para uma catraca e “baixo” para outra, ou o contador da Catraca 02 nunca passar de 73975, **Exemplo real**: Catraca 02 retorna id [6169, 53148]; se MIN_ID=73975, todos os logs são descartados (53148 < 73975). Use MIN_ID=0 ou um valor ≤ max id do dispositivo.

- **API `access_logs`**: hoje chamamos `load_objects` **sem** filtro na API; a catraca envia **todos** os logs (milhares), o que sobrecarrega e pode estourar timeout (10s). Solução aplicada: timeout maior **só** para `load_objects` via `CATRACA_LOAD_LOGS_TIMEOUT` (padrão 60s).

---

## 3. Plano de estudos (fontes oficiais)

Objetivo: alinhar o comportamento do SAGE com a API real e com exemplos que funcionam.

### 3.1 Documentação Control iD

- **Access API (Monitor / objetos)**  
  - URL conhecida: https://www.controlid.com.br/docs/access-api-pt/  
  - Procurar: `load_objects`, `access_logs`, parâmetros aceitos (filtro por tempo, por id, paginação).
- **Formato dos campos**: `id`, `time`, `user_id`, `portal_id`, `card_value` — tipo (int/string), unidade de `time` (segundos UTC?), se `id` é global ou por dispositivo.

### 3.2 Repositórios / exemplos GitHub

- Pesquisar: `control id access api` ou `controlid load_objects access_logs`.
- Ver como outros projetos:
  - obtêm `access_logs` (com ou sem filtro),
  - tratam `id` e `time`,
  - fazem polling e evitam reprocessar (por id, por tempo, ou ambos).

### 3.3 Postman / chamadas diretas

- **Obter sessão** (login) na catraca.
- **Chamar `load_objects`** com `object: 'access_logs'` e, se a doc permitir, parâmetros de filtro.
- Anotar:
  - Quantos registros vêm (Catraca 01 vs 02).
  - Faixa de `id` (mín e máx) por dispositivo.
  - Faixa de `time` (comparar com horário real/local).
  - Se existe paginação ou limite por resposta.

Isso confirma se o `id` é por dispositivo e se faz sentido um MIN_ID global ou por dispositivo.

### 3.4 Diagnóstico no SAGE

- **GET `/diagnostico-acessos/:id`** já compara “logs na catraca” vs “nosso banco”.
- Incluir no diagnóstico (ou em um script) uma amostra de **ids** e **times** dos logs retornados pela API (ex.: primeiros 5 e últimos 5 por `id`), para validar contra o que o Postman mostrar.

---

## 4. Ajustes recomendados (curto prazo)

Enquanto o plano de estudos não é feito, duas mudanças reduzem o efeito do MIN_ID e ajudam a validar o resto do fluxo.

### 4.1 Testar com MIN_ID = 0

- No `.env`: `CATRACA_MIN_LOG_ID=0`.
- Reiniciar a API, rodar a sync e olhar de novo:
  - `inseridos`, `ignorados(pessoa)`, `ignorados(duplicata)` por dispositivo.
- Se passar a inserir, confirma que o bloqueio era o MIN_ID. Aí o próximo passo é definir um critério correto (por dispositivo ou por tempo).

### 4.3 MIN_ID por dispositivo (futuro)

- Se a documentação ou o Postman confirmar que `id` é por dispositivo (ou que cada catraca tem sua faixa):
  - Trocar um único `CATRACA_MIN_LOG_ID` por um valor **por dispositivo** (ex.: tabela `Dispositivo.ultimo_log_id_sincronizado` ou config por dispositivo).
  - Na sync: usar “último id processado” por dispositivo em vez de um MIN_ID global.

---

## 5. Checklist antes de nova rodada

- [ ] Documentação Control iD: `load_objects` e `access_logs` lidos.
- [ ] Postman: chamada a `access_logs` para Catraca 01 e 02; anotar faixa de `id` e `time`.
- [ ] GitHub: pelo menos um exemplo de sync de acessos com a API.
- [ ] Teste com `CATRACA_MIN_LOG_ID=0`: conferir contadores da sync e se a tela de monitoramento atualiza.
- [ ] Decisão: MIN_ID global, por dispositivo, ou abandono de MIN_ID e uso só de “último id por dispositivo” + duplicata no banco.

---

## 6. Referências rápidas no código

| O quê | Onde |
|-------|------|
| Job de polling | `src/jobs/scheduledJobs.js` → `pollingMonitoramentoJob` |
| Sync por dispositivo | `src/services/accessService.js` → `sincronizarAcessos` |
| Obtenção de logs na catraca | `src/services/deviceService.js` → `obterLogsCatraca` |
| Filtro MIN_ID e timestamp | `accessService.js` → `if (log.id <= MIN_ID \|\| log.time <= timestampInicial)` |
| Lista da tela | `GET /acessos` → `accessController.listar` (ORDER BY id DESC) |
| Diagnóstico | `GET /diagnostico-acessos/:id` → `deviceController.diagnosticoAcessos` |

Este documento deve ser atualizado conforme saírem conclusões da documentação, do Postman e do GitHub (ex.: formato exato de `id`/`time` e se id é global ou por dispositivo).
