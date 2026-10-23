"""
rio_service.py — Telemetria do Rio Acre (estação 13600002, Rio Branco - Ponte Metálica).

Fonte dos dados: ANA / SGB-CPRM (Rede Hidrometeorológica Nacional).

Ordem das fontes (da melhor para a pior):
    1. API HidroWebService (autenticada, traz código de qualidade por leitura)
    2. WebService legado em XML (sem qualidade)
    3. Cache anterior, SEMPRE marcado como "desatualizado"
    4. Nada: levanta DadosIndisponiveis (a API HTTP responde 503)

Regras importantes deste módulo:
    * NUNCA inventa leitura. Se não há dado real, o erro é explícito.
    * Todo resultado leva a idade da leitura ("frescor") e um sinal de desatualizado.
    * A previsão é só uma extrapolação da tendência recente (não é modelo hidrológico).

Configuração por variáveis de ambiente:
    ANA_HIDROWEB_USUARIO / ANA_HIDROWEB_SENHA   credenciais da HidroWeb (ou "hidroWebANA" no serviceAccountKey.json)
    ANA_DATA_UTC_OFFSET     fuso em que a ANA publica as datas (padrão "-05:00", hora local de Rio Branco)
    RIO_STALE_MINUTES       idade (min) a partir da qual a leitura é "desatualizada" (padrão 120)
    RIO_CACHE_TTL_SEC       validade do cache do nível atual (padrão 600)
    RIO_HISTORY_TTL_SEC     validade do cache do histórico (padrão 1800)
    ANA_LEGACY_URLS         URLs do webservice legado separadas por vírgula (padrão: https e depois http)

Uso por linha de comando:
    python rio_service.py --action nivel|historico|previsao [--dias 30]
"""

from __future__ import annotations

import base64
import json
import logging
import math
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import requests

try:  # defusedxml protege contra XML malicioso (a URL legada pode ser http)
    from defusedxml import ElementTree as ET
except ImportError:  # pragma: no cover
    import xml.etree.ElementTree as ET

logger = logging.getLogger("RioAcre")

# Acre está em UTC-5 o ano todo (sem horário de verão). Offset fixo evita depender do
# pacote tzdata, que não existe por padrão no Windows.
RB_TZ = timezone(timedelta(hours=-5), "America/Rio_Branco")


# ─── Configuração ────────────────────────────────────────────────────────────────

def _parse_offset(text: str | None, default: timezone = RB_TZ) -> timezone:
    m = re.fullmatch(r"\s*([+-])(\d{1,2}):?(\d{2})?\s*", text or "")
    if not m:
        return default
    delta = timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0))
    return timezone(delta if m.group(1) == "+" else -delta)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


ANA_DATA_TZ = _parse_offset(os.environ.get("ANA_DATA_UTC_OFFSET", "-05:00"))
STALE_MINUTES = _env_int("RIO_STALE_MINUTES", 120)
NIVEL_TTL_SEC = _env_int("RIO_CACHE_TTL_SEC", 600)
HISTORICO_TTL_SEC = _env_int("RIO_HISTORY_TTL_SEC", 1800)

ESTACAO = {
    "codigo": "13600002",
    "estcodigo": "95967480",
    "nome": "Rio Branco - Ponte Metálica",
    "rio": "Rio Acre",
    "municipio": "Rio Branco",
    "estado": "AC",
    "responsavel": "ANA",
    "operadora": "SGB-CPRM",
}

# Cotas oficiais (relatório SAH/SGB da bacia do Rio Acre): atenção 12,5 m, alerta 13,5 m,
# inundação/transbordamento 14,0 m.
COTA_ATENCAO = 12.50
COTA_ALERTA = 13.50
COTA_TRANSBORDAMENTO = 14.00

# Valores de REFERÊNCIA exibidos como contexto. Não alimentam nenhum cálculo de previsão.
# - Recorde de cheia: 18,40 m em 04/03/2015 (Portal Amazônia, "maiores enchentes de Rio Branco desde 1971").
# - Recorde de seca: 1,23 m em 21/09/2024 (valor que já estava no site; o boletim do SGB de 20/09/2024
#   ainda listava 1,24 m em 2022 como mínima, então CONFIRA com o SGB antes de divulgar).
# - Médias mensais: valores aproximados que já estavam no site; sem fonte citada. Tratar como indicativo.
RECORDE_CHEIA = {"nivel": 18.40, "data": "04/03/2015"}
RECORDE_SECA = {"nivel": 1.23, "data": "21/09/2024"}
CLIMATOLOGIA = {
    1: (9.50, "Início da Cheia"), 2: (11.80, "Pico de Cheias"), 3: (12.20, "Pico de Cheias"),
    4: (9.80, "Início da Descida"), 5: (6.50, "Transição p/ Seca"), 6: (3.80, "Estiagem"),
    7: (2.50, "Seca Típica"), 8: (1.80, "Seca Severa"), 9: (1.60, "Mínima do Ano"),
    10: (1.95, "Transição p/ Chuvas"), 11: (4.20, "Elevação das Águas"), 12: (7.10, "Inverno Amazônico"),
}
MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
         "Setembro", "Outubro", "Novembro", "Dezembro"]
DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
DIAS_SEMANA_COMPLETO = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
                        "sexta-feira", "sábado", "domingo"]


class DadosIndisponiveis(Exception):
    """Nenhuma fonte respondeu e não existe cache: não há leitura real para mostrar."""


# ─── Utilidades ──────────────────────────────────────────────────────────────────

def to_float(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return None if (isinstance(value, float) and math.isnan(value)) else float(value)
    text = str(value).strip().replace(",", ".")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return None if math.isnan(number) else number


_FORMATOS = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y %H:%M:%S",
             "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%d/%m/%Y")


def parse_ana_datetime(value) -> datetime | None:
    """Converte a data da ANA para datetime com fuso de Rio Branco.

    Sem fuso explícito na string, assume ANA_DATA_UTC_OFFSET (padrão: hora local de Rio Branco).
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = re.sub(r"(\d{2}:\d{2}:\d{2})\.\d+", r"\1", text)  # tira frações de segundo

    tz = ANA_DATA_TZ
    m = re.search(r"(Z|[+-]\d{2}:?\d{2})$", text) if ":" in text else None
    if m:
        tz = timezone.utc if m.group(1) == "Z" else _parse_offset(m.group(1))
        text = text[: m.start()].strip()

    for fmt in _FORMATOS:
        try:
            naive = datetime.strptime(text, fmt)
        except ValueError:
            continue
        return naive.replace(tzinfo=tz).astimezone(RB_TZ)
    return None


def normalize_quality(code) -> dict:
    """Códigos de qualidade da ANA: 0 OK, 1 suspeito, 2 ruim."""
    number = to_float(code)
    if number is None:
        return {"codigo": -1, "status": "DESCONHECIDO", "confiavel": True}
    number = int(number)
    if number == 0:
        return {"codigo": 0, "status": "OK", "confiavel": True}
    if number == 1:
        return {"codigo": 1, "status": "SUSPEITO", "confiavel": False}
    if number == 2:
        return {"codigo": 2, "status": "RUIM", "confiavel": False}
    return {"codigo": number, "status": "DESCONHECIDO", "confiavel": True}


def fmt_num(value: float, casas: int = 2) -> str:
    return f"{value:.{casas}f}".replace(".", ",")


def fmt_data_hora(dt: datetime) -> str:
    return dt.astimezone(RB_TZ).strftime("%d/%m/%Y às %H:%M")


def status_por_cota(nivel_m: float) -> dict:
    if nivel_m >= COTA_TRANSBORDAMENTO:
        tipo, cor, bg = "Transbordamento", "red", "bg-red-600"
        badge = "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
    elif nivel_m >= COTA_ALERTA:
        tipo, cor, bg = "Alerta", "amber", "bg-amber-500"
        badge = "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
    elif nivel_m < 1.50:
        tipo, cor, bg = "Seca Severa", "rose", "bg-rose-600"
        badge = "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
    elif nivel_m < 3.00:
        tipo, cor, bg = "Nível Baixo / Estiagem", "orange", "bg-orange-500"
        badge = "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800"
    else:
        tipo, cor, bg = "Normal", "emerald", "bg-emerald-500"
        badge = "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
    return {"tipo": tipo, "color": cor, "statusBg": bg, "badgeBg": badge}


def _first(item: dict, *keys):
    for key in keys:
        if key in item and item[key] is not None:
            return item[key]
    return None


def _make_reading(dt, raw_level, vazao=None, chuva=None, q_cota=None, q_chuva=None, q_vazao=None,
                  atualizacao=None) -> dict | None:
    level = to_float(raw_level)
    if dt is None or level is None or level <= 0:
        return None
    # A ANA às vezes manda em cm (ex.: 176 = 1,76 m). Rio Acre nunca passa de ~19 m.
    nivel_m = level / 100.0 if level > 30 else level
    return {
        "dt": dt,
        "nivel_m": round(nivel_m, 2),
        "vazao": to_float(vazao),
        "chuva": to_float(chuva),
        "q_cota": normalize_quality(q_cota),
        "q_chuva": normalize_quality(q_chuva),
        "q_vazao": normalize_quality(q_vazao),
        "atualizacao": atualizacao,
    }


# ─── Cliente HidroWebService (fonte primária) ────────────────────────────────────

class HidroWebClient:
    BASE_URL = "https://www.ana.gov.br/hidrowebservice"
    RANGES = ((2, "DIAS_2"), (7, "DIAS_7"), (14, "DIAS_14"), (21, "DIAS_21"), (30, "DIAS_30"))

    def __init__(self, session: requests.Session | None = None, base_url: str | None = None, timeout: int = 20):
        self.session = session or requests.Session()
        self.base_url = (base_url or os.environ.get("ANA_HIDROWEB_URL") or self.BASE_URL).rstrip("/")
        self.timeout = timeout
        self._token: str | None = None
        self._token_exp = 0.0
        self._lock = threading.Lock()

    # credenciais ------------------------------------------------------------------
    @staticmethod
    def credentials() -> tuple[str, str] | None:
        user = (os.environ.get("ANA_HIDROWEB_USUARIO") or os.environ.get("ANA_HIDROWEB_IDENTIFICADOR")
                or os.environ.get("ANA_HIDROWEB_LOGIN"))
        pwd = os.environ.get("ANA_HIDROWEB_SENHA") or os.environ.get("ANA_HIDROWEB_PASSWORD")
        if user and pwd:
            return user.strip(), pwd.strip()

        candidates = [os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH"), "/etc/secrets/serviceAccountKey.json",
                      os.path.join(os.getcwd(), "serviceAccountKey.json")]
        for path in filter(None, candidates):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except (OSError, ValueError):
                continue
            cfg = next((data[k] for k in ("hidroWebANA", "hidrowebana", "ana", "hidroWeb", "hidroweb")
                        if isinstance(data.get(k), dict)), None)
            if cfg:
                u = cfg.get("usuario") or cfg.get("identificador") or cfg.get("email") or cfg.get("login") or cfg.get("user")
                p = cfg.get("senha") or cfg.get("password") or cfg.get("pass")
                if u and p:
                    return str(u).strip(), str(p).strip()
        return None

    def available(self) -> bool:
        return self.credentials() is not None

    # autenticação -----------------------------------------------------------------
    def _authenticate(self) -> str:
        creds = self.credentials()
        if not creds:
            raise RuntimeError("Credenciais da HidroWeb não configuradas")
        resp = self.session.get(
            f"{self.base_url}/EstacoesTelemetricas/OAUth/v1",
            headers={"Identificador": creds[0], "Senha": creds[1], "Accept": "application/json",
                     "User-Agent": "CamRB-RioAcre/3.0"},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        try:
            body = resp.json()
        except ValueError:
            body = resp.text

        token = None
        if isinstance(body, str) and len(body) > 20:
            token = body
        elif isinstance(body, dict):
            items = body.get("items", body)
            if isinstance(items, str):
                token = items
            elif isinstance(items, dict):
                token = next((items[k] for k in ("tokenautenticacao", "tokenAutenticacao", "access_token",
                                                 "accessToken", "token") if items.get(k)), None)
        if not isinstance(token, str) or not token.strip():
            raise RuntimeError("Resposta de autenticação da ANA sem token")
        token = token.strip()
        self._token = token
        self._token_exp = self._jwt_expiration(token)
        return token

    @staticmethod
    def _jwt_expiration(token: str) -> float:
        try:
            payload = token.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            exp = json.loads(base64.urlsafe_b64decode(payload)).get("exp")
            if isinstance(exp, (int, float)):
                return float(exp)
        except Exception:  # noqa: BLE001 - JWT mal formado: usa TTL padrão
            pass
        return time.time() + 12 * 3600

    def _get_token(self, force: bool = False) -> str:
        with self._lock:
            if not force and self._token and time.time() < self._token_exp - 300:
                return self._token
            return self._authenticate()

    # consultas --------------------------------------------------------------------
    def _request(self, endpoint: str, params: dict, retry: bool = True):
        token = self._get_token()
        resp = self.session.get(
            f"{self.base_url}{endpoint}", params=params, timeout=self.timeout,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json",
                     "User-Agent": "CamRB-RioAcre/3.0"},
        )
        if resp.status_code in (401, 403) and retry:
            self._get_token(force=True)
            return self._request(endpoint, params, retry=False)
        resp.raise_for_status()
        return resp.json()

    @classmethod
    def range_for(cls, dias: int) -> str:
        return next((name for limite, name in cls.RANGES if dias <= limite), "DIAS_30")

    @staticmethod
    def _items(payload) -> list:
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            items = payload.get("items")
            if isinstance(items, list):
                return items
            if isinstance(items, dict):
                return next((v for v in items.values() if isinstance(v, list)), [items])
        return []

    def readings(self, codigo: str, dias: int) -> list[dict]:
        params = {"Codigos_Estacoes": codigo, "Tipo Filtro Data": "DATA_LEITURA",
                  "Range Intervalo de busca": self.range_for(dias)}
        try:
            payload = self._request("/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v2", params)
        except requests.RequestException:
            payload = self._request("/EstacoesTelemetricas/HidroinfoanaSerieTelemetricaAdotada/v1", params)
        out = []
        for item in self._items(payload):
            if not isinstance(item, dict):
                continue
            dt = parse_ana_datetime(_first(item, "Data_Hora_Medicao", "DataHoraMedicao", "Data_Hora", "DataHora",
                                           "Data_Leitura", "DataHoraLeitura", "Data_Medicao", "data_hora_medicao",
                                           "data_hora"))
            reading = _make_reading(
                dt,
                _first(item, "Cota_Adotada", "Cota", "Nivel", "Nivel_Adotado", "Cota_Bruta", "Nivel_Bruto",
                       "cota_adotada", "cota"),
                vazao=_first(item, "Vazao_Adotada", "Vazao", "Vazao_Bruta", "vazao_adotada", "vazao"),
                chuva=_first(item, "Chuva_Adotada", "Chuva", "Chuva_Bruta", "chuva_adotada", "chuva"),
                q_cota=_first(item, "Cota_Adotada_Status", "Status_Cota", "Qualidade_Cota", "StatusCota",
                              "cota_adotada_status"),
                q_chuva=_first(item, "Chuva_Adotada_Status", "Status_Chuva", "Qualidade_Chuva", "StatusChuva",
                               "chuva_adotada_status"),
                q_vazao=_first(item, "Vazao_Adotada_Status", "Status_Vazao", "Qualidade_Vazao", "StatusVazao",
                               "vazao_adotada_status"),
                atualizacao=parse_ana_datetime(_first(item, "Data_Atualizacao", "Data_Hora_Atualizacao",
                                                      "DataUltimaAtualizacao", "data_hora_atualizacao",
                                                      "data_atualizacao")),
            )
            if reading:
                out.append(reading)
        return out


# ─── Cliente do webservice legado (reserva) ──────────────────────────────────────

class LegacyAnaClient:
    DEFAULT_URLS = (
        "https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos",
        "http://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos",
    )

    def __init__(self, session: requests.Session | None = None, timeout: int = 25):
        self.session = session or requests.Session()
        self.timeout = timeout
        env = os.environ.get("ANA_LEGACY_URLS")
        self.urls = tuple(u.strip() for u in env.split(",") if u.strip()) if env else self.DEFAULT_URLS

    @staticmethod
    def parse_xml(xml_text: str) -> list[dict]:
        root = ET.fromstring(xml_text)
        out = []
        for node in root.iter():
            if node.tag.rsplit("}", 1)[-1] != "DadosHidrometereologicos":
                continue
            fields = {child.tag.rsplit("}", 1)[-1]: (child.text or "").strip() for child in node}
            reading = _make_reading(
                parse_ana_datetime(fields.get("DataHora")),
                fields.get("Nivel") or fields.get("Cota"),
                vazao=fields.get("Vazao"),
                chuva=fields.get("Chuva"),
            )
            if reading:
                out.append(reading)
        return out

    def readings(self, codigo: str, dias: int) -> list[dict]:
        hoje = datetime.now(RB_TZ)
        params = {"codEstacao": codigo, "dataInicio": (hoje - timedelta(days=dias)).strftime("%d/%m/%Y"),
                  "dataFim": hoje.strftime("%d/%m/%Y")}
        last_error: Exception | None = None
        for url in self.urls:
            try:
                resp = self.session.get(url, params=params, timeout=self.timeout,
                                        headers={"User-Agent": "CamRB-RioAcre/3.0", "Accept": "application/xml, text/xml"})
                resp.raise_for_status()
                if "<ErrorTable>" in resp.text:
                    raise RuntimeError("WebService legado retornou ErrorTable")
                readings = self.parse_xml(resp.text)
                if readings:
                    return readings
                raise RuntimeError("XML legado sem leituras válidas")
            except Exception as exc:  # noqa: BLE001 - tenta a próxima URL
                last_error = exc
        raise last_error or RuntimeError("Sem URL legada configurada")


# ─── Serviço ─────────────────────────────────────────────────────────────────────

class RioAcreService:
    station = ESTACAO

    def __init__(self, hidroweb: HidroWebClient | None = None, legacy: LegacyAnaClient | None = None, clock=None):
        self.hidroweb = hidroweb or HidroWebClient()
        self.legacy = legacy or LegacyAnaClient()
        self._clock = clock or (lambda: datetime.now(RB_TZ))
        self._cache: dict[int, dict] = {}
        self._lock = threading.RLock()

    # --- carregamento de séries ---------------------------------------------------
    def _now(self) -> datetime:
        return self._clock()

    @staticmethod
    def _bucket(dias: int) -> int:
        return next((b for b in (2, 7, 14, 21, 30) if dias <= b), dias)

    def _sources(self):
        if self.hidroweb.available():
            yield "HidroWebService (ANA)", self.hidroweb
        yield "WebService Legado (ANA)", self.legacy

    @staticmethod
    def _clean(readings: list[dict]) -> list[dict]:
        """Ordena por data, remove duplicatas e descarta leituras com qualidade RUIM."""
        unique = {}
        for r in readings:
            if r["q_cota"]["status"] == "RUIM":
                continue
            unique[r["dt"]] = r
        return [unique[k] for k in sorted(unique)]

    def _load_series(self, dias: int, ttl: int) -> dict:
        dias = max(1, int(dias))
        key = self._bucket(dias)
        with self._lock:
            now = time.time()
            entry = self._cache.get(key)
            if entry and now - entry["fetched"] < ttl:
                return {**entry, "stale_cache": False}

            errors = []
            for fonte, client in self._sources():
                try:
                    readings = self._clean(client.readings(self.station["codigo"], key))
                    if not readings:
                        raise RuntimeError("fonte respondeu sem leituras válidas")
                    entry = {"readings": readings, "fonte": fonte, "fetched": now}
                    self._cache[key] = entry
                    return {**entry, "stale_cache": False}
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{fonte}: {exc}")
                    logger.warning("Falha em %s: %s", fonte, exc)

            if entry:  # dado real, porém velho: devolve marcado como desatualizado
                return {**entry, "stale_cache": True}
            raise DadosIndisponiveis("; ".join(errors) or "nenhuma fonte configurada")

    # --- frescor ------------------------------------------------------------------
    def _frescor(self, latest_dt: datetime, fetched: float, stale_cache: bool) -> dict:
        idade = (self._now() - latest_dt).total_seconds() / 60.0
        fuso_suspeito = idade < -5  # leitura "no futuro": fuso da ANA provavelmente mal configurado
        idade = max(idade, 0.0)
        desatualizado = bool(stale_cache or idade > STALE_MINUTES)
        if fuso_suspeito:
            mensagem = "A data da leitura está no futuro; confira ANA_DATA_UTC_OFFSET."
        elif desatualizado:
            mensagem = (f"Última leitura há {self._humanizar(idade)}. A estação ou a conexão com a ANA "
                        f"pode estar com problema; não trate este valor como atual.")
        else:
            mensagem = f"Leitura há {self._humanizar(idade)}."
        return {"idadeMinutos": round(idade), "desatualizado": desatualizado, "limiteMinutos": STALE_MINUTES,
                "falhaAoAtualizar": bool(stale_cache), "fusoSuspeito": fuso_suspeito,
                "buscadoEm": int(fetched * 1000), "mensagem": mensagem}

    @staticmethod
    def _humanizar(minutos: float) -> str:
        minutos = int(round(minutos))
        if minutos < 60:
            return f"{minutos} min"
        horas, resto = divmod(minutos, 60)
        if horas < 48:
            return f"{horas} h {resto:02d} min" if resto else f"{horas} h"
        return f"{horas // 24} dias"

    # --- nível atual --------------------------------------------------------------
    def get_nivel(self) -> dict:
        series = self._load_series(2, NIVEL_TTL_SEC)
        readings = series["readings"]
        latest = readings[-1]

        # Tendência: compara com a leitura mais próxima de 1 hora antes (e exige ao menos 30 min de histórico).
        referencia = next((r for r in reversed(readings) if r["dt"] <= latest["dt"] - timedelta(hours=1)), None)
        if referencia is None and (latest["dt"] - readings[0]["dt"]) >= timedelta(minutes=30):
            referencia = readings[0]
        tendencia, icone, sinal = "Estável", "minus", "="
        if referencia is not None:
            diff = latest["nivel_m"] - referencia["nivel_m"]
            if diff >= 0.02:
                tendencia, icone, sinal = "Subindo", "trending-up", "+"
            elif diff <= -0.02:
                tendencia, icone, sinal = "Descendo", "trending-down", "-"

        nivel_m = latest["nivel_m"]
        frescor = self._frescor(latest["dt"], series["fetched"], series["stale_cache"])
        return {
            "estado": "desatualizado" if frescor["desatualizado"] else "ok",
            "estacao": dict(self.station),
            "nivel": {
                "metros": nivel_m,
                "centimetros": round(nivel_m * 100),
                "formatado": f"{fmt_num(nivel_m)} m",
                "dataLeitura": fmt_data_hora(latest["dt"]),
                "timestamp": int(latest["dt"].timestamp() * 1000),
                "dataAtualizacao": fmt_data_hora(latest["atualizacao"]) if latest["atualizacao"] else None,
                "qualidade": latest["q_cota"],
            },
            "vazao": f"{fmt_num(latest['vazao'], 1)} m³/s" if latest["vazao"] is not None else None,
            "vazaoQualidade": latest["q_vazao"],
            "chuva": f"{fmt_num(latest['chuva'], 1)} mm" if latest["chuva"] is not None else None,
            "chuvaQualidade": latest["q_chuva"],
            "chuvaReferencia": "última leitura",
            "tendencia": {"status": tendencia, "icon": icone, "sinal": sinal},
            "cotas": {
                "secaHistorica": f"{fmt_num(RECORDE_SECA['nivel'])} m",
                "atencao": f"{fmt_num(COTA_ATENCAO)} m",
                "alerta": f"{fmt_num(COTA_ALERTA)} m",
                "transbordamento": f"{fmt_num(COTA_TRANSBORDAMENTO)} m",
                "percentualAlerta": min(round(nivel_m / COTA_ALERTA * 100), 100),
            },
            "status": status_por_cota(nivel_m),
            "fonte": series["fonte"],
            "frescor": frescor,
            "timestamp": int(time.time() * 1000),
        }

    # --- histórico ----------------------------------------------------------------
    def get_historico(self, dias: int = 30) -> dict:
        dias = max(1, min(365, int(dias)))
        series = self._load_series(dias, HISTORICO_TTL_SEC)
        readings = series["readings"]
        latest = readings[-1]["dt"]
        frescor = self._frescor(latest, series["fetched"], series["stale_cache"])

        # 24 h: janela de 24 horas terminando na última leitura, agregada por hora.
        janela = [r for r in readings if r["dt"] > latest - timedelta(hours=24)]
        por_hora: dict[str, list[dict]] = {}
        for r in janela:
            por_hora.setdefault(r["dt"].strftime("%Y-%m-%d %H"), []).append(r)
        leituras24h = []
        for chave in sorted(por_hora):
            valores = [r["nivel_m"] for r in por_hora[chave]]
            dia, hora = chave.split(" ")
            y, mo, d = dia.split("-")
            leituras24h.append({
                "dataHora": f"{d}/{mo} {hora}:00", "hora": f"{hora}:00",
                "dataCompleta": f"{d}/{mo}/{y} às {hora}:00",
                "nivel": round(sum(valores) / len(valores), 2),
                "min": round(min(valores), 2), "max": round(max(valores), 2),
            })
        niveis24 = [r["nivel_m"] for r in janela]
        ini24, fim24 = leituras24h[0]["nivel"], leituras24h[-1]["nivel"]
        var24 = round(fim24 - ini24, 2)
        estatisticas24h = {
            "maiorNivel": {"metros": round(max(niveis24), 2)},
            "menorNivel": {"metros": round(min(niveis24), 2)},
            "mediaPeriodo": round(sum(l["nivel"] for l in leituras24h) / len(leituras24h), 2),
            "variacaoPeriodo": var24,
            "variacaoPercentual": round(var24 / ini24 * 100, 1) if ini24 > 0 else 0.0,
        }

        # Diário
        por_dia: dict[str, list[dict]] = {}
        for r in readings:
            por_dia.setdefault(r["dt"].strftime("%Y-%m-%d"), []).append(r)
        dias_ordenados = sorted(por_dia)[-dias:]
        hoje = self._now().strftime("%Y-%m-%d")
        ontem = (self._now() - timedelta(days=1)).strftime("%Y-%m-%d")

        pontos, anterior = [], None
        for dia in dias_ordenados:
            lista = por_dia[dia]
            valores = [r["nivel_m"] for r in lista]
            media = sum(valores) / len(valores)
            y, mo, d = dia.split("-")
            data_dia = datetime.strptime(dia, "%Y-%m-%d")
            variacao = round(media - anterior, 2) if anterior is not None else 0.0
            pontos.append({
                "data": f"{d}/{mo}", "dataCompleta": f"{d}/{mo}/{y}",
                "diaSemana": DIAS_SEMANA[data_dia.weekday()],
                "diaSemanaCompleto": DIAS_SEMANA_COMPLETO[data_dia.weekday()],
                "isHoje": dia == hoje, "isOntem": dia == ontem,
                "nivel": round(media, 2), "min": round(min(valores), 2), "max": round(max(valores), 2),
                "variacaoDia": variacao,
                "variacaoDiaPct": round(variacao / anterior * 100, 1) if anterior else 0.0,
                "status": status_por_cota(media), "pontosLeitura": len(lista),
            })
            anterior = media

        maior = max(pontos, key=lambda p: p["max"])
        menor = min(pontos, key=lambda p: p["min"])
        inicial, final = pontos[0]["nivel"], pontos[-1]["nivel"]
        var_periodo = round(final - inicial, 2)
        return {
            "estado": "desatualizado" if frescor["desatualizado"] else "ok",
            "periodoDias": dias,
            "diasDisponiveis": len(pontos),
            "fonte": series["fonte"],
            "cotasReferencia": {"secaHistorica": RECORDE_SECA["nivel"], "atencao": COTA_ATENCAO,
                                "alerta": COTA_ALERTA, "transbordamento": COTA_TRANSBORDAMENTO},
            "estatisticas": {
                "maiorNivel": {"metros": maior["max"], "data": maior["dataCompleta"]},
                "menorNivel": {"metros": menor["min"], "data": menor["dataCompleta"]},
                "mediaPeriodo": round(sum(p["nivel"] for p in pontos) / len(pontos), 2),
                "variacaoPeriodo": var_periodo,
                "variacaoPercentual": round(var_periodo / inicial * 100, 1) if inicial > 0 else 0.0,
            },
            "estatisticas24h": estatisticas24h,
            "leituras24h": leituras24h,
            "pontos": pontos,
            "frescor": frescor,
            "timestamp": int(time.time() * 1000),
        }

    # --- estimativa de tendência (NÃO é previsão oficial) -------------------------
    # Fatores de amortecimento empíricos, sem calibração estatística.
    AMORTECIMENTO = {24: 0.8, 48: 0.6, 168: 0.3}

    @staticmethod
    def _regressao(pontos: list[tuple[float, float]]) -> tuple[float, float]:
        """Mínimos quadrados: devolve (inclinação em m/h, desvio-padrão dos resíduos)."""
        n = len(pontos)
        mx = sum(x for x, _ in pontos) / n
        my = sum(y for _, y in pontos) / n
        sxx = sum((x - mx) ** 2 for x, _ in pontos)
        if sxx == 0:
            return 0.0, 0.0
        slope = sum((x - mx) * (y - my) for x, y in pontos) / sxx
        resid = [y - (my + slope * (x - mx)) for x, y in pontos]
        std = math.sqrt(sum(e * e for e in resid) / max(n - 2, 1))
        return slope, std

    def get_previsao(self) -> dict:
        nivel = self.get_nivel()
        series = self._load_series(2, NIVEL_TTL_SEC)
        readings = series["readings"]
        latest = readings[-1]
        agora = self._now()
        mes = agora.month
        media_mes, tipo_mes = CLIMATOLOGIA[mes]
        nivel_atual = latest["nivel_m"]
        diff_media = round(nivel_atual - media_mes, 2)
        frescor = nivel["frescor"]

        base = {
            "tipo": "estimativa-de-tendencia",
            "estado": nivel["estado"],
            "timestamp": int(time.time() * 1000),
            "dataReferencia": fmt_data_hora(latest["dt"]),
            "mesReferencia": MESES[mes - 1],
            "nivelAtual": nivel_atual,
            "frescor": frescor,
            "aviso": ("Extrapolação simples da tendência das últimas 24 h. Não considera chuva prevista nem o "
                      "nível a montante e NÃO substitui os alertas do SGB/CPRM e da Defesa Civil (199)."),
            "comparativoHistorico": {
                "mediaMes": media_mes,
                "diferencaMedia": ("+" if diff_media > 0 else "") + f"{diff_media:.2f} m".replace(".", ","),
                "recordeCheia": RECORDE_CHEIA,
                "recordeSeca": RECORDE_SECA,
                "aviso": "Médias mensais aproximadas, sem fonte oficial citada: use apenas como referência.",
            },
            "climatologiaAnual": [
                {"mes": MESES[i][:3], "nome": MESES[i], "media": CLIMATOLOGIA[i + 1][0], "tipo": CLIMATOLOGIA[i + 1][1]}
                for i in range(12)
            ],
        }
        base.update(self._situacao(nivel_atual))

        janela = [r for r in readings if r["dt"] > latest["dt"] - timedelta(hours=24)]
        span_h = (janela[-1]["dt"] - janela[0]["dt"]).total_seconds() / 3600 if len(janela) > 1 else 0
        if frescor["desatualizado"] or len(janela) < 6 or span_h < 6:
            motivo = ("a última leitura está desatualizada" if frescor["desatualizado"]
                      else "há poucas leituras recentes para estimar a tendência")
            base.update({
                "disponivel": False, "motivo": motivo,
                "direcaoPrevisao": "Indisponível", "iconeDirecao": "minus", "corDirecao": "slate",
                "projecoes": {}, "diagnostico": f"Estimativa indisponível: {motivo}. Cota atual: {fmt_num(nivel_atual)} m.",
            })
            return base

        t0 = janela[0]["dt"]
        slope, std = self._regressao([((r["dt"] - t0).total_seconds() / 3600, r["nivel_m"]) for r in janela])

        def projetar(horas: int) -> dict:
            delta = round(slope * horas * self.AMORTECIMENTO[horas], 2)
            alvo = round(max(0.0, nivel_atual + delta), 2)
            faixa = max(0.04, 2 * std) * math.sqrt(horas / 24)
            return {"nivel": alvo, "delta": ("+" if delta > 0 else "") + f"{delta:.2f} m".replace(".", ","),
                    "min": round(max(0.0, alvo - faixa), 2), "max": round(alvo + faixa, 2),
                    "tendencia": "Elevação" if delta > 0.03 else "Queda" if delta < -0.03 else "Estabilidade",
                    "_delta": delta}

        p24, p48, p7d = projetar(24), projetar(48), projetar(168)
        p7d["tendencia"] += " (baixa confiança)"
        direcao = p24["tendencia"]
        icone, cor = {"Elevação": ("trending-up", "amber"), "Queda": ("trending-down", "blue")}.get(
            direcao, ("minus", "emerald"))
        delta24 = round(nivel_atual - janela[0]["nivel_m"], 2)
        for p in (p24, p48, p7d):
            p.pop("_delta")

        base.update({
            "disponivel": True,
            "direcaoPrevisao": direcao, "iconeDirecao": icone, "corDirecao": cor,
            "projecoes": {"24h": p24, "48h": p48, "7d": p7d},
            "diagnostico": (
                f"Cota atual de {fmt_num(nivel_atual)} m, {fmt_num(abs(diff_media))} m "
                f"{'acima' if diff_media > 0 else 'abaixo'} da média de referência de {MESES[mes - 1]} "
                f"({fmt_num(media_mes)} m, período de {tipo_mes.lower()}). Variação medida nas últimas 24 h: "
                f"{'+' if delta24 > 0 else ''}{fmt_num(delta24)} m. As projeções acima são extrapolação dessa "
                f"tendência e perdem confiança com o tempo; para alertas oficiais consulte o SGB/CPRM e a Defesa Civil (199)."),
        })
        return base

    @staticmethod
    def _situacao(nivel: float) -> dict:
        """Situação em relação às cotas oficiais (sem percentuais de 'risco' inventados)."""
        if nivel >= COTA_TRANSBORDAMENTO:
            return {"riscoInundacao": "Acima da cota de transbordamento (14,00 m)", "statusRisco": "Transbordamento", "corRisco": "red"}
        if nivel >= COTA_ALERTA:
            return {"riscoInundacao": "Acima da cota de alerta (13,50 m)", "statusRisco": "Alerta", "corRisco": "orange"}
        if nivel >= COTA_ATENCAO:
            return {"riscoInundacao": "Acima da cota de atenção (12,50 m)", "statusRisco": "Atenção", "corRisco": "amber"}
        return {"riscoInundacao": f"{fmt_num(COTA_ALERTA - nivel)} m abaixo da cota de alerta",
                "statusRisco": "Abaixo das cotas de atenção", "corRisco": "emerald"}


# ─── Linha de comando ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import sys

    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Telemetria do Rio Acre (ANA)")
    parser.add_argument("--action", choices=["nivel", "historico", "previsao"], default="nivel")
    parser.add_argument("--dias", type=int, default=30)
    args = parser.parse_args()

    servico = RioAcreService()
    try:
        if args.action == "nivel":
            resultado = servico.get_nivel()
        elif args.action == "historico":
            resultado = servico.get_historico(args.dias)
        else:
            resultado = servico.get_previsao()
    except DadosIndisponiveis as exc:
        print(json.dumps({"estado": "indisponivel", "erro": str(exc)}, ensure_ascii=False))
        sys.exit(2)
    print(json.dumps(resultado, ensure_ascii=False))
