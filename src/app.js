const express = require("express");
const cors = require("cors");
const loadRoutes = require("./config/loadRoutes");
global.db = require("./config/knex");
const path = require("path");

// 👉 Adicione essas duas linhas:
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./src/docs/swagger.yml"); // Certifique-se do caminho

const app = express();

// Configuração de CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://editor.swagger.io",
  "http://localhost:18512",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Permitir requisições sem origin (Postman, curl, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🔒 CORS bloqueado para origem: ${origin}`);
      callback(new Error(`CORS policy: Origin not allowed: ${origin}`));
    }
  },
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// 👉 Rota para Swagger:
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
console.log("Acesse a documentação Swagger em: http://localhost:3000/docs");

// Serve arquivos estáticos da pasta "upload"
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
console.log("Arquivos estáticos disponíveis em: http://localhost:3000/uploads");

console.log("Diretório atual:", process.cwd());
console.log("Server node.js iniciou(__dirname):", __dirname);

// Rotas da aplicação
loadRoutes(app);

module.exports = app;
