# SAGE-API — Guia Único

<div align="center">

API para gestão escolar integrada com sistemas de controle de acesso.

**🟠 ALFA EM HOMOLOGAÇÃO — AINDA NÃO DISTRIBUIR**

[![Node](https://img.shields.io/badge/Node.js-24_LTS-green)](https://nodejs.org/)
[![MySQL](https://img.shields.io/badge/MySQL-8.4_LTS-orange)](https://www.mysql.com/)

</div>

---

## 🎯 Estado da homologação

O backend possui suíte automatizada em MySQL 8.4. O CI Windows nativo já prova o layout e os
contratos, mas a VM Windows 11, a recuperação do MySQL e o hardware IDBlock real ainda são gates
abertos. Consulte `docs/planejamento/specs/F8-instalador-alpha-campo.md` e
`docs/HANDOFF-WINDOWS-VM.md`.

- ✅ Setup explícito com ledger e falha fechada
- ✅ Sincronização com catracas ControlID
- ✅ Geração de QR Code e RFID
- ✅ Importação de dados em massa (Excel)
- ⚠️ Compatibilidade Windows ainda precisa de prova em VM limpa; o último CI falhou no recovery do MySQL
- ⚠️ Release público depende de assinatura e auditoria de dependências

**Ver detalhes**: [spec do instalador](./docs/planejamento/specs/F8-instalador-alpha-campo.md)

---

## 🚀 Início Rápido (Windows)

```bash
# 1. Instalar dependências (cria pastas, copia .env)
npm install

# 2. Configurar .env (apenas 2 linhas)
# DB_PASSWORD=sua_senha_mysql
# JWT_SECRET=sua_chave_32_caracteres_ou_mais

# 3. Provisionar com a credencial migradora
npm run setup:db

# 4. Iniciar com a credencial de runtime
npm start

# 5. Acessar
# Swagger: http://localhost:3000/docs
# Health: http://localhost:3000/health
```

**Tempo de instalação**: ~3-5 minutos  
**Guia detalhado**: [handoff da VM Windows](./docs/HANDOFF-WINDOWS-VM.md)

---

## 📚 Documentação Disponível

| Documento | Descrição |
|-----------|-----------|
| [Spec do instalador](./docs/planejamento/specs/F8-instalador-alpha-campo.md) | Escopo, gates e bloqueios do instalador |
| [Handoff da VM Windows](./docs/HANDOFF-WINDOWS-VM.md) | Estado executável para continuar a validação |
| [Achados do instalador](./docs/planejamento/ACHADOS-INSTALADOR.md) | Defeitos de bootstrap já verificados |
| [/docs](http://localhost:3000/docs) | Swagger API (após iniciar) |

---

## Sobre o Projeto

Sistema completo de gestão escolar desenvolvido para o **Centro de Paula Souza**, integrando informações acadêmicas com controle de acesso através de catracas **Control iD**. A API gerencia desde dados básicos de pessoas até registros detalhados de entrada e saída.

### Principais Funcionalidades

- **Gestão de Pessoas**: Alunos, professores, administradores e responsáveis
- **Controle Acadêmico**: Escolas, cursos, turmas, disciplinas e aulas
- **Controle de Acesso**: Integração com catracas Control iD (sincronização automática)
- **QR Code/RFID**: Geração automática de credenciais de acesso
- **Importação**: Upload em massa via Excel (5 abas suportadas)
- **Relatórios**: Registros de entrada/saída e frequência
- **Jobs Automáticos**: Sincronização de pendentes, health checks
- **Validações**: Regras de negócio e consistência de dados
- **WebSocket**: Notificações em tempo real

---

## Stack Tecnológica

### Backend
- **Runtime**: Node.js 24
- **Framework**: Express.js
- **Database**: MySQL 8.4
- **Query Builder**: Knex.js
- **Autenticação**: bcrypt

### Integrações
- **HTTP Client**: Axios (API Control iD)
- **CORS**: Configuração avançada para múltiplas origens
- **Development**: Nodemon para hot-reload

### Documentação
- **API Docs**: OpenAPI 3.0 (Swagger)
- **Collections**: Postman (12 coleções organizadas)
- **Database**: DBML + SQL completo

---

## Arquitetura do Projeto

```
📦 SGC-API/
├── 📁 api/                          # Documentação e Collections
│   ├── 📄 checklyapi.yml           # OpenAPI/Swagger spec
│   └── 📄 *.postman_collection.json # Collections organizadas por entidade
├── 📁 database/                     # Scripts e Modelagem
│   ├── 📄 sage.sql                 # Schema-base do banco
│   ├── 📄 checkly.dbml             # Modelagem DBML
│   ├── �️ ChecklyDER.png           # Diagrama ER visual
│   └── 📄 dados_etec_taboao.sql    # Dados de exemplo
├── 📁 src/
│   ├── 📁 config/                   # Configurações centralizadas
│   │   ├── 📄 database.js          # Pool de conexões MySQL
│   │   ├── 📄 knex.js              # Configuração Knex
│   │   └── 📄 loadRoutes.js        # Carregamento dinâmico de rotas
│   ├── 📁 controllers/             # Lógica de negócio
│   │   ├── 📄 genericControllerFactory.js  # Factory pattern
│   │   └── 📄 *Controller.js       # Controllers específicos
│   ├── 📁 docs/                     # Documentação
│   │   ├── 📄 swagger.yml          # Documentação Swagger da API
│   ├── 📁 routes/                  # Definição de rotas
│   │   ├── 📄 genericRoutesFactory.js      # Factory para rotas CRUD
│   │   └── 📄 *Routes.js           # Rotas por entidade
│   ├── 📁 services/                # Regras de negócio complexas
│   │   ├── 📄 deviceService.js     # Integração Control iD
│   │   └── 📄 *Service.js          # Services específicos
│   └── 📁 utils/                   # Utilitários reutilizáveis
│       ├── 📄 criptografia.js      # Funções de hash/criptografia
│       ├── 📄 errorHandling.js     # Tratamento de erros
│       └── 📄 generic-db-utils.js  # Operações genéricas de DB
├── 📄 index.js                     # Entry point da aplicação
└── 📄 package.json                 # Dependências e scripts
```

---

## Instalação e Configuração

### Pré-requisitos
- Node.js 24
- MySQL 8.4
- Git

### 1. Clone o repositório
```bash
git clone <repository-url>
cd SGC-API
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure o ambiente
```bash
cp .env.example .env
```

Preencha no `.env` as credenciais migradoras e execute o setup explícito:

```bash
npm run setup:db
```

O serviço em produção deve usar uma conta MySQL separada e restrita. O instalador será
responsável por materializar essa separação.

### 4. Inicie o servidor
```bash
npm start
```

API rodando em `http://localhost:3000`.

---

## Documentação da API

### Endpoints Principais

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `GET` | `/pessoas` | Lista todas as pessoas |
| `POST` | `/pessoas` | Cadastra nova pessoa |
| `GET` | `/dispositivos/status` | Status das catracas |
| `GET` | `/acessos` | Registros de acesso |
| `GET` | `/cursos` | Lista de cursos |
| `GET` | `/turmas` | Lista de turmas |

### Swagger UI
Acesse a documentação interativa em: `http://localhost:3000/docs`

### Collections Postman
12 coleções organizadas na pasta `api/` para testes completos:
- People (Pessoas)
- School (Escolas)
- Course (Cursos)
- Class (Turmas)
- Access (Acessos)
- Devices (Dispositivos)
- E mais...

---

## 🔐 Integração Control iD

### Funcionalidades Implementadas
- ✅ **Autenticação** com dispositivos Control iD
- ✅ **Verificação de status** das catracas
- ✅ **Gestão de sessões** automatizada
- ✅ **Pool de conexões** para múltiplos dispositivos

### Exemplo de Uso
```javascript
// Verificar status de um dispositivo
GET /dispositivos/:id/status

// Resposta
{
  "online": true,
  "session_valid": true,
  "last_check": "2025-06-29T10:30:00Z"
}
```

---

## Validações Implementadas

## 🔎 Sistema de Validações

O projeto implementa um sistema robusto de validações em múltiplas camadas:

### ✅ Validações RegEx Implementadas

| Campo | Padrão | Exemplo Válido | Status |
|-------|--------|----------------|--------|
| 📧 **Email** | RFC 5322 compliant | `usuario@dominio.com.br` | ✅ Implementado |
| 📱 **Telefone** | Nacional BR | `(11) 99999-9999` | ✅ Implementado |
| 🧾 **CPF** | Formato brasileiro | `123.456.789-00` | ✅ Implementado |
| 🪪 **RG** | Alfanumérico BR | `12.345.678-X` | ✅ Implementado |
| 🏫 **CNPJ** | Empresas | `12.345.678/0001-90` | 🔄 Em desenvolvimento |

### 🛡️ Validações de Negócio
- **Integridade referencial**: Verificação de chaves estrangeiras
- **Unicidade**: CPF, email e RG únicos no sistema  
- **Hierarquia de pessoas**: Validação automática de tipos (aluno, professor, admin)
- **Horários acadêmicos**: Validação de conflitos de agenda

---

## 🏗️ Arquitetura e Padrões

### 🔧 Design Patterns Utilizados
- **Factory Pattern**: `genericControllerFactory.js` e `genericRoutesFactory.js`
- **Pool Pattern**: Gerenciamento de conexões MySQL
- **Service Layer**: Separação de responsabilidades
- **Repository Pattern**: Utilitários de banco de dados

### 🗄️ Modelo de Dados
- **Herança por Chave Primária**: Todas as entidades estendem `Pessoa`
- **Relacionamentos**: FK bem definidas entre entidades
- **Auditoria**: Campos de criação e atualização automáticos

---

## 🔧 Desenvolvimento

### Scripts Disponíveis
```bash
npm start          # Inicia servidor com nodemon
npm run setup:db   # Provisiona ou atualiza o schema antes do start
npm run dev        # Nodemon sem gate de schema
npm test          # Executa testes (em desenvolvimento)
```

### 🎯 Estrutura de Desenvolvimento
- **Hot Reload**: Nodemon configurado para desenvolvimento
- **CORS**: Configuração para múltiplas origens (localhost, Swagger, etc)
- **Error Handling**: Sistema centralizado de tratamento de erros
- **Logging**: Sistema de logs estruturado

---

## 🌟 Funcionalidades Avançadas

### 🔄 Carregamento Dinâmico de Rotas
Sistema automatizado que:
- Carrega automaticamente qualquer arquivo `*Routes.js`
- Registra rotas sem configuração manual
- Suporta hot-reload durante desenvolvimento

### 🏭 Factory de Controllers Genéricos
- CRUD automatizado para qualquer entidade
- Validações padronizadas
- Tratamento de erros consistente
- Flexibilidade para customizações específicas

### 🔐 Gestão de Sessões Control iD
- Pool de conexões para múltiplos dispositivos
- Renovação automática de sessões
- Fallback e recuperação de conexão
- Monitoramento de status em tempo real

---

## 📊 Monitoramento e Performance

### 🚀 Otimizações Implementadas
- **Connection Pool**: Reutilização eficiente de conexões MySQL
- **Query Optimization**: Uso do Knex.js para queries otimizadas
- **Memory Management**: Liberação adequada de recursos
- **Error Recovery**: Reconexão automática em falhas

### 📈 Métricas (Planejadas)
- Tempo de resposta por endpoint
- Taxa de sucesso das integrações Control iD
- Uso de memória e CPU
- Logs estruturados para análise

---

## 🚦 Status do Projeto

### ✅ Implementado
- [x] CRUD completo para todas as entidades
- [x] Integração básica com Control iD
- [x] Sistema de validações RegEx
- [x] Documentação OpenAPI/Swagger
- [x] Arquitetura modular e escalável
- [x] Collections Postman organizadas
- [x] Correção de fuso horário

### � Em Desenvolvimento  
- [ ] Sistema de autenticação JWT
- [ ] Filtros avançados para consultas
- [ ] Validações lógicas (CPF, CNPJ válidos)
- [ ] Sistema de logs completo
- [ ] Testes automatizados

### 🎯 Roadmap Futuro
- [ ] API Rate Limiting
- [ ] Cache Redis para consultas frequentes
- [ ] Webhooks para eventos do sistema
- [ ] Dashboard administrativo
- [ ] Relatórios em PDF
- [ ] Backup automatizado

---

## 🤝 Como Contribuir

1. **Fork** o projeto
2. **Clone** sua fork
3. **Crie** uma branch para sua feature (`git checkout -b feature/nova-funcionalidade`)
4. **Commit** suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
5. **Push** para a branch (`git push origin feature/nova-funcionalidade`)
6. **Abra** um Pull Request

### 📋 Convenções de Código
- Use **camelCase** para variáveis e funções
- **PascalCase** para classes e construtores
- Comentários em **português** para contexto de negócio
- Commits em **português** seguindo padrão convencional

---

## 📞 Suporte e Contato

### 🐛 Reportar Bugs
- Abra uma **issue** descrevendo o problema
- Inclua **steps to reproduce**
- Adicione **logs relevantes**

### 💡 Sugestões
- Utilize as **GitHub Discussions** para ideias
- Contribua com **melhorias na documentação**
- Compartilhe **casos de uso** interessantes

---

## 📄 Licença

Este projeto está sob licença **MIT**. Veja o arquivo `LICENSE` para mais detalhes.

---

<div align="center">

**Desenvolvido com ❤️ para o Centro de Paula Souza**

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=flat-square&logo=mysql&logoColor=white)](https://mysql.com/)

</div>
