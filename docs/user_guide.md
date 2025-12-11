# Guia do Usuário (user_guide.md)

## Visão Geral

Este documento explica como instalar e utilizar o SAGE-API em ambiente de produção, voltado para equipe técnica e usuários finais.

## Instalação Automática

O SAGE-API foi desenvolvido para ser totalmente automático. Não é necessário realizar configurações manuais.

### Passo Único: Executar o Instalador

1. Faça o download do arquivo:
   SAGE-API-v1.0-MySQL8.0.44.exe
2. Dê um duplo clique no instalador.

O sistema irá:
- Criar diretórios necessários
- Extrair o MySQL portável
- Configurar o banco de dados
- Criar tabelas e inserir dados padrão
- Criar atalho na área de trabalho
- Abrir o sistema no navegador

Tempo estimado: 3 a 5 minutos

## Pré-requisitos Mínimos

- Windows 10/11 (64 bits)
- 4GB de RAM (8GB recomendado)
- 200GB de espaço livre em disco
- Acesso de Administrador
- Conexão à internet apenas para download do instalador

## Após a Instalação

O sistema irá:
- Iniciar o MySQL portável automaticamente
- Iniciar o servidor Node.js
- Abrir http://localhost:3000 no navegador

## Estrutura de Instalação

C:\Program Files\SAGE-API\
- node_modules/ (dependências)
- src/ (código da aplicação)
- database/ (schema e scripts SQL)
- mysql-portable/ (MySQL 8.0.44)
- config.json (configuração)
- .env (credenciais encriptadas)
- run.js (launcher principal)
- docs/ (documentação)

C:\ProgramData\SAGE-API\
- mysql-data/ (banco de dados)
- logs/ (logs do sistema)
- backups/ (backups automáticos)

Atenção: Nunca delete a pasta C:\ProgramData\SAGE-API\mysql-data\, pois ela contém todos os dados do sistema.

## Backup dos Dados

- O sistema faz backup automático a cada 24 horas em C:\ProgramData\SAGE-API\backups\
- Para backup manual, utilize o PowerShell como Administrador:
  ```powershell
  Copy-Item -Path "C:\ProgramData\SAGE-API\" -Destination "D:\Backups\SAGE-API-backup-$(Get-Date -f 'yyyyMMdd')" -Recurse
  ```

## Uso Diário

- Para iniciar, clique no atalho "SAGE-API" na área de trabalho ou execute manualmente:
  C:\Program Files\SAGE-API\run.js
- O sistema abrirá automaticamente em http://localhost:3000
- Para parar, feche a janela do terminal ou pressione Ctrl+C

Login padrão:
- Usuário: admin
- Senha: admin

Recomenda-se alterar a senha no primeiro acesso.

## Segurança

- O banco de dados é local e não sai do computador
- O acesso é apenas via http://localhost
- Não há exposição na internet
- Sincronização é opcional e desativada por padrão

## Troubleshooting

- Se o sistema não iniciar, verifique se a porta 3000 está livre:
  ```
  netstat -ano | findstr :3000
  ```
  Se necessário, altere a porta em C:\Program Files\SAGE-API\config.json

- Se o MySQL não iniciar, delete a pasta C:\ProgramData\SAGE-API\mysql-data\ (isso fará reset completo)

- Se os dados sumirem, restaure o backup de C:\ProgramData\SAGE-API\backups\

- Se o antivírus bloquear, adicione exceções para:
  - C:\Program Files\SAGE-API\
  - C:\ProgramData\SAGE-API\

## Suporte

- Email: equipe@etec.sp.gov.br
- Telefone: (11) 5678-9012

## Documentação Adicional

- Consulte a documentação técnica em docs/
- Acesse a API e documentação Swagger em http://localhost:3000/docs
