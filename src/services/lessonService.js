async function buscarHorariosPorTurma(req, res) {
    const { turma_id, div } = req.params;
    if (!turma_id || !div) {
        return res.status(400).json({ message: 'Parâmetros turma_id e div são obrigatórios' });
    }
    
    try {
        const aulas = await global.db('Aula')
            .select('id', 'nome', 'professor_id', 'turma_id', 'materia_id', 'inicio', 'fim', 'dia_semana', 'divisao')
            .where({ turma_id, divisao: div });

        if (aulas.length === 0) {
            return res.status(404).json({ message: 'Nenhuma aula encontrada para a turma e divisão especificadas.' });
        }

        res.json(aulas);
    } catch (error) {
        console.error('Erro ao buscar aulas:', error);
        res.status(500).json({ message: 'Erro ao buscar aulas do banco de dados' });
    }
}

module.exports = {
    buscarHorariosPorTurma,
}