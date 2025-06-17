// app.js
const express = require('express');
const cors = require('cors'); // Importe o módulo cors
const deviceRoutes = require('./routes/deviceRoutes');
const pessoaRoutes = require('./routes/peopleRoutes');

const app = express();

// Use o middleware cors *antes* de qualquer outra configuração de middleware ou rota
app.use(cors());

app.use(express.json());

const corsOptions = {
    origin: 'http://172.19.0.1:3001', // Substitua pelo domínio real do seu frontend
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // Se você precisar de cookies ou headers de autenticação
};

app.use(cors(corsOptions));
app.use(express.json());

// Monta as rotas
app.use('/', deviceRoutes);
app.use('/', pessoaRoutes);

module.exports = app;
