# inserir_dados.py
# Versão final — integra planilha -> banco 'sage'
# Requisitos: pandas, openpyxl, mysql-connector-python
# pip install pandas openpyxl mysql-connector-python

import pandas as pd
import mysql.connector
import re
from datetime import datetime
import sys

# ----------------------------
# Configuração do banco (ajuste aqui se necessário)
# ----------------------------
DB_CONFIG = {
    'host': 'localhost',
    'port': 3306, 
    'user': 'root',
    'password': 'douglas',
    'database': 'sage'
}

# EXCEL_FILE = "PlanilhaDadosEscolares.xlsx"

# ----------------------------
# Utilitários
# ----------------------------
def limpar_valor(v):
    if pd.isna(v):
        return None
    return str(v).strip().replace('"', '').replace("'", "")


def somente_numeros(v):
    v = limpar_valor(v)
    if not v:
        return ""
    # Remove todos os caracteres não-dígitos
    return re.sub(r'\D', '', str(v))

def pad_digits(v, size):
    # CORREÇÃO: Aplica somente_numeros antes de preencher, garantindo que IDs grandes
    # não causem erro (ex: '123456789.0' vira '123456789')
    s = somente_numeros(v) 
    if s == "":
        return None
    if len(s) >= size:
        return s[:size]
    return s.zfill(size)

def validar_email(v):
    v = limpar_valor(v)
    if not v:
        return None
    if re.match(r'^[^@]+@[^@]+\.[^@]+$', v):
        return v.lower()
    return None

def parse_date(v):
    v = limpar_valor(v)
    if not v:
        return None
    # if it's already a Timestamp
    try:
        if isinstance(v, (pd.Timestamp, datetime)):
            return v.strftime("%Y-%m-%d")
    except Exception:
        pass
    # Tenta pandas parse (agora sem dayfirst=True para evitar warning)
    try:
        dt = pd.to_datetime(v, errors='coerce', format='mixed')
        if not pd.isna(dt):
            return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    # fallback few formats
    for fmt in ("%d/%m/%Y","%d-%m-%Y","%Y-%m-%d","%d\\%m\\%Y","%m/%d/%Y"):
        try:
            dt = datetime.strptime(str(v), fmt)
            return dt.strftime("%Y-%m-%d")
        except Exception:
            continue
    return None

# ----------------------------
# DB helper functions
# ----------------------------
def get_unidade_by_nome(cursor, nome):
    if not nome:
        return None
    cursor.execute("SELECT id FROM UnidadeEscolar WHERE nome = %s", (nome,))
    r = cursor.fetchone()
    return r[0] if r else None

def find_turma_by_name(cursor, nome):
    if not nome:
        return None
    cursor.execute("SELECT id FROM Turma WHERE nome = %s", (nome,))
    r = cursor.fetchone()
    return r[0] if r else None

def find_pessoa_by_cpf(cursor, cpf):
    if not cpf:
        return None
    cursor.execute("SELECT id FROM Pessoa WHERE cpf = %s", (cpf,))
    r = cursor.fetchone()
    return r[0] if r else None

# ----------------------------
# Inserir Pessoa (sempre tenta criar Pessoa e retorna pessoa_id)
# ----------------------------
def inserir_pessoa(cursor, conn, row, tipo, rfid_raw, unidade_id_default):
    # Colunas possíveis: Nome, RG, CPF, Telefone, Email, Número do Cartão, Data Nascimento
    nome = limpar_valor(row.get("Nome") or row.get("nome"))
    if not nome:
        return None

    # pegar cpf/rg/telefone/email/Número do Cartão/data
    cpf_raw = row.get("CPF") or row.get("Cpf") or row.get("cpf")
    cpf = pad_digits(cpf_raw, 11)
    rg_raw = row.get("RG") or row.get("Rg") or row.get("rg")
    rg = pad_digits(rg_raw, 9)
    telefone_raw = row.get("Telefone") or row.get("Telefone Contato") or row.get("telefone")
    telefone = pad_digits(telefone_raw, 11)
    email = validar_email(row.get("Email") or row.get("email"))
    
    # CORREÇÃO DEFINITIVA DO RFID: Garante que é somente número
    rfid = somente_numeros(rfid_raw) or None
    
    data_nasc = parse_date(row.get("Data Nascimento") or row.get("Data Nasc") or row.get("data_nascimento"))

    # Se CPF presente e já existe pessoa -> usa existente
    if cpf:
        try:
            existing = find_pessoa_by_cpf(cursor, cpf)
        except Exception:
            existing = None
        if existing:
            return existing

    # Inserir pessoa (quaisquer campos vazios viram NULL)
    try:
        cursor.execute("""
            INSERT INTO Pessoa (nome, rg, cpf, telefone, email, unidade_id, data_nascimento, tipo, cartao_rfid)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (nome, rg, cpf, telefone, email, unidade_id_default, data_nasc, tipo, rfid))
        conn.commit()
        return cursor.lastrowid
    except mysql.connector.Error as err:
        conn.rollback()
        print(f"  ❌ Erro ao inserir Pessoa ({nome}): {err}")
        return None

# ----------------------------
# Main
# ----------------------------
def main(excel_file, unidade_id_default=None):
    EXCEL_FILE = excel_file
    # conectar DB
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as e:
        print(f"Erro ao conectar no MySQL: {e}")
        sys.exit(1)

    cursor = conn.cursor(buffered=True)
    print("Conexão com o banco de dados MySQL bem-sucedida!\n")

    # CORREÇÃO ANTI-FLOAT DO PANDAS: Define todas as colunas de ID/números como string
    # Isso impede que números grandes (CPF, RG, Cartão) sejam lidos como float (com o ".0")
    colunas_para_string = {
        "CPF": str, 
        "Cpf": str, 
        "cpf": str,
        "RG": str,
        "Rg": str,
        "rg": str,
        "Número do Cartão": str, 
        "Numero do Cartao": str,
        "RA": str,
        "RM": str,
        "Matrícula": str,
        "Matricula": str,
        "Matrícula (Nº)": str,
        "Matricula (Nº)": str,
        "Matrícula (específica)": str
    }

    # ler todas as sheets
    try:
        all_sheets = pd.read_excel(EXCEL_FILE, sheet_name=None, engine="openpyxl", dtype=colunas_para_string)
    except FileNotFoundError:
        print(f"Arquivo Excel não encontrado: {EXCEL_FILE}")
        cursor.close()
        conn.close()
        return
    except Exception as e:
        print(f"Erro ao ler Excel: {e}")
        cursor.close()
        conn.close()
        return

    # ----------------------------
    # 5) ALUNO
    # ----------------------------
    print("\nProcessando aba: ALUNO")
    if "ALUNO" in all_sheets:
        df = all_sheets["ALUNO"].fillna("")
        for idx, r in df.iterrows():
            nome = limpar_valor(r.get("Nome"))
            if not nome:
                continue
            # Pessoa
            pessoa_id = inserir_pessoa(cursor, conn, r, "ALUNO", r.get("Número do Cartão"), unidade_id_default)
            if not pessoa_id:
                continue
            # Aluno
            ra = pad_digits(r.get("RA"), 14) if r.get("RA") else None
            rm = pad_digits(r.get("RM"), 11) if r.get("RM") else None
            turma_nome = limpar_valor(r.get("Turma"))
            turma_id = find_turma_by_name(cursor, turma_nome) if turma_nome else None
            divisao = None
            div_raw = limpar_valor(r.get("Divisão") or r.get("Divisao"))
            if div_raw:
                dd = div_raw.strip().upper()
                if dd in ("A","DIV A","DIVA"):
                    divisao = "DIV A"
                elif dd in ("B","DIV B","DIVB"):
                    divisao = "DIV B"
                elif dd in ("INT"):
                    divisao = "INT"
            status = limpar_valor(r.get("Status")) or "EM CURSO"
            try:
                cursor.execute("SELECT id FROM Aluno WHERE id = %s", (pessoa_id,))
                if cursor.fetchone():
                    # print(f"  - Aluno (pessoa id {pessoa_id}) já existe na tabela Aluno. Pulando.")
                    continue
                cursor.execute("INSERT INTO Aluno (id, ra, rm, turma_id, divisao, status) VALUES (%s,%s,%s,%s,%s,%s)",
                               (pessoa_id, ra, rm, turma_id, divisao, status))
                conn.commit()
                print(f"+ Aluno '{nome}' inserido (pessoa id {pessoa_id}).")
            except Exception as e:
                conn.rollback()
                print(f"Erro (Aluno idx {idx}): {e}")
    else:
        print("Aba 'ALUNO' não encontrada.")

    # ----------------------------
    # 6) RESPONSÁVEL
    # ----------------------------
    print("\nProcessando aba: RESPONSAVEL")
    sheet_name_resp = None
    for candidate in ("RESPONSÁVEL", "RESPONSAVEL", "Responsaveis", "Responsáveis", "RESPONSAVEIS"):
        if candidate in all_sheets:
            sheet_name_resp = candidate
            break
    if sheet_name_resp:
        df = all_sheets[sheet_name_resp].fillna("")
        for _, r in df.iterrows():
            # Pessoa
            pessoa_id = inserir_pessoa(cursor, conn, r, "RESPONSAVEL", r.get("Número do Cartão"), unidade_id_default)
            if not pessoa_id:
                continue
            # Responsavel
            try:
                cursor.execute("SELECT id FROM Responsavel WHERE id = %s", (pessoa_id,))
                if cursor.fetchone():
                    # print(f"  - Responsável (pessoa id {pessoa_id}) já existe. Pulando.")
                    continue
                aluno_nome = limpar_valor(r.get("Nome do Aluno") or r.get("Aluno"))
                aluno_id = None
                if aluno_nome:
                    cursor.execute("SELECT p.id FROM Pessoa p JOIN Aluno a ON p.id=a.id WHERE p.nome = %s", (aluno_nome,))
                    row = cursor.fetchone()
                    if row:
                        aluno_id = row[0]
                cursor.execute("INSERT INTO Responsavel (id, aluno_id) VALUES (%s, %s)", (pessoa_id, aluno_id))
                conn.commit()
                print(f"+ Responsável '{r.get('Nome')}' inserido (pessoa id {pessoa_id}).")
            except Exception as e:
                conn.rollback()
                print(f"Erro ao inserir responsável: {e}")
    else:
        print("  - Aba 'RESPONSÁVEL' / 'RESPONSAVEL' não encontrada.")

    # ----------------------------
    # 7) PROFESSOR
    # ----------------------------
    print("\nProcessando aba: PROFESSOR")
    if "PROFESSOR" in all_sheets:
        df = all_sheets["PROFESSOR"].fillna("")
        for _, r in df.iterrows():
            eh_admin = limpar_valor(r.get("Administrador")) == "True"
            # print(eh_admin)
            tipo = "PROFADM" if eh_admin else "PROFESSOR"
            
            # 1. PESSOA
            pessoa_id = inserir_pessoa(cursor, conn, r, tipo, r.get("Número do Cartão"), unidade_id_default)
            if not pessoa_id:
                continue
                
            matricula = pad_digits(r.get("Matrícula (Nº)") or r.get("Matricula (Nº)") or r.get("Matrícula") or r.get("Matricula"), 6)
            data_adm = parse_date(r.get("Data Admissão") or r.get("Data Admissao"))
            data_saida = parse_date(r.get("Data Saída") or r.get("Data Saida"))
            tipo_contrato = limpar_valor(r.get("Tipo Contrato") or r.get("Tipo_Contrato")) or None
            
            try:
                # 2. FUNCIONARIO (Obrigatório para Professor/Administrador)
                cursor.execute("SELECT id FROM Funcionario WHERE id = %s", (pessoa_id,))
                if not cursor.fetchone():
                    cursor.execute("INSERT INTO Funcionario (id, matricula, data_admissao, data_saida, tipo_contrato) VALUES (%s,%s,%s,%s,%s)",
                                   (pessoa_id, matricula, data_adm, data_saida, tipo_contrato))
                    conn.commit()
                
                # 3. PROFESSOR
                cursor.execute("SELECT id FROM Professor WHERE id = %s", (pessoa_id,))
                if not cursor.fetchone():
                    cursor.execute("INSERT INTO Professor (id) VALUES (%s)", (pessoa_id,))
                    conn.commit()
                
                # 4. ADMINISTRADOR (Se for PROFADM)
                if eh_admin:
                    cursor.execute("SELECT id FROM Administrador WHERE id = %s", (pessoa_id,))
                    if not cursor.fetchone():
                        cursor.execute("INSERT INTO Administrador (id) VALUES (%s)", (pessoa_id,))
                        conn.commit()
                        
                print(f"+ Professor '{r.get('Nome')}' garantido no sistema (pessoa id {pessoa_id}).")
            except Exception as e:
                conn.rollback()
                print(f"Erro ao inserir professor (pessoa id {pessoa_id}): {e}")
    else:
        print("  - Aba 'PROFESSOR' não encontrada.")

    # ----------------------------
    # 8) ADMINISTRADOR
    # ----------------------------
    print("\nProcessando aba: ADMINISTRADOR")
    if "ADMINISTRADOR" in all_sheets:
        df = all_sheets["ADMINISTRADOR"].fillna("")
        for _, r in df.iterrows():
            nome = limpar_valor(r.get("Nome"))
            cpf = pad_digits(r.get("CPF"), 11) if r.get("CPF") else None
            pessoa_id = None
            
            # Tenta achar a pessoa existente
            if cpf:
                pessoa_id = find_pessoa_by_cpf(cursor, cpf)
            if not pessoa_id and nome:
                cursor.execute("SELECT id FROM Pessoa WHERE nome = %s", (nome,))
                rr = cursor.fetchone()
                if rr:
                    pessoa_id = rr[0]
                    
            if not pessoa_id:
                # 1. PESSOA (Se não encontrar pessoa, cria nova)
                pessoa_id = inserir_pessoa(cursor, conn, r, "ADMINISTRADOR", r.get("Número do Cartão"), unidade_id_default)
                if not pessoa_id:
                    continue
            
            # 2. FUNCIONARIO (Obrigatório para Administrador)
            try:
                matricula = pad_digits(r.get("Matrícula") or r.get("Matricula"), 6) or None
                data_adm = parse_date(r.get("Data Admissão") or r.get("Data Admissao"))
                data_saida = parse_date(r.get("Data Saída") or r.get("Data Saida"))
                tipo_contrato = limpar_valor(r.get("Tipo Contrato")) or None
                
                cursor.execute("SELECT id FROM Funcionario WHERE id = %s", (pessoa_id,))
                if not cursor.fetchone():
                    cursor.execute("INSERT INTO Funcionario (id, matricula, data_admissao, data_saida, tipo_contrato) VALUES (%s,%s,%s,%s,%s)",
                                   (pessoa_id, matricula, data_adm, data_saida, tipo_contrato))
                    conn.commit()
                
                # 3. ADMINISTRADOR
                cargo = limpar_valor(r.get("Cargo")) or None
                cursor.execute("SELECT id FROM Administrador WHERE id = %s", (pessoa_id,))
                if cursor.fetchone():
                    print(f"Administrador (pessoa id {pessoa_id}) já existe. Pulando.")
                    continue
                
                cursor.execute("INSERT INTO Administrador (id, cargo) VALUES (%s, %s)", (pessoa_id, cargo))
                conn.commit()
                print(f"+ Administrador '{nome}' garantido (pessoa id {pessoa_id}).")
            except Exception as e:
                conn.rollback()
                print(f"Erro ao inserir administrador (pessoa id {pessoa_id}): {e}")
    else:
        print("Aba 'ADMINISTRADOR' não encontrada.")

    # ----------------------------
    # 9) TERCEIRIZADO
    # ----------------------------
    print("\nProcessando aba: TERCEIRIZADO")
    if "TERCEIRIZADO" in all_sheets:
        df = all_sheets["TERCEIRIZADO"].fillna("")
        for _, r in df.iterrows():
            # 1. PESSOA
            pessoa_id = inserir_pessoa(cursor, conn, r, "TERCEIRIZADO", r.get("Número do Cartão"), unidade_id_default)
            if not pessoa_id:
                continue
                
            matricula = pad_digits(r.get("Matrícula (específica)") or r.get("Matrícula (Nº)") or r.get("Matricula"), 6)
            data_adm = parse_date(r.get("Data Admissão") or r.get("Data Admissao"))
            data_saida = parse_date(r.get("Data Saída") or r.get("Data Saida"))
            tipo_contrato = limpar_valor(r.get("Tipo Contrato")) or None
            funcao = limpar_valor(r.get("Função") or r.get("Funcao")) or None
            
            try:
                # 2. FUNCIONARIO (Obrigatório para Terceirizado)
                cursor.execute("SELECT id FROM Funcionario WHERE id = %s", (pessoa_id,))
                if not cursor.fetchone():
                    cursor.execute("INSERT INTO Funcionario (id, matricula, data_admissao, data_saida, tipo_contrato) VALUES (%s,%s,%s,%s,%s)",
                                   (pessoa_id, matricula, data_adm, data_saida, tipo_contrato))
                    conn.commit()
                
                # 3. TERCEIRIZADO
                cursor.execute("SELECT id FROM Terceirizado WHERE id = %s", (pessoa_id,))
                if not cursor.fetchone():
                    cursor.execute("INSERT INTO Terceirizado (id, empresa_id, funcao) VALUES (%s,%s,%s)", (pessoa_id, None, funcao))
                    conn.commit()
                print(f"+ Terceirizado '{r.get('Nome')}' garantido (pessoa id {pessoa_id}).")
            except Exception as e:
                conn.rollback()
                print(f" Erro ao inserir terceirizado (pessoa id {pessoa_id}): {e}")
    else:
        print("- Aba 'TERCEIRIZADO' não encontrada.")

    # ----------------------------
    # Finalização
    # ----------------------------
    print("\nImportação finalizada. Fechando conexão.")
    cursor.close()
    conn.close()

if __name__ == "__main__":
    import sys

    # Primeiro argumento = path do arquivo
    excel_file = sys.argv[1] if len(sys.argv) > 1 else None
    if not excel_file:
        print("Nenhum arquivo Excel informado.")
        sys.exit(1)

    # Segundo argumento opcional = ID da unidade
    unidade_id = int(sys.argv[2]) if len(sys.argv) > 2 else None

    main(excel_file=excel_file, unidade_id_default=unidade_id)
