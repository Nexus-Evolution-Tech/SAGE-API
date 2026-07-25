# Ordem de sincronização Catraca ↔ SAGE

## Dois casos de uso

**Caso 1 – Já usava a catraca com o sistema da Control iD, agora instalou o SAGE**  
Ao abrir o SAGE, o usuário quer que **todos os dados da catraca** (áreas, pessoas, etc.) **apareçam na tela** e fiquem registrados no banco, com catraca e sistema sincronizados.  
→ Em **Configurações → Ferramentas – Catraca**: selecionar o dispositivo e clicar em **"Puxar dados da catraca"**. O sistema importa áreas e usuários da catraca para o SAGE na ordem correta (Area → Pessoa). Depois, ao cadastrar/editar pessoas no SAGE, elas continuam sendo enviadas para a catraca.

**Caso 2 – Quer aplicar o SAGE na escola e começar do zero**  
O usuário instalou o SAGE e quer **zerar tudo** (catraca e sistema) para cadastrar tudo de novo.  
→ Em **Configurações → Ferramentas – Catraca**: clicar em **"Começar do zero"**. Abre um modal para escolher o que apagar no SAGE: **Acessos deste dispositivo**, **Áreas**, **Pessoas (todas)**. Ao confirmar: (1) é gerado backup completo e baixado; (2) a catraca é zerada (usuários, áreas, grupos, logs); (3) no SAGE são apagados os itens marcados. A partir daí o usuário cadastra tudo de novo e mantém a sincronia.

---

## Onde fica o backup

- **No servidor**: os arquivos são gravados em `backups/` na raiz do projeto SAGE-API (ex.: `backups/catraca_1_completo_2026-02-04T19-30-00.json`, `backups/acessos_catraca_1_....jsonl`).
- **No seu computador**: quando você usa a interface (Configurações → Ferramentas – Catraca) e clica em “Backup completo” ou “Backup logs”, o navegador faz o download do arquivo. Esse arquivo vai para a **pasta de Downloads** (ou a pasta que você configurou no navegador). Ou seja: você tem uma cópia no servidor e outra onde você salvar ao baixar (ex.: Downloads). Em caso de desastre, use o backup que você guardou (Downloads ou outro lugar).

## Objetos mapeados na catraca (Control iD)

Objetos que o sistema lê/grava na catraca e que entram no **backup completo** e nas rotas de listagem/exclusão:

| Objeto API   | Descrição (catraca)        | No SAGE / uso                          |
|--------------|----------------------------|----------------------------------------|
| `users`      | Usuários                   | ↔ Pessoa (nome, matrícula, credenciais)|
| `areas`      | Áreas de acesso            | ↔ Area (nome), Dispositivo.area_id      |
| `groups`     | Grupos/departamentos       | Sem tabela direta; usado em user_groups|
| `user_groups`| Usuário ↔ grupo            | Derivado de Pessoa + grupo na catraca  |
| `portals`    | Portais (liga duas áreas)  | area_from_id, area_to_id → áreas       |
| `access_rules` | Regras de acesso         | Controle de quem passa onde            |
| `cards`      | Cartões RFID               | ↔ Pessoa.cartao_rfid                   |
| `qrcodes`    | QR codes                   | ↔ Pessoa.qr_code                       |
| `time_zones` | Horários                   | Critério de regra de acesso             |
| `time_spans` | Intervalos do horário      | Referencia time_zone_id                 |
| `group_access_rules`, `user_access_rules`, `portal_access_rules` | Vínculos regra ↔ grupo/usuário/portal | |
| `user_roles` | Admin na catraca           | —                                      |
| `scheduled_unlocks`, `actions` | Liberações agendadas, scripts | —                               |

Rotas existentes:

- `GET /dispositivos/:id/catraca/objetos/:objectType` – listar (users, areas, groups, …)
- `DELETE /dispositivos/:id/catraca/objetos/:objectType/:objectId` – remover um objeto na catraca
- `POST /dispositivos/:id/backup-completo` – backup completo (JSON) para download
- `POST /dispositivos/:id/backup-logs` – backup só de access_logs (JSONL)
- `POST /dispositivos/:id/zerar-logs` – zerar access_logs (com backup antes)

---

## Ordem correta: Catraca → SAGE (restaurar / puxar tudo para o sistema)

Quando o sistema caiu e você sobe um novo, ou quando quer “puxar” a catraca para o SAGE, as dependências (foreign keys) exigem esta ordem:

1. **UnidadeEscolar** – deve existir (pelo menos uma unidade). Não vem da catraca; use a que já existe ou crie uma padrão.
2. **Area** – criar uma `Area` no SAGE para cada `areas` da catraca (ou do backup), com `unidade_id` da unidade escolhida. Assim `Area.id` existe para o próximo passo.
3. **Dispositivo** – em geral já existe (é o dispositivo que você cadastrou). Opcionalmente atualizar `area_id` para bater com as áreas que você acabou de criar (mapeando área da catraca → Area.id do SAGE).
4. **Pessoa** – criar uma `Pessoa` para cada `users` da catraca. Mapear: `name` → nome, `registration` → matrícula (e/ou qr_code), e definir `unidade_id`, `tipo` (ex.: ALUNO), etc. Não dá para criar Aluno/Funcionario sem antes ter Pessoa.
5. **Aluno / Funcionario / etc.** – depois de ter Pessoa, criar registros em Aluno, Funcionario, etc., conforme o tipo.
6. **Acesso** – logs de acesso; a sincronização normal de acessos já preenche isso a partir dos access_logs da catraca.

Ou seja: **UnidadeEscolar → Area → Dispositivo (ou atualizar) → Pessoa → Aluno/Funcionario/… → Acesso (sync de logs).**

---

## Ordem correta: SAGE → Catraca (zerar e recolocar do sistema)

Quando você zera a catraca e quer “recolocar” tudo a partir do SAGE, na catraca a ordem é (respeitando dependências da API Control iD):

1. **time_zones** – horários (se usar).
2. **time_spans** – intervalos que referenciam time_zone_id.
3. **areas** – criar áreas na catraca a partir de SAGE `Area` (associar ao dispositivo).
4. **groups** – grupos/departamentos (o SAGE hoje cria um grupo por pessoa ao criar usuário).
5. **access_rules** – regras de acesso (e vínculos com time_zones se houver).
6. **portals** – dependem de areas (area_from_id, area_to_id).
7. **portal_access_rules**, **group_access_rules** – depois de portais e grupos.
8. **users** – usuários na catraca (a partir de SAGE Pessoa); hoje feito em `controlIdService.criarNovaPessoaNasCatracas` (usuário + cartão + QR + grupo).
9. **user_groups** – vínculo user ↔ group.
10. **cards**, **qrcodes** – dependem de user_id (já criados junto com o usuário no fluxo atual).

Hoje o SAGE já envia pessoas para a catraca (usuário + cartão + QR + grupo) na ordem correta. Áreas e portais na catraca, se quiser espelhar SAGE Area, precisam ser criados antes (passos 3 e 6 acima); aí você mantém sistema e catraca em sincronia (áreas, depois pessoas).

---

## Fluxo “zerar catraca e começar certo”

1. **Backup**  
   - Fazer **backup completo** (Configurações → Ferramentas – Catraca → Backup completo) e **guardar o arquivo** (ex.: na pasta Downloads ou em rede).  
   - Opcional: fazer também **backup de logs** (Backup logs da catraca).

2. **Zerar**  
   - Usar **Apagar logs da catraca** (zerar access_logs).  
   - Se quiser zerar também usuários/áreas/grupos na catraca: listar com `GET .../catraca/objetos/users` (e areas, groups, etc.), depois ir removendo com `DELETE .../catraca/objetos/users/:id` (e areas, groups) na ordem que fizer sentido (ex.: user_groups depois users, etc.), ou usar um script que faça isso na ordem inversa das dependências.

3. **Recolocar a partir do SAGE**  
   - Garantir que no SAGE existem **Area** e **Pessoa** (e Aluno/Funcionario etc.) como fonte da verdade.  
   - O sistema já envia **Pessoas** para a catraca ao criar/editar (usuário + cartão + QR + grupo).  
   - Se quiser espelhar **áreas** do SAGE na catraca, é preciso criar primeiro as áreas na catraca (ordem acima), depois associar dispositivos/portais conforme a API permitir.

4. **Se o sistema cair e você subir um novo**  
   - Usar o endpoint de **importar da catraca para o SAGE** (ou importar a partir do arquivo de backup completo), que insere na ordem: **Area** → **Pessoa** → (Aluno/Funcionario conforme tipo). Assim as foreign keys são respeitadas e você “puxa tudo” da catraca (ou do backup) para o sistema na ordem certa.

---

## Resumo

- **Backup**: servidor em `backups/` + download para o seu PC (ex.: Downloads). Guarde uma cópia do backup completo para recuperação.
- **Objetos e rotas**: todos os objetos listados acima estão mapeados com listagem, exclusão e backup completo.
- **Zerar**: você pode zerar logs (e, manualmente ou via script, usuários/áreas/grupos na catraca) e depois recolocar a partir do SAGE na ordem descrita.
- **Ordem**: Catraca → SAGE = UnidadeEscolar → Area → Dispositivo → Pessoa → Aluno/Funcionario → Acesso. SAGE → Catraca = time_zones → time_spans → areas → groups → access_rules → portals → … → users → user_groups → cards/qrcodes.
