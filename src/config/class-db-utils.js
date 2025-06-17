const db = require('./database');

async function buscarTurmas() {
    try {
        const [turmas] = await db.query(
            'SELECT id, nome, turno, curso_id, unidade_id FROM Turma'
        );
        console.log(turmas);
        return turmas;
    } catch (error) {
        console.error('Erro ao buscar as turmas:', error);
        throw error;
    }
}

async function criarTurma(dados) {
    try {
        await db.query(
            'INSERT INTO Turma (nome, turno, curso_id, unidade_id) VALUES (?, ?, ?, ?)',
            [dados.nome, dados.turno, dados.curso_id, dados.unidade_id]
        );
    } catch (error) {
        console.error('Erro ao criar turma no banco:', error);
        throw error;
    }
}

async function atualizarTurma(id, updates) {
    try {
        const setClauses = [];
        const values = [];

        if (updates.nome !== undefined) {
            setClauses.push('nome = ?');
            values.push(updates.nome);
        }
        if (updates.turno !== undefined) {
            setClauses.push('turno = ?');
            values.push(updates.turno);
        }
        if (updates.curso_id !== undefined) {
            setClauses.push('curso_id = ?');
            values.push(updates.curso_id);
        }
        if (updates.unidade_id !== undefined) {
            setClauses.push('unidade_id = ?');
            values.push(updates.unidade_id);
        }

        if (setClauses.length === 0) {
            return; // Nada para atualizar
        }

        const query = `UPDATE Turma SET ${setClauses.join(', ')} WHERE id = ?`;
        values.push(id);

        const [result] = await db.query(query, values);
        console.log('turma atualizada (PATCH-like):', result);

    } catch (error) {
        console.error('Erro ao atualizar turma (PATCH-like):', error);
        throw error;
    }
}

async function removerTurma(id) {
    try {
        await db.query(
            'DELETE FROM Turma WHERE id = (?)',
            [id]
        );
    } catch (error) {
        console.error('Erro ao remover turma do banco:', error);
        throw error;
    }
}

module.exports = { buscarTurmas, criarTurma, atualizarTurma, removerTurma };