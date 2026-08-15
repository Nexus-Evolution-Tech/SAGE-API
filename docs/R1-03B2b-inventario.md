# R1-03B2b — inventário de people

## Cobertas

- `PATCH /pessoas/:id`: atualização composta de `Pessoa` e tabela de especialização,
  fila `sync_pendente` e `REGISTRO_EDITADO` na mesma transação.
- `DELETE /pessoas/:id`: desativação (`Pessoa.visivel = 0`), fila `sync_pendente` e
  `REGISTRO_DELETADO` na mesma transação.
- `POST /pessoas/gerar_qrcode/:id`: geração e UPDATE de `Pessoa.qr_code` com
  `REGISTRO_EDITADO` na mesma transação; o detalhe da trilha fica nulo.

## Fora

- Leituras de people e busca de URLs.
- `POST /pessoas` e o UPSERT de criação: CRUD/criação, fora do recorte desta issue.
- `POST /pessoas/sincronizar-banco`: sincronização global, sem negócio local associado.
- ControlID, device, aulas, matérias, access, CRUD genérico e demais issues citadas em #78.
- Upload de foto, `PATCH`/`DELETE` de people já integrados em #78, generic #74,
  device #73, C-006/#67, C-013, C-001, #47 e R1-04.
