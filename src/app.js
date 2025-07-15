// src/app.js
const express = require('express');
const cors = require('cors');
const loadRoutes = require('./config/loadRoutes');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const app = express(); // ✅ INICIALIZAR ANTES DE USAR

// ✅ Lista de origens permitidas
const allowedOrigins = [
  'http://localhost:3001',
  'http://localhost:3000',
  'http://172.19.0.1:3001',
  'http://localhost:18512',
  'https://editor.swagger.io'
];

// ✅ Opções do CORS
const corsOptions = {
  origin: function (origin, callback) {
    // Permite ferramentas como Postman e curl
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🔒 CORS bloqueado para origem: ${origin}`);
      callback(new Error(`CORS policy: Origin not allowed: ${origin}`));
    }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  credentials: true
};

// ✅ Aplicar CORS
app.use(cors(corsOptions));
app.use(express.json());

// ✅ Swagger
const swaggerDocument = YAML.load('./src/docs/swagger.yml');
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
console.log('Acesse a documentação Swagger em: http://localhost:3000/docs');

// ✅ Arquivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
console.log('Arquivos estáticos em: http://localhost:3000/uploads');

// ✅ Rotas
loadRoutes(app);

module.exports = app;
