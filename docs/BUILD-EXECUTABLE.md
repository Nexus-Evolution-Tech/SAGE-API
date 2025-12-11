# Guia: Como Gerar Executável (.exe)

## Visão Geral

Este guia mostra como transformar o SAGE-API em um **executável único para Windows** que pode ser distribuído para as escolas.

Fluxo do processo:
```
Código-fonte (Node.js + MySQL)
         ↓
    [pkg] - Empacotador
         ↓
   SAGE-API.exe (150-200MB)
         ↓
   Usuário executa
```

---

## Pré-requisitos

```bash
# Instalar pkg (empacotador Node.js → EXE)
npm install -g pkg

# Ou instalar localmente no projeto
npm install --save-dev pkg
```

---

## Passos para Gerar EXE

### Passo 1: Preparar Arquivos

```bash
# Certifique-se que tudo está limpo
rm -rf node_modules
npm install --production  # Só dependências de produção

# Verificar se MySQL portável existe
# Deve estar em: ./resources/mysql-portable.zip
ls -lh ./resources/mysql-portable.zip
```

### Passo 2: Configurar package.json

Adicione scripts de build no `package.json`:

```json
{
  "scripts": {
    "start": "node start-sage.js",
    "dev": "nodemon index.js",
    "setup": "node setup-sage-api.js",
    "run": "node run.js",
    "build": "pkg . --targets win-x64,macos-x64,linux-x64 --output sage-api",
    "build:windows": "pkg . --targets win-x64 --output SAGE-API-INSTALLER",
    "build:macos": "pkg . --targets macos-x64 --output SAGE-API",
    "build:linux": "pkg . --targets linux-x64 --output sage-api"
  },
  "pkg": {
    "scripts": [
      "index.js",
      "start-sage.js",
      "setup-sage-api.js",
      "install.js",
      "run.js"
    ],
    "assets": [
      "package.json",
      "config.json",
      "database/**/*",
      "src/**/*",
      "resources/**/*"
    ],
    "targets": ["win-x64"],
    "outputPath": "dist",
    "compress": "Brotli"
  }
}
```

### Passo 3: Gerar Executável

**Para Windows:**
```bash
npm run build:windows

# Resultado: SAGE-API-INSTALLER.exe
```

**Para macOS:**
```bash
npm run build:macos

# Resultado: SAGE-API (aplicação macOS)
```

**Para Linux:**
```bash
npm run build:linux

# Resultado: sage-api (executável Linux)
```

**Todos os SOs:**
```bash
npm run build

# Resultado:
# - sage-api-win-x64.exe
# - sage-api-macos-x64
# - sage-api-linux-x64
```

---

## Estrutura do Executável Gerado

```
SAGE-API-INSTALLER.exe (150-200MB)
│
├── [Código Node.js comprimido]
│   ├── index.js
│   ├── setup-sage-api.js
│   ├── install.js
│   ├── run.js
│   ├── src/ (todas as rotas e controllers)
│   └── node_modules/ (todas as dependências)
│
├── [Assets estáticos]
│   ├── database/sage.sql
│   ├── config.json
│   └── resources/mysql-portable.zip
│
└── [Metadados pkg]
```

---

## Personalização do Executável

### Adicionar Ícone (Windows)

```bash
# 1. Criar ícone em 256x256 (ICO)
# 2. Adicionar ao package.json
npm install --save-dev rcedit

# 3. Script para adicionar ícone
"build:windows:icon": "pkg . --targets win-x64 --icon ./assets/logo.ico --output SAGE-API-INSTALLER"
```

### Adicionar Informações de Versão

```json
{
  "pkg": {
    "productName": "SAGE-API",
    "productVersion": "1.0.0",
    "fileVersion": "1.0.0.0",
    "companyName": "ETEC Taboão da Serra",
    "description": "Sistema de Gestão Escolar - Monitoramento e Automações"
  }
}
```

---

## Configurações Importantes

### Entrada Principal

```javascript
// O pkg vai procurar por "bin" no package.json
{
  "bin": "install.js",  // ← Executar install.js primeiro
  "pkg": {
    "scripts": ["*.js", "src/**/*.js"]
  }
}
```

**Fluxo:**
```
1. User executa: SAGE-API-INSTALLER.exe
2. Executa: install.js
3. install.js cria diretórios
4. install.js executa: setup-sage-api.js
5. setup-sage-api.js cria banco e config
6. Tudo pronto!
```

### Tamanho do Executável

| Componente | Tamanho |
|-----------|---------|
| Node.js | 40MB |
| node_modules | 80MB |
| MySQL portável | 300MB (ZIP) |
| Código + DB schema | 10MB |
| **Total** | **~150-200MB** |

Dica: Se achar grande demais, use compressão Brotli (já configurado)

---

## Script Automatizado (Recomendado)

Crie um arquivo `build.sh` (macOS/Linux) ou `build.bat` (Windows):

**build.bat (Windows):**
```batch
@echo off
echo ========================================
echo SAGE-API - Build Automático
echo ========================================

REM Limpar versão anterior
if exist dist rmdir /s /q dist
mkdir dist

REM Instalar dependências
echo Instalando dependências...
call npm install --production

REM Gerar executável
echo Gerando executável...
call npm run build:windows

echo.
echo ========================================
echo Build concluído!
echo Arquivo: dist\SAGE-API-INSTALLER.exe
echo ========================================
pause
```

**build.sh (macOS/Linux):**
```bash
#!/bin/bash

echo "========================================"
echo "SAGE-API - Build Automático"
echo "========================================"

# Limpar versão anterior
rm -rf dist
mkdir dist

# Instalar dependências
echo "Instalando dependências..."
npm install --production

# Gerar executável
echo "Gerando executável..."
npm run build:windows

echo ""
echo "========================================"
echo "Build concluído!"
echo "Arquivo: dist/SAGE-API-INSTALLER.exe"
echo "========================================"
```

**Usar:**
```bash
# Windows
./build.bat

# macOS/Linux
bash build.sh
```

---

## Testar Executável Antes de Distribuir

### Windows Limpo (Recomendado)

1. **Máquina virtual limpa** (sem Node.js, sem MySQL)
2. Executar: `SAGE-API-INSTALLER.exe`
3. Verificar:
   - ✅ Instalação completa
   - ✅ Atalho criado na desktop
   - ✅ MySQL extrai e funciona
   - ✅ Banco de dados criado
   - ✅ Sistema abre em browser
   - ✅ APIs respondem

Checklist de testes:

- [ ] Executável tem tamanho correto (~150MB)
- [ ] Executa sem erros em Windows 10/11
- [ ] Instalação leva menos de 2 minutos
- [ ] MySQL portável extrai corretamente
- [ ] Banco de dados criado automaticamente
- [ ] Dados salvos em C:\ProgramData\SAGE-API\
- [ ] Atalho funciona na desktop
- [ ] Browser abre automaticamente
- [ ] APIs funcionam (http://localhost:3000/docs)
- [ ] Pode parar e reiniciar sem problemas
- [ ] Dados persistem após restart

---

## 📦 Nomes e Versionamento

###nvenção de Nomenclatura

```
SAGE-API-v{versão}-MySQL{versão}.exe

Exemplos:
├── SAGE-API-v1.0-MySQL8.0.44.exe    (versão inicial)
├── SAGE-API-v1.1-MySQL8.0.45.exe    (bug fixes + MySQL atualizado)
├── SAGE-API-v2.0-MySQL8.0.46.exe    (novas features)
└── SAGE-API-v2.0-MySQL8.1.0.exe     (MySQL maior atualizado)
```

### Changelog (importante!)

```markdown
## SAGE-API v1.0
- Initial release
- MySQL 8.0.44 included
- Local database only
- Future sync ready

## SAGE-API v1.1
- MySQL updated to 8.0.45
- Bug fixes
- Performance improvements
```

---

## 🔐 Distribuição Segura

###tes de Enviar para Escolas

```bash
# 1. Gerar hash para verificar integridade
sha256sum SAGE-API-v1.0-MySQL8.0.44.exe > SAGE-API-v1.0.sha256

# 2. Documentação incluída
- README.md (como instalar)
- MYSQL-PORTABLE.md (info técnica)
- CHANGELOG.md (o que mudou)
- SUPORTE.md (como contatar)

# 3. Preparar upload
zip -r SAGE-API-v1.0-INSTALL.zip \
  SAGE-API-v1.0-MySQL8.0.44.exe \
  SAGE-API-v1.0.sha256 \
  README.md \
  docs/
```

---

## 📞 Troubleshooting

###ecutável muito grande (>500MB)

**Solução:**
```json
{
  "pkg": {
    "compress": "Brotli"  // Ativar compressão
  }
}
```

### Erro "Cannot find module"

**Solução:**
```json
{
  "pkg": {
    "assets": [
      "database/**/*",
      "src/**/*",
      ".env.production"
    ]
  }
}
```

### Node.js não encontrado ao executar

**Solução:** pkg já inclui Node.js, não precisa instalar

---

## ✨ Próximos Passos

1. Próximos Passos

1. Testar em desenvolvimento (npm start)
2. Testar com `npm run build:windows`
3. Testar executável em Windows limpo
4. Criar documentação de instalação
5. Distribuir para escolas
6. Monitorar primeira instalação
7. Coletar feedback
8.