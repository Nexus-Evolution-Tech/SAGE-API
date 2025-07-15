SHOW VARIABLES LIKE 'event_scheduler';
SET GLOBAL event_scheduler = ON;
SHOW EVENTS LIKE 'atualizar_ou_desligar_alunos';

DELIMITER $$

CREATE EVENT atualizar_ou_desligar_alunos
-- ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 MINUTE
ON SCHEDULE
    EVERY 1 YEAR
    STARTS TIMESTAMP(CONCAT(YEAR(CURDATE()) + 1, '-01-01 00:00:00'))
DO
BEGIN
	-- Desliga alunos que estão em turmas finais
    UPDATE Aluno a
    JOIN Pessoa p ON a.id = p.id
    SET a.status = 'DESLIGADO', p.updated_at = NOW() -- o SET ocorre depois do WHERE ser avaliado
    WHERE p.tipo = 'ALUNO'
      AND a.status = 'ATIVO'
      AND YEAR(p.updated_at) < YEAR(CURDATE()) -- para testar altere para <=
      AND a.turma_id IN (5, 6, 8, 9);
      
    -- Atualiza turma conforme regras definidas
    UPDATE Aluno a
    JOIN Pessoa p ON a.id = p.id
    SET 
        a.turma_id = CASE 
                        WHEN a.turma_id = 1 THEN 3
                        WHEN a.turma_id = 2 THEN 4
                        WHEN a.turma_id = 3 THEN 5
                        WHEN a.turma_id = 4 THEN 6
                        WHEN a.turma_id = 7 THEN 9
                        ELSE a.turma_id -- permanece o mesmo para os demais
                    END,
        p.updated_at = NOW()
    WHERE p.tipo = 'ALUNO'
      AND a.status = 'ATIVO'
      AND YEAR(p.updated_at) < YEAR(CURDATE()) -- para teste altere para <=
      AND a.turma_id IN (1, 2, 3, 4, 7); -- evita atualizar o que não precisa
END$$

DELIMITER ;

SELECT *
FROM Aluno a
JOIN Pessoa p ON a.id = p.id
WHERE p.tipo = 'ALUNO'
  AND a.status = 'ATIVO'
  AND YEAR(p.updated_at) <= YEAR(CURDATE())
  AND a.turma_id IN (5, 6, 7, 8, 9);
  
DROP EVENT IF EXISTS atualizar_ou_desligar_alunos;

