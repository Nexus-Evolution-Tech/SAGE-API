# inserir_dados_pymysql.py
# Versão Segura (Driver Pure Python) - Corrige erro 3221225477
# Requisitos: pip install pandas openpyxl pymysql

import pandas as pd
import pymysql # TROCAMOS O DRIVER AQUI
import re
from datetime import datetime
import sys
import time

# ----------------------------
# Configuração do banco
# ----------------------------
DB_CONFIG = {
    'host': 'localhost',
    'port': 3306, 
    'user': 'root',
    'password': 'douglas',
    'database': 'sage',
    'cursorclass': pymysql.cursors.Cursor # Cursor padrão
}

# ----------------------------
# Utilitários de Log
# ----------------------------
def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}", flush=True)

# ----------------------------
# Utilitários de Tratamento
# ----------------------------
def limpar_valor(v):
    if pd.isna(v) or v is None:
        return None
    s = str(v).strip().replace('"', '').replace("'", "")
    return s if s else None

def somente_numeros(v):
    if v is None: return ""
    v_str = str(v)
    if not v_str: return ""
    return re.sub(r'\D', '', v_str)

def pad_digits(v, size):
    s = somente_numeros(v) 
    if not s: return None
    if len(s) > size: return s[:size]
    return s.zfill(size)

def validar_email(v):
    v = limpar_valor(v)
    if not v: return None
    if len(v) < 5 or '@' not in v: return None
    if re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', v):
        return v.lower()
    return None

def parse_date(v):
    v = limpar_valor(v)
    if not v: return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%d")
    try:
        dt = pd.to_datetime(v, errors='coerce', dayfirst=True)
        if not pd.isna(dt):
            return dt.strftime("%Y-%m-%d")
    except:
        pass
    return None

# ----------------------------
# Funções de Banco de Dados
# ----------------------------
def find_turma_by_name(cursor, nome):
    if not nome: return None
    cursor.execute("SELECT id FROM Turma WHERE nome = %s LIMIT 1", (nome,))
    r = cursor.fetchone()
    return r[0] if r else None

def find_pessoa_by_cpf(cursor, cpf):
    if not cpf: return None
    cursor.execute("SELECT id FROM Pessoa WHERE cpf = %s LIMIT 1", (cpf,))
    r = cursor.fetchone()
    return r[0] if r else None

def inserir_pessoa(cursor, conn, row, tipo, rfid_raw, unidade_id_default):
    nome = limpar_valor(row.get("Nome") or row.get("nome"))
    if not nome: return None

    cpf = pad_digits(row.get("CPF") or row.get("Cpf") or row.get("cpf"), 11)
    rg = pad_digits(row.get("RG") or row.get("Rg") or row.get("rg"), 9)
    telefone = pad_digits(row.get("Telefone") or row.get("Telefone Contato") or row.get("telefone"), 11)
    email = validar_email(row.get("Email") or row.get("email"))
    rfid = somente_numeros(rfid_raw) or None
    if rfid == "": rfid = None
    data_nasc = parse_date(row.get("Data Nascimento") or row.get("Data Nasc") or row.get("data_nascimento"))

    if cpf:
        existing_id = find_pessoa_by_cpf(cursor, cpf)
        if existing_id: return existing_id

    try:
        sql = """INSERT INTO Pessoa (nome, rg, cpf, telefone, email, unidade_id, data_nascimento, tipo, cartao_rfid)
                 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"""
        vals = (nome, rg, cpf, telefone, email, unidade_id_default, data_nasc, tipo, rfid)
        cursor.execute(sql, vals)
        conn.commit()
        return cursor.lastrowid
    except pymysql.MySQLError as err:
        # Erro 1062 é duplicidade no PyMySQL
        if err.args[0] == 1062: 
            cursor.execute("SELECT id FROM Pessoa WHERE nome = %s LIMIT 1", (nome,))
            r = cursor.fetchone()
            if r: return r[0]
        log(f" ❌ Erro SQL ao inserir Pessoa ({nome}): {err}")
        return None

# ----------------------------
# Processamento
# ----------------------------
def processar_aluno(df, cursor, conn, unidade_id_default):
    log(f"Processando {len(df)} ALUNOS...")
    for idx, r in df.iterrows():
        try:
            pessoa_id = inserir_pessoa(cursor, conn, r, "ALUNO", r.get("Número do Cartão"), unidade_id_default)
            if not pessoa_id: continue

            ra = pad_digits(r.get("RA"), 14)
            rm = pad_digits(r.get("RM"), 11)
            turma_nome = limpar_valor(r.get("Turma"))
            turma_id = find_turma_by_name(cursor, turma_nome)
            
            divisao = None
            div_raw = limpar_valor(r.get("Divisão") or r.get("Divisao"))
            if div_raw:
                div_upper = div_raw.upper()
                if "A" in div_upper: divisao = "DIV A"
                elif "B" in div_upper: divisao = "DIV B"
                elif "INT" in div_upper: divisao = "INT"
            
            status = limpar_valor(r.get("Status")) or "EM CURSO"

            cursor.execute("SELECT id FROM Aluno WHERE id = %s", (pessoa_id,))
            if not cursor.fetchone():
                cursor.execute("INSERT INTO Aluno (id, ra, rm, turma_id, divisao, status) VALUES (%s,%s,%s,%s,%s,%s)",
                               (pessoa_id, ra, rm, turma_id, divisao, status))
                conn.commit()
        except Exception as e:
            conn.rollback()
            log(f"Erro Aluno linha {idx}: {e}")

def processar_responsavel(df, cursor, conn, unidade_id_default):
    log(f"Processando {len(df)} RESPONSÁVEIS...")
    for idx, r in df.iterrows():
        try:
            pessoa_id = inserir_pessoa(cursor, conn, r, "RESPONSAVEL", r.get("Número do Cartão"), unidade_id_default)
            if not pessoa_id: continue

            cursor.execute("SELECT id FROM Responsavel WHERE id = %s", (pessoa_id,))
            if cursor.fetchone(): continue

            aluno_nome = limpar_valor(r.get("Nome do Aluno") or r.get("Aluno"))
            aluno_id = None
            if aluno_nome:
                cursor.execute("SELECT p.id FROM Pessoa p JOIN Aluno a ON p.id=a.id WHERE p.nome = %s LIMIT 1", (aluno_nome,))
                res = cursor.fetchone()
                if res: aluno_id = res[0]
            
            cursor.execute("INSERT INTO Responsavel (id, aluno_id) VALUES (%s, %s)", (pessoa_id, aluno_id))
            conn.commit()
        except Exception as e:
            conn.rollback()

def processar_professor(df, cursor, conn, unidade_id_default):
    log(f"Processando {len(df)} PROFESSORES...")
    for idx, r in df.iterrows():
        try:
            eh_admin = str(r.get("Administrador")).lower() == "true"
            tipo = "PROFADM" if eh_admin else "PROFESSOR"
            
            pessoa_id = inserir_pessoa(cursor, conn, r, tipo, r.get("Número do Cartão"), unidade_id_default)
            if not pessoa_id: continue

            matricula = pad_digits(r.get("Matrícula") or r.get("Matrícula (Nº)"), 6)
            dt_adm = parse_date(r.get("Data Admissão"))
            dt_saida = parse_date(r.get("Data Saída"))
            contrato = limpar_valor(r.get("Tipo Contrato"))

            cursor.execute("SELECT id FROM Funcionario WHERE id = %s", (pessoa_id,))
            if not cursor.fetchone():
                cursor.execute("INSERT INTO Funcionario (id, matricula, data_admissao, data_saida, tipo_contrato) VALUES (%s,%s,%s,%s,%s)",
                               (pessoa_id, matricula, dt_adm, dt_saida, contrato))
                conn.commit()
            
            cursor.execute("SELECT id FROM Professor WHERE id = %s", (pessoa_id,))
            if not cursor.fetchone():
                cursor.execute("INSERT INTO Professor (id) VALUES (%s)", (pessoa_id,))
                conn.commit()
            
            if eh_admin:
                cursor.execute("SELECT id FROM Administrador WHERE id = %s", (pessoa_id,))
                if not cursor.fetchone():
                    cursor.execute("INSERT INTO Administrador (id) VALUES (%s)", (pessoa_id,))
                    conn.commit()
        except Exception as e:
            conn.rollback()

# ----------------------------
# Main
# ----------------------------
def main(excel_file, unidade_id_default=None):
    log(f"Iniciando script para arquivo: {excel_file}")
    
    # CONEXÃO SEGURA COM PYMYSQL
    try:
        conn = pymysql.connect(**DB_CONFIG)
        cursor = conn.cursor() # PyMySQL não usa buffered=True aqui da mesma forma
        log("DB conectado com sucesso (PyMySQL).")
    except Exception as e:
        log(f"FATAL: Erro de conexão com banco: {e}")
        return

    # Leitura Excel
    log("Lendo arquivo Excel...")
    try:
        colunas_string = {
            "CPF": str, "Cpf": str, "cpf": str, "RG": str, "Rg": str, "rg": str,
            "Número do Cartão": str, "Numero do Cartao": str, "RA": str, "RM": str,
            "Matrícula": str, "Matricula": str, "Matrícula (Nº)": str
        }
        xls = pd.ExcelFile(excel_file, engine="openpyxl")
        sheet_names = xls.sheet_names
        log(f"Abas: {sheet_names}")
    except Exception as e:
        log(f"FATAL: Erro ao abrir Excel: {e}")
        return

    if "ALUNO" in sheet_names:
        df = pd.read_excel(xls, "ALUNO", dtype=colunas_string).fillna("")
        processar_aluno(df, cursor, conn, unidade_id_default)
    
    for aba in ["RESPONSÁVEL", "RESPONSAVEL", "Responsaveis"]:
        if aba in sheet_names:
            df = pd.read_excel(xls, aba, dtype=colunas_string).fillna("")
            processar_responsavel(df, cursor, conn, unidade_id_default)
            break
            
    if "PROFESSOR" in sheet_names:
        df = pd.read_excel(xls, "PROFESSOR", dtype=colunas_string).fillna("")
        processar_professor(df, cursor, conn, unidade_id_default)

    log("Finalizado com sucesso.")
    cursor.close()
    conn.close()

if __name__ == "__main__":
    if len(sys.argv) > 1:
        excel_file = sys.argv[1]
        unidade_id = int(sys.argv[2]) if len(sys.argv) > 2 else None
        main(excel_file, unidade_id)
    else:
        print("Erro: Informe o arquivo xlsx")