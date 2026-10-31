const test = require('node:test');
const assert = require('node:assert/strict');

const { getClientIp, isPrivateIp } = require('../src/utils/clientIp');

const req = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });

test('atrás do túnel (conexão do gateway do Docker): usa o IP do Cloudflare', () => {
    assert.equal(getClientIp(req('172.19.0.1', { 'cf-connecting-ip': '200.100.50.25' })), '200.100.50.25');
    assert.equal(getClientIp(req('::ffff:172.19.0.1', { 'cf-connecting-ip': '200.100.50.25' })), '200.100.50.25');
    assert.equal(getClientIp(req('127.0.0.1', { 'cf-connecting-ip': '189.10.20.30' })), '189.10.20.30');
});

test('visitantes diferentes passam a ter IPs diferentes (limites deixam de ser globais)', () => {
    const a = getClientIp(req('172.19.0.1', { 'cf-connecting-ip': '200.1.1.1' }));
    const b = getClientIp(req('172.19.0.1', { 'cf-connecting-ip': '200.2.2.2' }));
    assert.notEqual(a, b);
});

test('aceita IPv6 do visitante no cabeçalho do Cloudflare', () => {
    assert.equal(getClientIp(req('172.19.0.1', { 'cf-connecting-ip': '2804:14d:1234::1' })), '2804:14d:1234::1');
});

test('conexão direta da internet: o cabeçalho forjado é ignorado', () => {
    assert.equal(getClientIp(req('201.55.66.77', { 'cf-connecting-ip': '1.2.3.4' })), '201.55.66.77');
    assert.equal(getClientIp(req('::ffff:201.55.66.77', { 'cf-connecting-ip': '1.2.3.4' })), '201.55.66.77');
});

test('X-Forwarded-For e X-Real-IP nunca são usados (podem ser forjados)', () => {
    assert.equal(getClientIp(req('172.19.0.1', { 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8' })), '172.19.0.1');
    assert.equal(getClientIp(req('201.55.66.77', { 'x-forwarded-for': '9.9.9.9' })), '201.55.66.77');
});

test('sem cabeçalho (acesso pela rede local): usa o endereço da conexão', () => {
    assert.equal(getClientIp(req('192.168.100.20')), '192.168.100.20');
});

test('cabeçalho inválido ou lixo é ignorado', () => {
    assert.equal(getClientIp(req('172.19.0.1', { 'cf-connecting-ip': 'abc' })), '172.19.0.1');
    assert.equal(getClientIp(req('172.19.0.1', { 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' })), '172.19.0.1');
    assert.equal(getClientIp(req('172.19.0.1', { 'cf-connecting-ip': '' })), '172.19.0.1');
});

test('sem informação nenhuma, não quebra', () => {
    assert.equal(getClientIp({ headers: {} }), '127.0.0.1');
    assert.equal(getClientIp(undefined), '127.0.0.1');
});

test('isPrivateIp: faixas privadas e públicas', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:172.19.0.1']) {
        assert.equal(isPrivateIp(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '200.100.50.25', '2804:14d::1', '100.128.0.1', 'lixo', '']) {
        assert.equal(isPrivateIp(ip), false, ip);
    }
});
