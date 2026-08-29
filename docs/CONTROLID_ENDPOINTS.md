# Endpoints Control iD usados pelo SAGE

Este documento é o inventário dos endpoints da Access API que aparecem no código do
SAGE-API. Ele descreve a integração observada no repositório, não um contrato para
hardware que ainda não foi medido em campo.

Os exemplos usam somente valores fictícios. Nunca coloque IP, usuário, senha ou token
de uma catraca neste documento, em issue, log ou teste.

## Convenções da integração

- Todas as chamadas são `POST` JSON.
- O `login.fcgi` devolve uma sessão temporária. As chamadas protegidas recebem essa
  sessão na query string como `?session=<sessao-sintetica>`.
- O SAGE obtém a sessão em `src/services/deviceService.js` e também mantém o helper
  legado em `src/utils/controlId-utils.js`.
- A sessão é validada com `session_is_valid.fcgi` antes de operações que podem durar
  mais tempo.
- Falha de rede, timeout ou sessão inválida deve permanecer visível para o fluxo que
  iniciou a operação. O cliente não deve tratar falha remota como sucesso.

## Inventário de endpoints

| Endpoint | Uso no SAGE | Corpo observado | Código principal |
|---|---|---|---|
| `/login.fcgi` | Abre uma sessão administrativa na catraca | `{ login, password }` | `deviceService.obterSessao`, `controlId-utils.obterSessaoAdmin` |
| `/session_is_valid.fcgi` | Confirma que a sessão ainda pode ser usada | nenhum corpo específico | `deviceService.verificarSessao` |
| `/load_objects.fcgi` | Lê objetos da catraca e seus logs | `{ object, columns?, where?, limit?, offset?, order? }` | `deviceService`, `controlId-utils` |
| `/create_objects.fcgi` | Cria usuário, cartão e vínculo de grupo nos fluxos legados | `{ object, values }` | `controlId-utils` |
| `/create_or_update_objects.fcgi` | Restaura objetos de backup de forma idempotente | `{ object, values }` | `deviceService.restaurarBackupCompletoCatraca` |
| `/modify_objects.fcgi` | Altera atributos de usuário no fluxo legado | `{ object, values, where? }` | `controlId-utils` |
| `/destroy_objects.fcgi` | Remove usuários, cartões, grupos, imagens e logs conforme o escopo autorizado | `{ object, where }` | `deviceService`, `controlId-utils` |
| `/set_configuration.fcgi` | Configura o callback de monitor da catraca | `{ monitor: { ... } }` | `deviceService.configurarMonitorNaCatraca` |
| `/user_set_image_list.fcgi` | Envia a imagem de um usuário quando o modelo suporta o recurso | `{ user_images: [...] }` | `controlId-utils.criarImagemUser` |
| `/user_destroy_image.fcgi` | Remove a imagem de um usuário | `{ object: "user_images", where }` | `controlId-utils.deletarImagemUser` |

### Regra de escrita

O código atual ainda usa `create_objects.fcgi` em partes do provisionamento de usuário,
cartão e grupo. Isso é registrado aqui para que a documentação não esconda a diferença
entre o comportamento atual e a regra de arquitetura: escritas repetíveis devem usar
`create_or_update_objects.fcgi`. A mudança desse fluxo é uma entrega própria e não foi
incluída nesta documentação.

## Objetos observados

Os objetos usados nos fluxos atuais incluem:

- `access_logs`: eventos lidos pelo job de sincronização; a integração atual traz os
  registros e filtra o intervalo no SAGE.
- `users`: usuários da catraca, relacionados a `Pessoa` no SAGE.
- `cards`: cartões RFID, relacionados a `Pessoa.cartao_rfid`.
- `user_groups`: vínculo do usuário com o grupo atribuído na catraca.
- `areas`, `groups`, `portals`, `access_rules`, `time_zones`, `time_spans` e seus
  vínculos: objetos incluídos no backup/listagem da catraca quando o equipamento os
  fornece.
- `user_images`: imagem associada a um usuário, quando o firmware possui o módulo
  correspondente.

Os campos e a disponibilidade desses objetos variam por firmware. O simulador versionado
em `test/fakes/controlid/` é a fonte de teste do repositório; a confirmação de faixa de
IDs, relógio e capacidade do equipamento real continua sendo pergunta da visita de campo.

## Fluxos e ordem

### Sincronização de acessos

1. `login.fcgi` abre a sessão.
2. `load_objects.fcgi` é chamado com `object: "access_logs"`.
3. O SAGE valida e filtra os eventos em memória antes de gravar `Acesso`.
4. A tela consulta o banco por `GET /acessos`; ela não chama a catraca diretamente.

### Cadastro ou alteração de pessoa

O fluxo legado abre uma sessão, cria ou altera `users`, cria cartões e o vínculo
`user_groups` e, quando habilitado, envia `user_images`. A ordem é importante porque
cartões, imagens e vínculos dependem do usuário já existir.

### Backup e restauração

O backup lê cada objeto por `load_objects.fcgi`. A restauração escreve com
`create_or_update_objects.fcgi` e relê o objeto com `load_objects.fcgi` para conferir o
resultado. Operações destrutivas de limpeza precisam de backup verificado e escopo
explícito conforme `AGENTS.md` e os testes de operações destrutivas.

### Monitor push

`set_configuration.fcgi` configura a catraca para enviar eventos ao callback do SAGE.
O callback do SAGE é outro endpoint HTTP da aplicação (`/api/notifications/dao`), não
um endpoint da Access API; ele não deve ser confundido com os endpoints `.fcgi` desta lista.

## Referências no repositório

- `src/services/deviceService.js`: sessão, leitura, backup, restauração, limpeza e monitor.
- `src/utils/controlId-utils.js`: operações legadas de usuário, cartões, grupos e imagens.
- `src/services/accessService.js`: consumo dos `access_logs` durante a sincronização.
- `test/fakes/controlid/README.md`: comportamento reproduzível e limitações do simulador.
- `docs/ANALISE_SYNC_CONTROL_ID.md`: perguntas ainda abertas sobre `access_logs`, `id` e `time`.
- `docs/ORDEM_SYNC_CATRACA.md`: dependências entre os objetos ao importar ou reconstruir dados.

