const express = require("express");
const cors = require("cors");
const loadRoutes = require("./config/loadRoutes");
const env = require("./config/environment");
global.db = require("./config/knex");
const path = require("path");

const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./src/docs/swagger.yml");

const app = express();

// Configuração de CORS com variáveis de ambiente
const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (Postman, curl, etc.)
    if (!origin) return callback(null, true);

    if (env.cors.origins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🔒 CORS bloqueado para origem: ${origin}`);
      callback(new Error(`CORS policy: Origin not allowed: ${origin}`));
    }
  },
  methods: env.cors.methods,
  credentials: env.cors.credentials,
};

app.use(cors(corsOptions));
app.use(express.json());

// Rota para Swagger
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
console.log(`📚 Acesse a documentação Swagger em: http://localhost:${env.server.port}/docs`);

// Serve arquivos estáticos da pasta "uploads"
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
console.log(`📁 Arquivos estáticos disponíveis em: http://localhost:${env.server.port}/uploads`);

console.log("🔧 Diretório atual:", process.cwd());
console.log("🚀 Server node.js iniciou");
console.log(`🌍 Ambiente: ${env.server.nodeEnv}`);
console.log(`📋 CORS Origins permitidas: ${env.cors.origins.join(", ")}`);

// Rotas da aplicação
loadRoutes(app);

module.exports = app;
