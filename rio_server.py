#!/usr/bin/env python3
"""
Servidor Web Python para a página do Rio Acre (/rio)
Desenvolvido em Flask para monitoramento hidrológico em tempo real.
Permite rodar a página e APIs do Rio Acre de forma 100% autônoma em Python.

Uso:
    python rio_server.py
    python rio_server.py --port 5000 --host 0.0.0.0
"""

import os
import sys
import argparse
from flask import Flask, jsonify, request, send_from_directory, send_file, render_template_string
from rio_service import RioAcrePythonService

# Diretório raiz e pasta pública
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="")
rio_service = RioAcrePythonService()

@app.after_request
def add_cors_and_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

# ─── ROTAS DE PÁGINA (FRONTEND) ──────────────────────────────────────────────

@app.route("/")
@app.route("/rio")
def render_rio_page():
    """Entrega a página oficial do Rio Acre."""
    rio_html_path = os.path.join(PUBLIC_DIR, "rio.html")
    if not os.path.exists(rio_html_path):
        return "Arquivo public/rio.html não encontrado.", 404
    
    with open(rio_html_path, "r", encoding="utf-8") as f:
        content = f.read()

    return content, 200, {"Content-Type": "text/html; charset=utf-8"}

# ─── ROTAS DA API REST (BACKEND TELEMÉTRICO) ──────────────────────────────────

@app.route("/api/rio-acre", methods=["GET"])
def api_rio_acre():
    """
    GET /api/rio-acre
    Retorna os dados consolidados do nível do Rio Acre em tempo real.
    """
    try:
        data = rio_service.get_nivel_rio_acre()
        return jsonify(data), 200
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500

@app.route("/api/rio-acre/historico", methods=["GET"])
def api_rio_acre_historico():
    """
    GET /api/rio-acre/historico?dias=30
    Retorna séries históricas agregadas (24 horas e dias solicitados).
    """
    try:
        dias = request.args.get("dias", default=30, type=int)
        data = rio_service.get_historico_rio_acre(dias=dias)
        return jsonify(data), 200
    except Exception as e:
        return jsonify({"error": str(e), "status": "error"}), 500

@app.route("/api/health", methods=["GET"])
def api_health():
    """GET /api/health - Verificação de saúde da aplicação Python."""
    return jsonify({
        "status": "healthy",
        "service": "RioAcre Python Server",
        "python_version": sys.version,
        "station": rio_service.station["nome"]
    }), 200

# ─── ARQUIVOS ESTÁTICOS ──────────────────────────────────────────────────────

@app.route("/<path:filename>")
def serve_static(filename):
    """Serve arquivos estáticos da pasta public (css, scripts, assets, etc)."""
    return send_from_directory(PUBLIC_DIR, filename)

# ─── INICIALIZAÇÃO DO SERVIDOR ───────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Servidor Python - Monitoramento Rio Acre")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5000)), help="Porta do servidor (padrao: 5000)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host de escuta (padrao: 0.0.0.0)")
    args = parser.parse_args()

    print("=" * 60)
    print("SERVIDOR PYTHON - MONITORAMENTO DO RIO ACRE")
    print("=" * 60)
    print(f"Estacao: {rio_service.station['nome']} ({rio_service.station['codigo']})")
    print(f"Servidor rodando em: http://localhost:{args.port}/rio")
    print(f"API Tempo Real:      http://localhost:{args.port}/api/rio-acre")
    print(f"API Historico:       http://localhost:{args.port}/api/rio-acre/historico?dias=30")
    print("=" * 60)

    app.run(host=args.host, port=args.port, debug=False)
