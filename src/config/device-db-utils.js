// src/db-utils.js
const db = require('./database'); // Ajuste o caminho se necessário

async function buscarTodosDispositivos() {
    try {
        const [dispositivos] = await db.query(
            'SELECT id, nome, modelo, endereco, porta, usuario, senha FROM Dispositivo'
        );
        console.log(dispositivos);
        return dispositivos;
    } catch (error) {
        console.error('Erro ao buscar todos os dispositivos:', error);
        throw error;
    }
}

async function criarNovoDispositivo(nome, modelo, endereco, porta, usuario, senha) {
    try {
        const [dispositivos] = await db.query(
            'INSERT INTO Dispositivo (nome, modelo, endereco, porta, usuario, senha) VALUES (?, ?, ?, ?, ?, ?)',
            [nome, modelo, endereco, porta, usuario, senha]
        );
    } catch (error) {
        console.error('Erro ao criar novo dispositivo no banco:', error);
        throw error;
    }
}

async function atualizarDispositivo(id, updates) {
    try {
        const setClauses = [];
        const values = [];

        if (updates.nome !== undefined) {
            setClauses.push('nome = ?');
            values.push(updates.nome);
        }
        if (updates.modelo !== undefined) {
            setClauses.push('modelo = ?');
            values.push(updates.modelo);
        }
        if (updates.endereco !== undefined) {
            setClauses.push('endereco = ?');
            values.push(updates.endereco);
        }
        if (updates.porta !== undefined) {
            setClauses.push('porta = ?');
            values.push(updates.porta);
        }
        if (updates.usuario !== undefined) {
            setClauses.push('usuario = ?');
            values.push(updates.usuario);
        }
        if (updates.senha !== undefined) {
            setClauses.push('senha = ?');
            values.push(updates.senha);
        }

        if (setClauses.length === 0) {
            return; // Nada para atualizar
        }

        const query = `UPDATE Dispositivo SET ${setClauses.join(', ')} WHERE id = ?`;
        values.push(id);

        const [result] = await db.query(query, values);
        console.log('Dispositivo atualizado (PATCH-like):', result);

    } catch (error) {
        console.error('Erro ao atualizar dispositivo (PATCH-like):', error);
        throw error;
    }
}

async function removerDispositivo(id) {
    try {
        const [dispositivos] = await db.query(
            'DELETE FROM Dispositivo WHERE id = (?)',
            [id]
        );
    } catch (error) {
        console.error('Erro ao remover dispositivo do banco:', error);
        throw error;
    }
}

module.exports = { buscarTodosDispositivos, criarNovoDispositivo, atualizarDispositivo, removerDispositivo };