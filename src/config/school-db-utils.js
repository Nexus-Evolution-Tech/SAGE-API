const db = require('./database');

async function buscarEscolas() {
    try {
        const [escolas] = await db.query(
            'SELECT id, nome_unidade, n_unidade, cnpj, login, endereco FROM UnidadeEscolar'
        );
        console.log(escolas);
        return escolas;
    } catch (error) {
        console.error('Erro ao buscar os escolas:', error);
        throw error;
    }
}

async function criarEscola(dados) {
    try {
        await db.query(
            'INSERT INTO UnidadeEscolar (nome_unidade, n_unidade, cnpj, login, senha, endereco) VALUES (?, ?, ?, ?, ?, ?)',
            [dados.nome_unidade, dados.n_unidade, dados.cnpj, dados.login, dados.senha, dados.endereco]
        );
    } catch (error) {
        console.error('Erro ao criar escola no banco:', error);
        throw error;
    }
}

async function atualizarEscola(id, updates) {
    try {
        const setClauses = [];
        const values = [];

        if (updates.nome_unidade !== undefined) {
            setClauses.push('nome_unidade = ?');
            values.push(updates.nome_unidade);
        }
        if (updates.n_unidade !== undefined) {
            setClauses.push('n_unidade = ?');
            values.push(updates.n_unidade);
        }
        if (updates.cnpj !== undefined) {
            setClauses.push('cnpj = ?');
            values.push(updates.cnpj);
        }
        if (updates.login !== undefined) {
            setClauses.push('login = ?');
            values.push(updates.login);
        }
        if (updates.senha !== undefined) {
            setClauses.push('senha = ?');
            values.push(updates.senha);
        }
        if (updates.endereco !== undefined) {
            setClauses.push('endereco = ?');
            values.push(updates.endereco);
        }

        if (setClauses.length === 0) {
            return; // Nada para atualizar
        }

        const query = `UPDATE UnidadeEscolar SET ${setClauses.join(', ')} WHERE id = ?`;
        values.push(id);

        const [result] = await db.query(query, values);
        console.log('escola atualizado (PATCH-like):', result);

    } catch (error) {
        console.error('Erro ao atualizar escola (PATCH-like):', error);
        throw error;
    }
}

async function removerEscola(id) {
    try {
        await db.query(
            'DELETE FROM UnidadeEscolar WHERE id = (?)',
            [id]
        );
    } catch (error) {
        console.error('Erro ao remover escola do banco:', error);
        throw error;
    }
}

module.exports = { buscarEscolas, criarEscola, atualizarEscola, removerEscola };