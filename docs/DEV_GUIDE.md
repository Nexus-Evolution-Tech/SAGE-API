npm run dev            # Com nodemon (reload automático)
npm run setup          # Apenas setup do banco
git log --oneline      # Ver commits (resumido)
git diff               # Ver mudanças
git branch             # Listar branches
git branch -d branch   # Deletar branch local
git clean -fd          # Remove arquivos não-tracked
git commit -m "chore: version bump 1.1.0"
git push origin develop

# Guia de Desenvolvimento (dev_guide.md)

## Instalação e Setup Inicial

1. Clone o repositório:
   ```bash
   git clone https://github.com/seu-usuario/SAGE-API.git
   cd SAGE-API
   ```
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Configure as variáveis de ambiente:
   ```bash
   cp .env.example .env
   ```
4. Inicie o sistema:
   ```bash
   npm start
   ```
   O sistema estará disponível em http://localhost:3000

- O comando `npm install` executa automaticamente o setup inicial, criando o arquivo `.env`, detectando o MySQL, criando o banco de dados e tabelas, e inserindo dados padrão.
- Para desenvolvimento com hot reload, utilize:
   ```bash
   npm run dev
   ```

## Estrutura do Projeto

- src/: código-fonte principal (controllers, rotas, serviços, middlewares, utilitários)
- database/: scripts SQL e schema
- docs/: documentação
- api/: coleções Postman
- resources/: recursos para build (MySQL portável)
- config.json: configuração centralizada
- package.json: dependências e scripts

## Desenvolvimento de Features

1. Crie uma branch:
   ```bash
   git checkout -b feature/nome-da-feature
   ```
2. Faça as alterações seguindo os padrões do projeto.
3. Teste localmente:
   ```bash
   npm start
   # Acesse http://localhost:3000/docs para testar as APIs
   ```
4. Commit e push:
   ```bash
   git add .
   git commit -m "mensagem clara"
   git push origin feature/nome-da-feature
   ```
5. Abra um Pull Request no GitHub.

## Gerar Executável para Distribuição (Windows)

Pré-requisitos:
- Instale o empacotador:
  ```bash
  npm install -g pkg
  ```
- Baixe o MySQL portável (ZIP) em https://dev.mysql.com/downloads/mysql/ e extraia em `./resources/mysql-portable/`

Passos para gerar o EXE:
```bash
rm -rf dist
npm install --production
npm run build:windows
# O executável estará em dist/SAGE-API-INSTALLER.exe
```

Teste o EXE em uma máquina limpa (sem Node.js ou MySQL instalado). O sistema deve abrir em http://localhost:3000 e criar o banco de dados automaticamente.

## Publicar no GitHub Releases

1. Crie uma tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. No GitHub, acesse Releases, clique em "Draft a new release", selecione a tag, preencha título e descrição, e faça upload do executável.

## Comandos Úteis

- Setup inicial: `npm install`
- Desenvolvimento com hot reload: `npm run dev`
- Executar em produção local: `npm start`
- Gerar executável: `npm run build:windows`
- Reset do banco de dados: `npm run reset-db`
- Executar setup manualmente: `npm run setup`

## Dúvidas Frequentes

- O banco de dados é criado automaticamente? Sim, no primeiro `npm install`. Para resetar: `npm run reset-db`
- Como mudar as credenciais padrão? Veja a função `createDefaultUser()` em setup-sage-api.js
- Preciso incluir algo no executável? Adicione em `package.json` na seção `pkg.assets`
- Como atualizar o MySQL portável? Baixe a nova versão, extraia em `./resources/mysql-portable/` e gere o EXE novamente.

## Checklist de Deploy

- Todas as features testadas localmente
- npm start funciona sem erros
- Documentação atualizada
- Versão atualizada em config.json
- Changelog escrito

## Referências
- Express.js Docs: https://expressjs.com/
- Node.js Best Practices: https://github.com/goldbergyoni/nodebestpractices
- Git Workflow: https://guides.github.com/introduction/flow/
- Semantic Versioning: https://semver.org/
# docs:     Documentação

