const db = require('./database');

async function buscarCursos() {
    try {
        const [cursos] = await db.query(
            'SELECT id, nome FROM Curso'
        );
        console.log(cursos);
        return cursos;
    } catch (error) {
        console.error('Erro ao buscar os cursos:', error);
        throw error;
    }
}

async function criarCurso(dados) {
    try {
        await db.query(
            'INSERT INTO Curso (nome) VALUES (?)',
            [dados.nome]
        );
    } catch (error) {
        console.error('Erro ao criar curso no banco:', error);
        throw error;
    }
}

async function atualizarCurso(id, updates) {
    try {
        const setClauses = [];
        const values = [];

        if (updates.nome !== undefined) {
            setClauses.push('nome = ?');
            values.push(updates.nome);
        }

        if (setClauses.length === 0) {
            return; // Nada para atualizar
        }

        const query = `UPDATE Curso SET ${setClauses.join(', ')} WHERE id = ?`;
        values.push(id);

        const [result] = await db.query(query, values);
        console.log('Curso atualizado (PATCH-like):', result);

    } catch (error) {
        console.error('Erro ao atualizar curso (PATCH-like):', error);
        throw error;
    }
}

async function removerCurso(id) {
    try {
        await db.query(
            'DELETE FROM Curso WHERE id = (?)',
            [id]
        );
    } catch (error) {
        console.error('Erro ao remover curso do banco:', error);
        throw error;
    }
}

module.exports = { buscarCursos, criarCurso, atualizarCurso, removerCurso };