# exportar_dados.py
# Versão Refatorada - Utiliza PyMySQL (Estável) e Logs detalhados
# Requisitos: pip install pandas openpyxl pymysql

import sys
import os
import pymysql
import pymysql.cursors
import pandas as pd
from datetime import datetime

# Garante que o console aceite UTF-8 (Windows)
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# ----------------------------
# Configuração do banco
# ----------------------------
DB_CONFIG = {
    'host': 'localhost',
    'port': 3306,
    'user': 'root',
    'password': 'douglas',
    'database': 'sage',
    'cursorclass': pymysql.cursors.DictCursor # Importante para gerar JSON/Dict
}

# ----------------------------
# Utilitários de Log
# ----------------------------
def log(msg):
    """Imprime mensagem com timestamp e força saída imediata (evita perda de logs em crash)"""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}", flush=True)

# ----------------------------
# Função Principal
# ----------------------------
def exportar_dados(caminho_saida):
    conn = None
    try:
        # 1. Validação do caminho
        log(f"Iniciando exportação para: {caminho_saida}")
        pasta_exports = os.path.dirname(caminho_saida)
        if pasta_exports and not os.path.exists(pasta_exports):
            os.makedirs(pasta_exports)
            log(f"Pasta criada: {pasta_exports}")

        # 2. Conexão Segura (PyMySQL)
        conn = pymysql.connect(**DB_CONFIG)
        cursor = conn.cursor()
        log("DB conectado com sucesso (PyMySQL).")

        # 3. Definição das Consultas
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
                WHERE p.tipo = 'RESPONSAVEL' OR p.tipo = 'RESPONSÁVEL'
            """,
            "Professores": """
                SELECT p.id, p.nome, p.rg, p.cpf, p.telefone, p.email, p.data_nascimento, 
                       f.matricula, f.data_admissao, f.data_saida, f.tipo_contrato 
                FROM Pessoa p 
                INNER JOIN Funcionario f ON p.id = f.id 
                INNER JOIN Professor pr ON f.id = pr.id 
                WHERE p.tipo IN ('PROFESSOR', 'PROFADM')
            """,
            "Administradores": """
                SELECT p.id, p.nome, p.rg, p.cpf, p.telefone, p.email, p.data_nascimento, 
                       f.matricula, f.data_admissao, f.data_saida, f.tipo_contrato, a.cargo 
                FROM Pessoa p 
                INNER JOIN Funcionario f ON p.id = f.id 
                INNER JOIN Administrador a ON f.id = a.id 
                WHERE p.tipo IN ('ADMINISTRADOR', 'PROFADM')
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

        # 4. Execução e Criação dos DataFrames
        planilhas = {}
        
        for aba, query in consultas.items():
            log(f"Consultando dados para aba: {aba}...")
            cursor.execute(query)
            resultados = cursor.fetchall()
            
            if resultados:
                df = pd.DataFrame(resultados)
                # Converter data_nascimento e outras datas para string ou datetime nativo se necessário
                # O Pandas já costuma lidar bem, mas force logs se vazio
            else:
                # Se não houver dados, cria um DataFrame vazio mas COM AS COLUNAS
                # Isso evita erro ao abrir o Excel e não ver os cabeçalhos
                colunas = [col[0] for col in cursor.description] if cursor.description else []
                df = pd.DataFrame(columns=colunas)
                log(f" - Aba {aba} sem dados. Criando apenas cabeçalhos.")

            # Limpeza básica (None -> "") para visualização melhor no Excel
            df = df.where(pd.notnull(df), "")
            planilhas[aba] = df

        # 5. Escrita do Arquivo Excel
        log("Gerando arquivo Excel...")
        with pd.ExcelWriter(caminho_saida, engine='openpyxl') as writer:
            for aba, df in planilhas.items():
                df.to_excel(writer, sheet_name=aba, index=False)
                log(f" - Aba '{aba}' gravada com {len(df)} linhas.")

        log(f"Sucesso! Arquivo salvo em: {caminho_saida}")

    except pymysql.MySQLError as err:
        log(f"❌ Erro de Banco de Dados: {err}")
        sys.exit(1)
    except Exception as e:
        log(f"❌ Erro Genérico: {e}")
        sys.exit(1)
    finally:
        if conn:
            conn.close()
            log("Conexão fechada.")

if __name__ == "__main__":
    # Verifica argumentos
    caminho = "exportacao_padrao.xlsx" # Valor default para teste manual
    if len(sys.argv) > 1:
        caminho = sys.argv[1]
    
    exportar_dados(caminho)