# SAGE-API - Sistema de Gestão Escolar

Sistema de Gestão, Monitoramento e Automação para ETEC Taboão da Serra

---

## Para Desenvolvedores

```bash
git clone https://github.com/seu-usuario/SAGE-API.git
cd SAGE-API
cp .env.example .env (altere as informações do banco)
npm install
npm start
```

Acesse: http://localhost:3000

Documentação: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)

---

## Para Instalar em Escolas

Duplo-clique em: `SAGE-API-v1.0-MySQL8.0.44.exe`

Aguarde 3-5 minutos. Sistema abrirá automaticamente em http://localhost:3000

Documentação: [docs/INSTALLATION-GUIDE.md](docs/INSTALLATION-GUIDE.md)

---

## Documentação

- [GETTING-STARTED.md](docs/GETTING-STARTED.md) - Setup, desenvolvimento e criar EXE
- [INSTALLATION-GUIDE.md](docs/INSTALLATION-GUIDE.md) - Instalar em escolas
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) - Padrões de código
- [BUILD-EXECUTABLE.md](docs/BUILD-EXECUTABLE.md) - Detalhes técnicos do EXE

---

## Características

- Sistema Local (dados no PC da escola)
- Offline-First (funciona sem internet)
- MySQL Portável (sem instalação)
- Zero Configuração (setup automático)
- API REST (integração com catraca e dispositivos)
- Swagger/OpenAPI (http://localhost:3000/docs)

---

## Comandos

```bash
npm install        # Setup inicial
npm start          # Inicia sistema
npm run dev        # Desenvolvimento (hot reload)
npm run reset-db   # Reset do banco
npm run build:windows  # Gera executável
```

---

## Estrutura

```
src/                # Código-fonte
  ├── controllers/
  ├── routes/
  ├── services/
  └── middlewares/

database/           # Schema SQL
docs/              # Documentação
config.json        # Configuração
```

---

## Suporte

Email: equipe@etec.sp.gov.br  
Telefone: (11) 5678-9012
