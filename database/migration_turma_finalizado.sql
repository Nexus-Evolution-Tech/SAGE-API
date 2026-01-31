-- Migration: Turma "Finalizado" por unidade
-- Alunos que concluem o curso (não há próxima série) são movidos para esta turma.
-- Execute: mysql -u user -p sage < migration_turma_finalizado.sql

USE sage;

-- Cria turma "Finalizado" para cada unidade que ainda não possui
INSERT INTO Turma (nome, turno, curso_id, unidade_id)
SELECT 'Finalizado', 'INTEGRAL', NULL, u.id
FROM UnidadeEscolar u
WHERE NOT EXISTS (
  SELECT 1 FROM Turma t
  WHERE t.unidade_id = u.id
  AND (t.nome = 'Finalizado' OR t.nome LIKE '%Concluído%')
);
