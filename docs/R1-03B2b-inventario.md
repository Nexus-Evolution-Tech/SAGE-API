# R1-03B2b — inventário de people

## Cobertas

- `PATCH /pessoas/:id`: atualização composta de `Pessoa` e tabela de especialização,
  fila `sync_pendente` e `REGISTRO_EDITADO` na mesma transação.
- `DELETE /pessoas/:id`: desativação (`Pessoa.visivel = 0`), fila `sync_pendente` e
  `REGISTRO_DELETADO` na mesma transação.

## Fora

- Leituras de people e busca de URLs.
- `POST /pessoas` e o UPSERT de criação: CRUD/criação, fora do recorte desta issue.
- Upload de foto: operação explícita fora desta issue, conforme o recorte de #78.
- Geração de QR (`POST /pessoas/gerar_qrcode/:id`): UPDATE administrativo montado,
  deliberadamente recortado para #83; não implementar nesta issue.
- `POST /pessoas/sincronizar-banco`: sincronização global, sem negócio local associado.
- ControlID, device, aulas, matérias, access, CRUD genérico e demais issues citadas em #78.
