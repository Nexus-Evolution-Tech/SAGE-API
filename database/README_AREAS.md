# Áreas e foto

Para a tela de **Áreas** funcionar com foto e dispositivos associados:

## 1. Coluna `foto` na tabela Area (banco já existente)

Se o banco foi criado antes da coluna `foto`, rode **uma vez**:

```bash
mysql -u SEU_USUARIO -p SEU_BANCO < migration_area_foto.sql
```

Ou no cliente MySQL:

```sql
ALTER TABLE Area ADD COLUMN foto VARCHAR(255) NULL COMMENT 'Caminho relativo da foto (ex: areas/area_1.png)' AFTER unidade_id;
```

(Se der erro "Duplicate column", a coluna já existe — pode ignorar.)

## 2. Área padrão (para as catracas aparecerem numa área)

Para ter pelo menos uma área (ex.: "Portaria Principal") e as catracas com `area_id` aparecerem nela:

```bash
mysql -u SEU_USUARIO -p SEU_BANCO < seed_area_padrao.sql
```

Assim, se já existirem dispositivos com `area_id = 1`, a área id=1 passará a existir e eles aparecerão na tela ao abrir essa área.

## Ordem sugerida

1. `migration_area_foto.sql` (se ainda não rodou)
2. `seed_area_padrao.sql`

Depois, reinicie a API (ou aguarde o cache expirar) e teste de novo o upload de foto na área.
