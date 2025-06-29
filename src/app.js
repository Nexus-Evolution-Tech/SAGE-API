const express = require('express');
const cors = require('cors'); // Importe o módulo cors
const loadRoutes = require('./config/loadRoutes');
global.db = require('./config/knex');

const app = express();

const allowedOrigins = [
    'http://172.19.0.1:3001',  // seu frontend local
    'https://editor.swagger.io', // Swagger Editor online
    'http://localhost:18512'
];
  
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true); // Permite Postman, curl, etc.

        if (allowedOrigins.includes(origin)) {
        callback(null, true);
        } else {
        callback(new Error('CORS policy: Origin not allowed'));
        }
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Monta as rotas
loadRoutes(app);

module.exports = app;
