# Guia de Desenvolvimento - SAGE-API

Padrões, boas práticas e fluxo de trabalho profissional para desenvolvimento

---

## Índice

1. [Antes de Começar](#antes-de-começar)
2. [Estrutura do Projeto](#estrutura-do-projeto)
3. [Fluxo de Trabalho](#fluxo-de-trabalho)
4. [Padrões de Código](#padrões-de-código)
5. [Git Workflow](#git-workflow)
6. [Checklist de Deploy](#checklist-de-deploy)

---

## Antes de Começar

### Instalação Inicial

```bash
# 1. Clone o repositório
git clone https://github.com/seu-usuario/SAGE-API.git
cd SAGE-API

# 2. Instale dependências
npm install

# 3. Configure variáveis de ambiente
cp .env.example .env  # (se houver)

# 4. Inicie o desenvolvimento
npm start
# ou com hot reload
npm run dev
```

### Verificar Setup

```bash
# Tudo deve estar OK
npm start
# Deve abrir em http://localhost:3000
# Swagger disponível em http://localhost:3000/docs
```

---

## Estrutura do Projeto

```
SAGE-API/
│
├── 📁 src/                      # Código-fonte principal
│   ├── app.js                  # App Express
│   ├── config/                 # Configuração
│   ├── controllers/            # Controllers
│   ├── routes/                 # Rotas
│   ├── services/               # Serviços/Lógica
│   ├── middlewares/            # Middlewares
│   ├── uploads/                # Upload de arquivos
│   ├── utils/                  # Utilitários
│   └── docs/                   # Documentação Swagger
│
├── 📁 database/                 # Scripts de banco de dados
│   ├── sage.sql                # Schema principal
│   └── procedures.sql          # Procedures armazenadas
│
├── 📁 docs/                     # Documentação do projeto
│   ├── BUILD-EXECUTABLE.md     # Como gerar EXE
│   ├── MYSQL-PORTABLE.md       # MySQL portável
│   ├── INSTALLATION-GUIDE.md   # Instalação
│   └── NEXT-STEPS.md           # Próximos passos
│
├── 📁 api/                      # Postman collections
│   └── *.postman_collection.json
│
├── 📁 resources/                # Recursos para build
│   └── mysql-portable.zip      # (será adicionado antes de build)
│
├── 📁 logs/                     # Logs do sistema (não commitado)
├── 📁 dist/                     # Build output (não commitado)
│
├── 📄 config.json               # Configuração centralizada
├── 📄 package.json              # Dependências & scripts
├── 📄 .gitignore                # Git ignore rules
├── 📄 .editorconfig             # Padrões de editor
├── 📄 README.md                 # Documentação principal
├── 📄 DEVELOPMENT.md            # Este arquivo
│
├── 📄 start-sage.js             # Entry point (primeiro acesso)
├── 📄 setup-sage-api.js         # Setup automático
├── 📄 install.js                # Instalador
├── 📄 run.js                    # Launcher
├── 📄 index.js                  # Servidor principal
│
└── 📁 .git/                     # Git repository
```

---

## Fluxo de Trabalho

### 1️⃣ Começar Nova Feature

```bash
# Crie branch descritivo
git checkout -b feature/nome-da-feature

# Ou bugfix
git checkout -b bugfix/nome-do-bug

# Desenvolva normalmente
npm start  # ou npm run dev
```

### 2️⃣ Padrões de Commit

```bash
# Commits descritivos em inglês ou português
git add .
git commit -m "feat: adicionar nova rota de alunos"

# Prefixos úteis:
# feat:     Nova feature
# fix:      Bugfix
# docs:     Documentação
# refactor: Refatoração
# test:     Testes
# chore:    Limpeza/manutenção
```

### 3️⃣ Antes de Fazer Push

```bash
# 1. Certifique-se que npm start funciona
npm start
# ✅ Sem erros

# 2. Teste suas mudanças
# (manual testing no browser)

# 3. Limpe logs/temporários
rm -f .env.local
rm -rf logs/*

# 4. Push para GitHub
git push origin feature/nome-da-feature
```

### 4️⃣ Pull Request

1. Abra PR no GitHub
2. Descreva as mudanças
3. Link issues relacionadas
4. Merge quando aprovado

---

## Padrões de Código

### JavaScript

```javascript
// ✅ BOM: Usar const por padrão
const express = require('express');

// ✅ BOM: Nomes descritivos
const getUserById = (userId) => {
  // ...
};

// ❌ RUIM: Nomes genéricos
const get = (id) => {
  // ...
};

// ✅ BOM: Arrow functions para callbacks
router.get('/', (req, res) => {
  // ...
});

// ✅ BOM: Await em async functions
const data = await getFromDatabase();

// ✅ BOM: Validação de input
if (!email || !email.includes('@')) {
  return res.status(400).json({ error: 'Invalid email' });
}
```

### Estrutura de Controller

```javascript
// src/controllers/userController.js

const getUsers = async (req, res) => {
  try {
    const users = await userService.getAll();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    const { email, name } = req.body;
    
    // Validar
    if (!email || !name) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    
    // Criar
    const user = await userService.create({ email, name });
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getUsers, createUser };
```

---

## Git Workflow

### Branches

```
main (produção)
  └── develop (staging)
       └── feature/* (novas features)
       └── bugfix/* (correções)
```

### Workflow Típico

```bash
# 1. Começar do develop
git checkout develop
git pull origin develop

# 2. Criar branch
git checkout -b feature/nova-funcionalidade

# 3. Desenvolver e commitar
git add .
git commit -m "feat: descrição"

# 4. Antes de push, atualizar
git pull origin develop
git push origin feature/nova-funcionalidade

# 5. Abrir PR no GitHub
# (GitHub web → New Pull Request)

# 6. Após aprovação, merge no GitHub
```

---

## Comandos Úteis

### Desenvolvimento

```bash
npm start              # Inicia sistema (auto-setup)
npm run dev            # Com nodemon (reload automático)
npm run setup          # Apenas setup do banco
npm run reset-db       # Reset completo (dev only!)
```

### Git

```bash
git status             # Ver status
git log --oneline      # Ver commits (resumido)
git diff               # Ver mudanças
git branch             # Listar branches
git branch -d branch   # Deletar branch local
```

### Limpeza

```bash
# Remover arquivos temporários (ANTES de push)
rm -rf node_modules
rm -rf dist
rm -f .env
rm -f .setup-complete
git clean -fd          # Remove arquivos não-tracked
```

---

## Checklist de Deploy

Antes de gerar o EXE final:

```
[ ] Todas as features testadas localmente
[ ] npm start funciona sem erros
[ ] Swagger /docs carregando
[ ] Dados persistem após restart
[ ] Sem console.logs de debug
[ ] Sem arquivos temporários
[ ] .gitignore atualizado
[ ] package.json limpo
[ ] config.json correto
[ ] Documentação atualizada
[ ] Changelog escrito (docs/CHANGELOG.md)
[ ] Versão bumped (config.json version++)
```

---

## 🚀 Quando Terminar as Features

### Passo 1: Preparar Versão

```bash
# Atualizar versão em config.json
# "version": "1.0.0" → "1.1.0"

# Testar tudo
npm start
# ✅ Tudo funciona

# Commit final
git add .
git commit -m "chore: version bump 1.1.0"
git push origin develop
```

### Passo 2: Gerar EXE

Seguir [docs/NEXT-STEPS.md](NEXT-STEPS.md)

```bash
# 1. Preparar MySQL portável
mkdir -p resources
# Baixa: https://dev.mysql.com/downloads/mysql/
# Extrai em: ./resources/mysql-portable/

# 2. Gerar EXE
npm install --production
npm run build:windows

# 3. Testar em Windows limpo

# 4. Publicar em GitHub Releases
```

---

## 📚 Referências

- [Express.js Docs](https://expressjs.com/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Git Workflow](https://guides.github.com/introduction/flow/)
- [JavaScript Naming](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)

---

## 💡 Dicas Profissionais

1. **Commit frequentemente** - Pequenos commits são mais fáceis de revisar
2. **Sempre teste antes de push** - `npm start` deve funcionar
3. **Limpe antes de commitar** - Remove temporários
4. **Descreva bem seus commits** - Futuros você agradece
5. **Use branches** - Nunca develop/main direto
6. **Documente mudanças** - README, comentários, commits
7. **Atualize versão** - Siga [Semantic Versioning](https://semver.org/)

---

**Bom desenvolvimento! 🚀**

