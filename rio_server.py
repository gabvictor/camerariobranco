#!/usr/bin/env python3
"""
rio_server.py — Servidor Flask autônomo da página /rio (nível do Rio Acre em Rio Branco).

Serve, 100% em Python:
    GET /rio                        a página (public/rio.html)
    GET /api/rio-acre               nível atual + frescor da leitura
    GET /api/rio-acre/historico     ?dias=30  (24 h por hora + dias agregados)
    GET /api/rio-acre/previsao      estimativa de tendência (não é previsão oficial)
    GET /api/health                 saúde do serviço
    GET /status-cameras             status das 2 câmeras da página
    GET /proxy/camera/<codigo>      imagem da câmera (somente códigos permitidos)
    /script, /css, /assets          arquivos estáticos de public/

Execução:
    pip install -r requirements-rio.txt
    python rio_server.py --port 5000
    # produção:  gunicorn -w 2 -b 0.0.0.0:5000 rio_server:app

Variáveis de ambiente úteis: ANA_HIDROWEB_USUARIO, ANA_HIDROWEB_SENHA, ANA_DATA_UTC_OFFSET,
RIO_STALE_MINUTES, RIO_CAMERAS (padrão "001334,001426"), RIO_TRUST_PROXY (nº de proxies reversos, ex. 1),
RIO_CORS_ORIGIN (vazio = sem CORS), RIO_RATE_LIMIT (requisições/min por IP, padrão 120).
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
import time
from collections import deque

import requests
from flask import Flask, Response, abort, jsonify, redirect, request, send_file, send_from_directory

from rio_service import DadosIndisponiveis, RioAcreService, STALE_MINUTES

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
OFFLINE_IMAGE = os.path.join(PUBLIC_DIR, "assets", "offline.png")
STATIC_DIRS = {"script", "css", "assets", ".well-known"}
STATIC_FILES = {"manifest.json", "robots.txt", "ads.txt"}

CAMERAS = tuple(c.strip() for c in os.environ.get("RIO_CAMERAS", "001334,001426").split(",") if c.strip())
CAMERA_URL = "https://cameras.riobranco.ac.gov.br/api/camera"
MIN_IMAGE_BYTES = int(os.environ.get("MIN_IMAGE_SIZE_KB", "25")) * 1024
OFFLINE_SENTINEL_BYTES = 20500  # tamanho da imagem "sem sinal" que a prefeitura devolve
MAX_IMAGE_BYTES = 8 * 1024 * 1024
RATE_LIMIT = int(os.environ.get("RIO_RATE_LIMIT", "120"))

log = logging.getLogger("rio_server")


class _SnapshotCache:
    """Cache curto (3,5 s) das imagens, para não sobrecarregar a API da prefeitura."""

    def __init__(self, ttl: float = 3.5):
        self.ttl, self._items, self._lock = ttl, {}, threading.Lock()

    def get(self, code: str):
        with self._lock:
            item = self._items.get(code)
            return item[1] if item and time.time() - item[0] < self.ttl else None

    def put(self, code: str, value) -> None:
        with self._lock:
            self._items[code] = (time.time(), value)


def create_app(service: RioAcreService | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    rio = service or RioAcreService()
    snapshots = _SnapshotCache()
    status_cache: dict = {"at": 0.0, "value": []}
    hits: dict[str, deque] = {}
    hits_lock = threading.Lock()

    if os.environ.get("RIO_TRUST_PROXY"):  # só habilite atrás de um proxy reverso confiável
        from werkzeug.middleware.proxy_fix import ProxyFix
        n = int(os.environ["RIO_TRUST_PROXY"])
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=n, x_proto=n, x_host=n)

    # ── Cabeçalhos, CORS e limite de requisições ──────────────────────────────────
    @app.before_request
    def limitar():
        if not request.path.startswith(("/api/", "/status-cameras")) or RATE_LIMIT <= 0:  # imagens já têm cache de 3,5 s
            return None
        ip, agora = request.remote_addr or "?", time.time()
        with hits_lock:
            fila = hits.setdefault(ip, deque())
            while fila and agora - fila[0] > 60:
                fila.popleft()
            if len(fila) >= RATE_LIMIT:
                return jsonify({"erro": "Muitas requisições. Aguarde um instante."}), 429
            fila.append(agora)
            if len(hits) > 5000:  # evita crescimento ilimitado do dicionário
                for chave in [k for k, v in hits.items() if not v or agora - v[-1] > 60]:
                    hits.pop(chave, None)
        return None

    @app.after_request
    def cabecalhos(resp: Response):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        origem = os.environ.get("RIO_CORS_ORIGIN")
        if origem and request.path.startswith("/api/"):
            resp.headers["Access-Control-Allow-Origin"] = origem
        return resp

    # ── Página ────────────────────────────────────────────────────────────────────
    @app.get("/")
    def raiz():
        return redirect("/rio", code=302)

    @app.get("/rio")
    def pagina_rio():
        resp = send_from_directory(PUBLIC_DIR, "rio.html", mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/rio.html")
    def pagina_rio_html():
        return redirect("/rio", code=301)

    # ── API do rio ────────────────────────────────────────────────────────────────
    def responder(funcao, cache_segundos: int):
        try:
            dados = funcao()
        except DadosIndisponiveis as exc:
            log.error("Telemetria indisponível: %s", exc)
            resp = jsonify({
                "estado": "indisponivel",
                "mensagem": "Não foi possível obter a leitura da estação da ANA agora. "
                            "Nenhum valor é exibido para evitar informação falsa.",
            })
            resp.status_code = 503
            resp.headers["Cache-Control"] = "no-store"
            resp.headers["Retry-After"] = "60"
            return resp
        except Exception:  # noqa: BLE001
            log.exception("Erro inesperado na telemetria")
            resp = jsonify({"estado": "erro", "mensagem": "Erro interno ao consultar a telemetria."})
            resp.status_code = 500
            resp.headers["Cache-Control"] = "no-store"
            return resp
        resp = jsonify(dados)
        resp.headers["Cache-Control"] = f"public, max-age={cache_segundos}"
        return resp

    @app.get("/api/rio-acre")
    def api_nivel():
        return responder(rio.get_nivel, 60)

    @app.get("/api/rio-acre/historico")
    def api_historico():
        dias = request.args.get("dias", default=30, type=int) or 30
        return responder(lambda: rio.get_historico(dias), 300)

    @app.get("/api/rio-acre/previsao")
    def api_previsao():
        return responder(rio.get_previsao, 300)

    # A página também chama rotas do site completo (rastreio de visitas e presença). No servidor
    # autônomo elas não existem: 204 evita erros no console e reconexões infinitas do EventSource.
    @app.route("/api/track-visit", methods=["POST"])
    @app.route("/api/track-share", methods=["POST"])
    @app.get("/api/presence/stream")
    @app.get("/api/presence/home")
    def sem_conteudo():
        return "", 204

    @app.get("/api/health")
    def api_health():
        return jsonify({"status": "ok", "servico": "rio-acre", "estacao": rio.station["codigo"],
                        "limiteDesatualizadoMin": STALE_MINUTES, "python": sys.version.split()[0]})

    # ── Câmeras (apenas as da página, nunca códigos arbitrários) ─────────────────
    def buscar_imagem(code: str):
        """Devolve (bytes, content_type) ou None se a câmera estiver sem sinal."""
        em_cache = snapshots.get(code)
        if em_cache is not None:
            return em_cache or None
        try:
            r = requests.get(
                CAMERA_URL, params={"code": code, "timestamp": int(time.time() * 1000)}, timeout=6, stream=True,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                         "Referer": "https://deolhonotransito.riobranco.ac.gov.br",
                         "Origin": "https://deolhonotransito.riobranco.ac.gov.br",
                         "Accept": "image/jpeg,image/webp,image/*,*/*"})
            r.raise_for_status()
            corpo = r.raw.read(MAX_IMAGE_BYTES + 1, decode_content=True)
            r.close()
        except requests.RequestException as exc:
            log.warning("Câmera %s indisponível: %s", code, exc)
            snapshots.put(code, b"")
            return None
        if len(corpo) > MAX_IMAGE_BYTES or len(corpo) < MIN_IMAGE_BYTES or len(corpo) == OFFLINE_SENTINEL_BYTES:
            snapshots.put(code, b"")
            return None
        valor = (corpo, r.headers.get("content-type", "image/jpeg"))
        snapshots.put(code, valor)
        return valor

    @app.get("/proxy/camera/<code>")
    def proxy_camera(code: str):
        if code not in CAMERAS:
            abort(404)
        imagem = buscar_imagem(code)
        if imagem is None:
            return send_file(OFFLINE_IMAGE, mimetype="image/png"), 404
        corpo, tipo = imagem
        return Response(corpo, mimetype=tipo, headers={"Cache-Control": "public, max-age=3, stale-while-revalidate=5"})

    @app.get("/status-cameras")
    def status_cameras():
        if time.time() - status_cache["at"] > 60:
            status_cache["value"] = [
                {"codigo": c, "status": "online" if buscar_imagem(c) else "offline"} for c in CAMERAS]
            status_cache["at"] = time.time()
        return jsonify(status_cache["value"])

    # ── Estáticos (lista branca de pastas) e 404 ────────────────────────────────
    @app.get("/<path:caminho>")
    def estaticos(caminho: str):
        primeiro = caminho.split("/", 1)[0]
        if primeiro in STATIC_DIRS or caminho in STATIC_FILES:
            return send_from_directory(PUBLIC_DIR, caminho)
        abort(404)

    @app.errorhandler(404)
    def nao_encontrado(_):
        pagina = os.path.join(PUBLIC_DIR, "404.html")
        if request.path.startswith(("/api/", "/proxy/")) or not os.path.exists(pagina):
            return jsonify({"erro": "Não encontrado"}), 404
        return send_file(pagina, mimetype="text/html"), 404

    return app


app = create_app()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Servidor Python da página /rio")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"), help="padrão 127.0.0.1 (use 0.0.0.0 em Docker)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5000)))
    args = parser.parse_args()
    print(f"Estação {RioAcreService.station['codigo']} — http://{args.host}:{args.port}/rio")
    app.run(host=args.host, port=args.port, debug=False, threaded=True)
