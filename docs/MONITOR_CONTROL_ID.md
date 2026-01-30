# Monitor Control iD — Acessos em tempo real na tela de monitoramento

Para que os **acessos reais da catraca** apareçam na tela de monitoramento, o SAGE usa **duas formas** (como o software oficial da Control iD):

---

## Modo 1: Polling (recomendado — igual ao software oficial)

O **servidor consulta as catracas** periodicamente (pull): a cada 20 segundos (ou o valor de `MONITOR_POLLING_INTERVAL_MS`) ele busca os novos logs de acesso em cada catraca e atualiza a tela. **Não é preciso** a catraca enviar POST para o PC nem abrir firewall.

- Configure no `.env`: `MONITOR_POLLING_INTERVAL_MS=20000` (20 segundos). Use `0` para desligar.
- Basta cadastrar as catracas na tela de Dispositivos e deixar o servidor rodando; os acessos aparecem na tela de monitoramento em até ~20 s.

---

## Modo 2: Monitor (push) — opcional

A **catraca envia POST** para este servidor quando há evento. Requer configurar o Monitor na catraca e que o PC aceite conexões (firewall).

### 2.1. Configuração automática

O sistema **já configura o Monitor na catraca** automaticamente:

- **Ao cadastrar um dispositivo** (tela Dispositivos → Adicionar ou quick-add): após criar o dispositivo, a API obtém sessão na catraca e envia `set_configuration` com o endereço deste servidor.
- **Ao abrir/atualizar a tela de Dispositivos**: ao buscar o status das catracas, para cada uma **ONLINE** a API reenvia a configuração do Monitor (em background), garantindo que o monitoramento fique ativo.

Para isso funcionar, configure no **.env** o endereço acessível pela rede da catraca:

```env
MONITOR_CALLBACK_HOST=192.168.1.100
MONITOR_CALLBACK_PORT=3000
```

Ou use uma URL completa:

```env
MONITOR_CALLBACK_URL=192.168.1.100:3000
```

Use o **IP ou host da máquina onde a SAGE-API roda**, visto pela rede da catraca (não use `localhost` se a API estiver em outro computador).

Para **dispositivos já cadastrados**, você pode:

- Abrir a tela de Dispositivos e clicar em **Verificar status** em cada um (a configuração do Monitor é reaplicada quando o status é ONLINE), ou  
- Chamar **POST /dispositivos/:id/configurar-monitor** (com autenticação) para forçar a configuração em um dispositivo.

### 2.2. Endpoint no backend

O backend expõe o endpoint que a catraca chama quando há eventos:

- **POST** `http://SEU_SERVIDOR:PORTA/api/notifications/dao`

Exemplo: se a SAGE-API roda em `http://192.168.1.100:3000`, a URL final é:

- `http://192.168.1.100:3000/api/notifications/dao`

Não é necessário token/JWT; a requisição vem do equipamento.

### 2.3. Rede e firewall

- A **catraca** precisa conseguir fazer **POST** do IP dela até o IP:porta do servidor (ex.: 192.168.0.64:3000).
- Verifique firewall e VLAN: se a catraca e o servidor estiverem em redes diferentes, libere essa comunicação.
- **Windows:** se a API roda no seu PC, libere a porta no Firewall do Windows (entrada para a porta 3000) ou desative temporariamente para testar.

### Testar se o servidor recebe o POST

De **outro PC ou celular na mesma rede** (ou no próprio PC), rode:

```bash
curl -X POST http://192.168.0.64:3000/api/notifications/dao -H "Content-Type: application/json" -d "{\"device_id\":1,\"object_changes\":[]}"
```

Se o servidor estiver escutando e o firewall liberado, no **terminal da SAGE-API** deve aparecer:

- `[MONITOR] Requisição recebida: POST /api/notifications/dao`
- `[MONITOR DAO] POST recebido: device_id=1, 0 acesso(s) em object_changes`

Se **nada** aparecer, a requisição não está chegando (firewall ou IP errado).

### 2.4. Mapear catraca → dispositivo no banco (várias catracas)

Cada notificação vem com um **device_id** (ID do equipamento na Control iD). Para o backend saber qual registro da tabela **Dispositivo** corresponde a essa catraca:

1. **Execute a migração** (adiciona a coluna `control_id_device_id` na tabela `Dispositivo`):

   ```bash
   mysql -u USUARIO -p NOME_BANCO < database/migration_control_id_device_id.sql
   ```

2. **Preencha o campo** no cadastro do dispositivo:
   - No banco: `UPDATE Dispositivo SET control_id_device_id = 478435 WHERE id = 1;`  
     (substitua `478435` pelo `device_id` que aparece no JSON enviado pela catraca).
   - Ou adicione no frontend um campo “ID Control iD (Monitor)” no formulário de dispositivo e salve em `control_id_device_id`.

Se você tiver **apenas um** dispositivo cadastrado, o backend usa esse dispositivo automaticamente mesmo sem `control_id_device_id`. Com mais de um dispositivo, o mapeamento por `control_id_device_id` é necessário.

### 2.5. Como testar (Modo push)

1. Configure o Monitor na catraca (2.1).
2. Garanta rede/firewall (2.3).
3. (Opcional) Rode a migração e preencha `control_id_device_id` (2.4).
4. Passe alguém na catraca: o acesso deve ser gravado e a tela de monitoramento deve atualizar em tempo real (WebSocket).

Se ainda não aparecer, confira os logs da SAGE-API ao passar na catraca (mensagens `[MONITOR DAO]`) e verifique se a catraca está realmente enviando POST para `http://IP:PORTA/api/notifications/dao`.

---

**Resumo:** Use o **Modo 1 (Polling)** para que os acessos apareçam na tela sem configurar firewall nem Monitor push. O Modo 2 (Monitor) é opcional para atualização instantânea.
