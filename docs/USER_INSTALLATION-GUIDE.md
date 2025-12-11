# Guia de Instalação - Para Equipe Técnica

## Visão Geral

Este documento descreve como instalar o SAGE-API em uma escola usando o executável que você vai distribuir.

---

## Instalação Automática

O SAGE-API foi desenvolvido para ser **totalmente automático**. Você não precisa fazer nada manualmente.

### Passo Único: Executar o Instalador

```bash
Duplo-clique em:
SAGE-API-v1.0-MySQL8.0.44.exe
```

Pronto! O sistema fará automaticamente:

1. Criar diretórios necessários
2. Extrair MySQL portável
3. Configurar banco de dados
4. Criar tabelas
5. Inserir dados padrão
6. Criar atalho na desktop
7. Abrir sistema no browser

**Tempo total: 3-5 minutos**

Você verá o progresso no terminal durante a execução.

---

## Pré-requisitos Mínimos

Apenas verifique esses itens **antes** de executar:

- PC com Windows 10/11 (64 bits)
- Mínimo 4GB de RAM (8GB recomendado)
- Espaço em disco: 200GB disponível em C:\
- Acesso de Administrador (necessário para instalação)
- Conexão à internet (apenas para download do arquivo)

---

## Após a Instalação

Sistema deve:
- Iniciar MySQL portável (automaticamente)
- Iniciar servidor Node.js
- Abrir http://localhost:3000 no browser
- Tempo: ~30 segundos

---

## Localização dos Arquivos

### Estrutura de Instalação

```
C:\Program Files\SAGE-API\
├── node_modules/ (dependências)
├── src/ (código da aplicação)
├── database/ (schema e scripts SQL)
├── mysql-portable/ (MySQL 8.0.44)
├── config.json (configuração)
├── .env (credenciais encriptadas)
├── run.js (launcher principal)
└── docs/ (documentação)

C:\ProgramData\SAGE-API\
├── mysql-data/ (banco de dados - IMPORTANTE!)
│   └── sage/ (banco "sage")
├── logs/ (logs do sistema)
└── backups/ (backups automáticos)
```

### Pasta Importante: `C:\ProgramData\SAGE-API\mysql-data\`

IMPORTANTE: Nunca delete esta pasta!

Contém:
- Todos os dados do sistema
- Registros de acesso
- Monitoramento
- Configurações

**Fazer backup semanal:**

```bash
# Windows PowerShell (como Administrador)
Copy-Item -Path "C:\ProgramData\SAGE-API\" `
          -Destination "D:\Backups\SAGE-API-$(date +%Y%m%d)" `
          -Recurse

# Ou usar Windows Backup nativo
```

---

## Usando Diariamente

### Iniciar

Duplo-clique no atalho "SAGE-API" na desktop ou execute manualmente:

```
C:\Program Files\SAGE-API\run.js
```

Sistema abrirá automaticamente em http://localhost:3000

### Parar

Feche a janela do terminal ou pressione Ctrl+C.

### Login Padrão

```
Usuário: admin
Senha: admin
```

**Mude esta senha na primeira execução!**

---

## Dados e Backup

### Localização dos Dados

Todos os dados são salvos em:
```
C:\ProgramData\SAGE-API\mysql-data\
```

### Backup Automático

Sistema faz backup automático a cada 24 horas em:
```
C:\ProgramData\SAGE-API\backups\
```

### Backup Manual

```bash
# Windows PowerShell (como Administrador)
Copy-Item -Path "C:\ProgramData\SAGE-API\" `
          -Destination "D:\Backups\SAGE-API-backup-$(Get-Date -f 'yyyyMMdd')" `
          -Recurse
```

---

## Segurança

- **Banco de dados:** LOCAL (não sai do PC)
- **Acesso:** Apenas em http://localhost
- **Rede:** Não escuta internet
- **Sincronização:** Opcional e desativada por padrão

---

## Troubleshooting

### Sistema não inicia

```
Verificar porta 3000:
netstat -ano | findstr :3000

Se estiver ocupada, mudar em C:\Program Files\SAGE-API\config.json
```

### MySQL não inicia

```
Deletar C:\ProgramData\SAGE-API\mysql-data\ 
(Fará reset completo e recriará ao reiniciar)
```

### Dados desapareceram

```
Restaurar do backup em C:\ProgramData\SAGE-API\backups\
```

### Antivírus bloqueia

Adicionar exceções para:
- C:\Program Files\SAGE-API\
- C:\ProgramData\SAGE-API\

---

## Documentação Adicional

- **BUILD-EXECUTABLE.md** - Como gerar o executável
- **DEVELOPMENT.md** - Para desenvolvedores
- Swagger/OpenAPI - http://localhost:3000/docs

---

## Suporte

Email: equipe@etec.sp.gov.br
Telefone: (11) 5678-9012

