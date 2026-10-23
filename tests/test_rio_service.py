"""Testes offline do serviço do Rio Acre (nenhuma chamada real à ANA).

Rodar:  python -m unittest discover -s tests -v
"""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import rio_service as rs  # noqa: E402
from rio_service import DadosIndisponiveis, HidroWebClient, LegacyAnaClient, RioAcreService  # noqa: E402

RB = rs.RB_TZ
AGORA = datetime(2026, 10, 23, 14, 30, tzinfo=RB)


def leitura(dt, nivel, vazao=None, chuva=None, q=0):
    return rs._make_reading(dt, nivel, vazao=vazao, chuva=chuva, q_cota=q)


def serie(horas=30, passo_min=15, inicio_nivel=1.60, taxa_h=0.0, fim=AGORA - timedelta(minutes=10)):
    out, t = [], fim - timedelta(hours=horas)
    while t <= fim:
        h = (t - (fim - timedelta(hours=horas))).total_seconds() / 3600
        out.append(leitura(t, round(inicio_nivel + taxa_h * h, 3)))
        t += timedelta(minutes=passo_min)
    return out


class Fake:
    def __init__(self, readings=None, erro=None, disponivel=True):
        self.readings_, self.erro, self.disp, self.chamadas = readings, erro, disponivel, 0

    def available(self):
        return self.disp

    def readings(self, codigo, dias):
        self.chamadas += 1
        if self.erro:
            raise self.erro
        return list(self.readings_)


def servico(hw=None, lg=None, agora=AGORA):
    return RioAcreService(hidroweb=hw or Fake(disponivel=False), legacy=lg or Fake(erro=RuntimeError("fora")),
                          clock=lambda: agora)


class Datas(unittest.TestCase):
    def test_sem_fuso_usa_hora_local_de_rio_branco(self):
        dt = rs.parse_ana_datetime("2026-10-23 14:00:00")
        self.assertEqual((dt.hour, dt.utcoffset()), (14, timedelta(hours=-5)))

    def test_offset_configuravel_converte_para_rio_branco(self):
        with mock.patch.object(rs, "ANA_DATA_TZ", timezone(timedelta(hours=-3))):
            self.assertEqual(rs.parse_ana_datetime("2026-10-23 14:00:00").hour, 12)

    def test_fuso_explicito_e_fracao_de_segundo(self):
        self.assertEqual(rs.parse_ana_datetime("2026-10-23T14:00:00.0Z").hour, 9)
        self.assertEqual(rs.parse_ana_datetime("23/10/2026 14:15").minute, 15)
        self.assertIsNone(rs.parse_ana_datetime("lixo"))
        self.assertIsNone(rs.parse_ana_datetime(None))


class Parsing(unittest.TestCase):
    def test_xml_legado_com_namespace_fora_de_ordem_e_cm(self):
        xml = """<?xml version="1.0"?><DataSet xmlns="http://tempuri.org/"><diffgram>
          <DocumentElement>
            <DadosHidrometereologicos><DataHora>2026-10-23 14:00:00</DataHora><Nivel>176</Nivel><Vazao>39,5</Vazao></DadosHidrometereologicos>
            <DadosHidrometereologicos><DataHora>2026-10-23 12:00:00</DataHora><Nivel>1,70</Nivel></DadosHidrometereologicos>
            <DadosHidrometereologicos><DataHora>2026-10-23 13:00:00</DataHora><Nivel></Nivel></DadosHidrometereologicos>
          </DocumentElement></diffgram></DataSet>"""
        r = LegacyAnaClient.parse_xml(xml)
        self.assertEqual(len(r), 2)  # a de nível vazio é descartada
        s = servico(lg=Fake(readings=r))
        n = s.get_nivel()
        self.assertEqual(n["nivel"]["metros"], 1.76)       # 176 cm -> 1,76 m
        self.assertEqual(n["nivel"]["dataLeitura"], "23/10/2026 às 14:00")  # a mais RECENTE, não a primeira do XML
        self.assertEqual(n["chuva"], None)                  # sem dado de chuva -> None, não "0,0 mm"
        self.assertEqual(n["vazao"], "39,5 m³/s")

    def test_hidroweb_envelope_e_qualidade(self):
        payload = {"items": {"serie": [
            {"Data_Hora_Medicao": "2026-10-23 14:00:00.0", "Cota_Adotada": "1,81", "Cota_Adotada_Status": 0, "Chuva_Adotada": 0.4},
            {"Data_Hora_Medicao": "2026-10-23 14:15:00.0", "Cota_Adotada": "9,99", "Cota_Adotada_Status": 2},  # RUIM
            {"Data_Hora_Medicao": "2026-10-23 13:45:00.0", "Cota_Adotada": 1.79, "Cota_Adotada_Status": 1},    # SUSPEITO
        ]}}
        cli = HidroWebClient()
        cli._request = lambda *a, **k: payload
        r = cli.readings("13600002", 2)
        s = servico(hw=Fake(readings=r))
        n = s.get_nivel()
        self.assertEqual(n["nivel"]["metros"], 1.81)        # a leitura RUIM (9,99) foi descartada
        self.assertEqual(n["fonte"], "HidroWebService (ANA)")
        self.assertEqual(n["nivel"]["qualidade"]["status"], "OK")
        self.assertEqual(n["chuva"], "0,4 mm")


class Fontes(unittest.TestCase):
    def test_hidroweb_tem_prioridade_sobre_o_legado(self):
        hw, lg = Fake(readings=serie(taxa_h=0)), Fake(readings=serie(inicio_nivel=5))
        n = servico(hw, lg).get_nivel()
        self.assertEqual((hw.chamadas, lg.chamadas, n["fonte"]), (1, 0, "HidroWebService (ANA)"))

    def test_cai_para_o_legado_quando_hidroweb_falha(self):
        hw, lg = Fake(erro=RuntimeError("401")), Fake(readings=serie())
        n = servico(hw, lg).get_nivel()
        self.assertEqual(n["fonte"], "WebService Legado (ANA)")
        self.assertEqual(n["estado"], "ok")

    def test_sem_credenciais_pula_hidroweb(self):
        hw, lg = Fake(readings=serie(), disponivel=False), Fake(readings=serie())
        servico(hw, lg).get_nivel()
        self.assertEqual(hw.chamadas, 0)

    def test_tudo_falha_sem_cache_levanta_erro_e_nao_inventa_valor(self):
        with self.assertRaises(DadosIndisponiveis):
            servico(Fake(erro=RuntimeError("a")), Fake(erro=RuntimeError("b"))).get_nivel()

    def test_tudo_falha_com_cache_devolve_dado_real_marcado_desatualizado(self):
        lg = Fake(readings=serie())
        s = servico(lg=lg)
        self.assertEqual(s.get_nivel()["estado"], "ok")
        lg.erro = RuntimeError("caiu")           # a ANA cai...
        for entrada in s._cache.values():        # ...e o cache expira
            entrada["fetched"] = 0
        n = s.get_nivel()
        self.assertEqual(n["nivel"]["metros"], 1.60)   # continua sendo a leitura REAL anterior
        self.assertTrue(n["frescor"]["falhaAoAtualizar"])
        self.assertEqual(n["estado"], "desatualizado")


class Frescor(unittest.TestCase):
    def test_leitura_velha_e_desatualizada(self):
        velha = serie(fim=AGORA - timedelta(hours=5))
        n = servico(lg=Fake(readings=velha)).get_nivel()
        self.assertTrue(n["frescor"]["desatualizado"])
        self.assertEqual(n["frescor"]["idadeMinutos"], 300)
        self.assertIn("5 h", n["frescor"]["mensagem"])

    def test_leitura_recente_esta_ok(self):
        n = servico(lg=Fake(readings=serie())).get_nivel()
        self.assertFalse(n["frescor"]["desatualizado"])

    def test_leitura_no_futuro_sinaliza_fuso(self):
        futuro = serie(fim=AGORA + timedelta(hours=2))
        n = servico(lg=Fake(readings=futuro)).get_nivel()
        self.assertTrue(n["frescor"]["fusoSuspeito"])


class Tendencia(unittest.TestCase):
    def test_subindo_descendo_estavel(self):
        self.assertEqual(servico(lg=Fake(readings=serie(taxa_h=0.05))).get_nivel()["tendencia"]["status"], "Subindo")
        self.assertEqual(servico(lg=Fake(readings=serie(inicio_nivel=3, taxa_h=-0.05))).get_nivel()["tendencia"]["status"], "Descendo")
        self.assertEqual(servico(lg=Fake(readings=serie())).get_nivel()["tendencia"]["status"], "Estável")


class Historico(unittest.TestCase):
    def test_estrutura_e_janela_de_24h(self):
        h = servico(lg=Fake(readings=serie(horas=72, taxa_h=0.01))).get_historico(30)
        self.assertLessEqual(len(h["leituras24h"]), 25)
        self.assertGreaterEqual(len(h["pontos"]), 3)
        for chave in ("estatisticas", "estatisticas24h", "cotasReferencia", "frescor", "fonte"):
            self.assertIn(chave, h)
        for p in h["pontos"]:
            for c in ("data", "dataCompleta", "diaSemana", "nivel", "min", "max", "variacaoDia", "status", "isHoje"):
                self.assertIn(c, p)


class Previsao(unittest.TestCase):
    def test_tendencia_de_alta_gera_elevacao(self):
        p = servico(lg=Fake(readings=serie(taxa_h=0.02))).get_previsao()
        self.assertTrue(p["disponivel"])
        self.assertEqual(p["direcaoPrevisao"], "Elevação")
        self.assertGreater(p["projecoes"]["24h"]["nivel"], p["nivelAtual"])
        self.assertEqual(set(p["projecoes"]), {"24h", "48h", "7d"})
        self.assertEqual(p["tipo"], "estimativa-de-tendencia")

    def test_sem_percentuais_de_risco_nem_afirmacoes_sobre_montante(self):
        p = servico(lg=Fake(readings=serie())).get_previsao()
        texto = (p["riscoInundacao"] + p["diagnostico"] + p["aviso"]).lower()
        self.assertNotIn("%", p["riscoInundacao"])
        self.assertNotIn("probabilidade", texto)
        self.assertNotIn("nula", texto)
        self.assertIn("199", texto)

    def test_dado_velho_ou_escasso_nao_gera_projecao(self):
        velha = servico(lg=Fake(readings=serie(fim=AGORA - timedelta(hours=6)))).get_previsao()
        self.assertFalse(velha["disponivel"])
        self.assertEqual(velha["projecoes"], {})
        pouca = servico(lg=Fake(readings=serie(horas=2))).get_previsao()
        self.assertFalse(pouca["disponivel"])

    def test_indisponivel_propaga_erro(self):
        with self.assertRaises(DadosIndisponiveis):
            servico(Fake(erro=RuntimeError("a")), Fake(erro=RuntimeError("b"))).get_previsao()


class Credenciais(unittest.TestCase):
    def test_credenciais_por_ambiente(self):
        with mock.patch.dict(os.environ, {"ANA_HIDROWEB_USUARIO": " u ", "ANA_HIDROWEB_SENHA": "s"}):
            self.assertEqual(HidroWebClient.credentials(), ("u", "s"))

    def test_sem_credenciais(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("builtins.open", side_effect=OSError):
            self.assertIsNone(HidroWebClient.credentials())


class Servidor(unittest.TestCase):
    def setUp(self):
        import rio_server
        self.mod = rio_server

    def cliente(self, svc):
        return self.mod.create_app(svc).test_client()

    def test_503_sem_dados_reais(self):
        c = self.cliente(servico(Fake(erro=RuntimeError("a")), Fake(erro=RuntimeError("b"))))
        for url in ("/api/rio-acre", "/api/rio-acre/historico?dias=7", "/api/rio-acre/previsao"):
            r = c.get(url)
            self.assertEqual(r.status_code, 503, url)
            self.assertEqual(r.get_json()["estado"], "indisponivel")
            self.assertNotIn("metros", r.get_data(as_text=True))
            self.assertEqual(r.headers["Cache-Control"], "no-store")

    def test_200_com_dados(self):
        c = self.cliente(servico(lg=Fake(readings=serie(taxa_h=0.01))))
        r = c.get("/api/rio-acre")
        self.assertEqual(r.status_code, 200)
        self.assertIn("frescor", r.get_json())
        self.assertEqual(c.get("/api/health").get_json()["estacao"], "13600002")

    def test_so_cameras_permitidas_e_estaticos_restritos(self):
        c = self.cliente(servico(lg=Fake(readings=serie())))
        self.assertEqual(c.get("/proxy/camera/999999").status_code, 404)
        self.assertEqual(c.get("/proxy/camera/../../etc/passwd").status_code, 404)
        self.assertEqual(c.get("/server.js").status_code, 404)
        self.assertEqual(c.get("/serviceAccountKey.json").status_code, 404)
        self.assertEqual(c.get("/script/../../rio_service.py").status_code, 404)
        self.assertEqual(c.get("/").status_code, 302)

    def test_erro_interno_nao_vaza_detalhes(self):
        class Quebrado(RioAcreService):
            def get_nivel(self):
                raise ValueError("segredo-interno")
        r = self.cliente(Quebrado(hidroweb=Fake(disponivel=False), legacy=Fake())).get("/api/rio-acre")
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("segredo-interno", r.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
