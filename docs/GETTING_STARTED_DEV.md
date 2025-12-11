# Getting Started - Para Desenvolvedores

## Setup Inicial

### 1. Clone e Instale

```bash
git clone https://github.com/seu-usuario/SAGE-API.git
cd SAGE-API
npm install
```

**Isso é tudo! Não precisa configurar nada manualmente.**

O `npm install` executa automaticamente o `setup-sage-api.js` via `postinstall`, que faz:
- ✅ Cria arquivo `.env` (se não existir)
- ✅ Detecta MySQL (Windows/macOS/Linux)
- ✅ Cria banco de dados `sage`
- ✅ Cria todas as tabelas
- ✅ Insere dados padrão (usuário admin/admin)

**Resultado:** Sistema completamente configurado e pronto para usar!

### 2. Inicie o Desenvolvimento

```bash
npm start
```

Sistema abrirá automaticamente em http://localhost:3000

Nenhuma configuração manual necessária. Nem em outro PC, nem em outro clone. Sempre funciona igual.

**Ou use hot reload:**

```bash
npm run dev
```

---

## Fluxo de Desenvolvimento

### Estrutura de Pastas

```
src/
├── controllers/    (lógica de negócio)
├── routes/         (definição de rotas)
├── services/       (serviços reutilizáveis)
├── middlewares/    (autenticação, validação)
└── utils/          (funções auxiliares)

database/
├── sage.sql        (schema completo)
└── *.sql           (scripts específicos)

docs/
├── BUILD-EXECUTABLE.md (gerar EXE)
├── INSTALLATION-GUIDE.md (instalar em escolas)
└── DEVELOPMENT.md (padrões de código)
```

### Desenvolvimento de Features

1. Crie uma branch:
   ```bash
   git checkout -b feature/nome-da-feature
   ```

2. Faça as alterações seguindo os padrões em `docs/DEVELOPMENT.md`

3. Teste localmente:
   ```bash
   npm start
   # Acesse http://localhost:3000/docs para testar APIs
   ```

4. Commit e push:
   ```bash
   git add .
   git commit -m "mensagem clara"
   git push origin feature/nome-da-feature
   ```

5. Abra Pull Request

---

## Gerar Executável para GitHub Releases

### Pré-requisitos

1. **Instalar pkg globalmente:**
   ```bash
   npm install -g pkg
   ```

2. **Baixar MySQL Portável:**
   - Acesse https://dev.mysql.com/downloads/mysql/
   - Procure por "MySQL on Windows (ZIP Archive)"
   - Baixe versão 8.0.44 ou superior
   - Extraia em: `./resources/mysql-portable/`

   OU use:
   ```bash
   mkdir -p resources
   # Baixe manualmente e extraia em resources/mysql-portable/
   ```

### Gerar EXE

```bash
# Limpar build anterior
rm -rf dist

# Instalar dependências de produção
npm install --production

# Gerar executável Windows
npm run build:windows

# Resultado: dist/SAGE-API-INSTALLER.exe
```

### Testar EXE Antes de Distribuir

1. **Máquina virtual ou PC limpo** (sem Node.js ou MySQL instalado)
2. Duplo-clique em `dist/SAGE-API-INSTALLER.exe`
3. Aguarde 3-5 minutos
4. Verifique:
   - [ ] Sistema abre em http://localhost:3000
   - [ ] Atalho criado na desktop
   - [ ] Login funciona (admin/admin)
   - [ ] Swagger acessível em /docs
   - [ ] Banco de dados criado corretamente

---

## Publicar no GitHub Releases

### 1. Preparar Release

```bash
# Criar tag
git tag v1.0.0

# Fazer push da tag
git push origin v1.0.0
```

### 2. Acessar GitHub

1. Vá para: https://github.com/seu-usuario/SAGE-API/releases
2. Clique em "Draft a new release"
3. Selecione a tag criada (v1.0.0)
4. Preencha título e descrição:

   **Título:**
   ```
   SAGE-API v1.0.0
   ```

   **Descrição:**
   ```markdown
   ## Novidades
   - Setup automático
   - MySQL portável incluído
   - Zero configuração

   ## Download
   - SAGE-API-INSTALLER.exe (150MB) - Windows 64-bit

   ## Instalação
   Duplo-clique no EXE e aguarde 3-5 minutos.
   Documentação: veja INSTALLATION-GUIDE.md
   ```

### 3. Upload do Executável

1. Clique em "Attach binaries..."
2. Selecione: `dist/SAGE-API-INSTALLER.exe`
3. Clique em "Publish release"

---

## Ciclo Completo (Resumido)

```
git checkout -b feature/nova-feature
  ↓
Desenvolver e testar localmente (npm start)
  ↓
git commit && git push
  ↓
Abrir Pull Request & Review
  ↓
Merge na main
  ↓
npm run build:windows (gera EXE)
  ↓
Testar EXE em máquina limpa
  ↓
git tag v1.1.0 && git push origin v1.1.0
  ↓
GitHub Release (upload EXE)
  ↓
Escolas baixam e instalam!
```

---

## Comandos Úteis

```bash
# Setup inicial
npm install

# Desenvolvimento com hot reload
npm run dev

# Executar em produção local
npm start

# Gerar executável
npm run build:windows
npm run build:macos
npm run build:linux

# Reset do banco de dados
npm run reset-db

# Executar setup manualmente
npm run setup
```

---

## Dúvidas Frequentes

**P: O banco de dados é criado automaticamente?**
R: Sim, no primeiro `npm install`. Se precisar resetar: `npm run reset-db`

**P: Como mudar as credenciais padrão (admin/admin)?**
R: Localize em `setup-sage-api.js` na função `createDefaultUser()`

**P: Preciso incluir algo no executável?**
R: Adicione em `package.json` na seção `pkg.assets`

**P: Como atualizar MySQL portável?**
R: Baixe a nova versão, extraia em `./resources/mysql-portable/` e regere o EXE

---

## Próximos Passos

- Ler `docs/DEVELOPMENT.md` para padrões de código
- Ler `docs/BUILD-EXECUTABLE.md` para detalhes técnicos
- Ler `docs/INSTALLATION-GUIDE.md` para entender experiência do usuário
