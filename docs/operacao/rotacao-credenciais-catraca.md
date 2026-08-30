# Rotação das credenciais de catraca

As colunas `Dispositivo.usuario` e `Dispositivo.senha` guardam envelopes AES-256-GCM,
não os valores reutilizáveis. A chave ativa fica em `SAGE_DEVICE_CREDENTIAL_KEY`, no
`sage.env` privado do instalador; ela nunca é salva no banco.

Para rotacionar a chave de proteção:

1. Gere uma nova chave base64url de 32 bytes com um CSPRNG.
2. No `sage.env` privado, mova a chave ativa para
   `SAGE_DEVICE_CREDENTIAL_KEY_PREVIOUS` e coloque a nova em
   `SAGE_DEVICE_CREDENTIAL_KEY`.
3. Execute o provisionamento/atualização do serviço. O setup lê a chave anterior,
   recriptografa os dispositivos em uma transação e registra apenas a quantidade de
   registros alterados.
4. Depois de confirmar a subida da API, remova ou substitua o valor anterior por uma
   chave aleatória válida e execute o provisionamento novamente.

Se a chave ativa e a anterior forem perdidas, as credenciais das catracas não podem ser
recuperadas; será necessário cadastrá-las novamente.
