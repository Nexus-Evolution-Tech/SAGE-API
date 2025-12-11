# -*- coding: utf-8 -*-
import sys
import os
import mysql.connector
import pandas as pd

# Garante que o console aceite UTF-8 (Windows + Python 3.9+)
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

def exportar_dados(caminho_saida):
    try:
        # Garante que a pasta exports exista
        pasta_exports = os.path.dirname(caminho_saida)
        if pasta_exports and not os.path.exists(pasta_exports):
            os.makedirs(pasta_exports)

        # Conexão com o banco de dados
        conn = mysql.connector.connect(
            host='localhost',
            port=3306,
            user='root',
            password='douglas',
            database='sage'
        )
        cursor = conn.cursor(dictionary=True, buffered=True)

        consultas = {
            "Escola": """
                SELECT id, nome, numero_unidade, cnpj, login, senha, logradouro, numero,
                       complemento, bairro, cidade, estado, cep, telefone_contato, logo
                FROM UnidadeEscolar
            """,
            "Cursos": "SELECT id, nome, duracao FROM Curso",
            "Turmas": """
                SELECT t.id, t.nome, t.turno, c.nome AS curso, u.nome AS unidade
                FROM Turma t
                LEFT JOIN Curso c ON t.curso_id = c.id
                LEFT JOIN UnidadeEscolar u ON t.unidade_id = u.id
            """,
            "Catracas": """
                SELECT d.id, d.nome, d.modelo, d.endereco, d.porta, d.usuario,
                       a.nome AS area, u.nome AS unidade, d.numero_serial
                FROM Dispositivo d
                LEFT JOIN Area a ON d.area_id = a.id
                LEFT JOIN UnidadeEscolar u ON a.unidade_id = u.id
            """,
            "Alunos": """
                SELECT p.id, p.nome, p.rg, p.cpf, p.telefone, p.email, p.data_nascimento,
                       p.qr_code, p.cartao_rfid, a.ra, a.rm, a.status, t.nome AS turma
                FROM Pessoa p
                INNER JOIN Aluno a ON p.id = a.id
                LEFT JOIN Turma t ON a.turma_id = t.id
                WHERE p.tipo = 'ALUNO'
            """,
            "Responsaveis": """
                SELECT p.id, p.nome, p.rg, p.cpf, p.telefone, p.email, p.data_nascimento,
                       p.qr_code, p.cartao_rfid, r.aluno_id
                FROM Pessoa p
                INNER JOIN Responsavel r ON p.id = r.id
                WHERE p.tipo = 'RESPONSAVEL'
            """,
            "Professores": """
                SELECT p.id, p.nome, p.rg, p.cpf, p.telefone, p.email, p.data_nascimento,
                       f.matricula, f.data_admissao, f.data_saida, f.tipo_contrato
                FROM Pessoa p
                INNER JOIN Funcionario f ON p.id = f.id
                INNER JOIN Professor pr ON f.id = pr.id
                WHERE p.tipo = 'PROFESSOR'
            """,
            "Administradores": """
                SELECT p.id, p.nome, p.rg, p.cpf, p.telefone, p.email, p.data_nascimento,
                       f.matricula, f.data_admissao, f.data_saida, f.tipo_contrato, a.cargo
                FROM Pessoa p
                INNER JOIN Funcionario f ON p.id = f.id
                INNER JOIN Professor pr ON f.id = pr.id
                INNER JOIN Administrador a ON f.id = a.id
                WHERE p.tipo = 'PROFADM'
            """,
            "Terceirizados": """
                SELECT p.id, p.nome, p.rg, p.cpf, p.telefone, p.email, p.data_nascimento,
                       f.matricula, f.data_admissao, f.data_saida, f.tipo_contrato,
                       t.funcao, e.nome AS empresa
                FROM Pessoa p
                INNER JOIN Funcionario f ON p.id = f.id
                INNER JOIN Terceirizado t ON f.id = t.id
                LEFT JOIN Empresa e ON t.empresa_id = e.id
                WHERE p.tipo = 'TERCEIRIZADO'
            """
        }

        planilhas = {}

        for aba, query in consultas.items():
            cursor.execute(query)
            resultados = cursor.fetchall()
            df = pd.DataFrame(resultados)
            df = df.where(pd.notnull(df), None)
            planilhas[aba] = df

        # Gera o arquivo Excel final
        with pd.ExcelWriter(caminho_saida, engine='openpyxl') as writer:
            for aba, df in planilhas.items():
                df.to_excel(writer, sheet_name=aba, index=False)

        print(f"Exportação concluída com sucesso: {caminho_saida}")

    except mysql.connector.Error as err:
        print(f"Erro ao exportar dados: {err}")

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("ERRO: Caminho de saída não fornecido.")
        sys.exit(1)

    caminho_saida = sys.argv[1]
    exportar_dados(caminho_saida)
