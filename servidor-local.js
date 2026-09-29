'use strict'

/*
 * Servidor local do site + API, sem depender das ferramentas da Azure.
 *
 * O caminho oficial é o `swa start`, que precisa do Azure Functions Core
 * Tools. O binário dele não instala em qualquer versão do Node, e ficar preso
 * a isso para mexer no site não vale a pena. Este arquivo serve as páginas e
 * chama exatamente as mesmas funções que rodam na Azure — o mesmo código,
 * com um contexto de mentira em volta.
 *
 *   node servidor-local.js
 *
 * As variáveis vêm de api/local.settings.json, o mesmo arquivo que o
 * `swa start` usaria. Ele está fora do repositório.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORTA = Number(process.env.PORTA || 4280)
const PUBLICO = path.join(__dirname, 'public')

// Carrega as variáveis antes de exigir as funções: elas leem process.env na
// primeira chamada, e sem isso a API subiria sem chave nenhuma.
const arquivoConfig = path.join(__dirname, 'api', 'local.settings.json')
if (fs.existsSync(arquivoConfig)) {
  const { Values } = JSON.parse(fs.readFileSync(arquivoConfig, 'utf8'))
  Object.entries(Values || {}).forEach(([k, v]) => {
    if (!process.env[k]) process.env[k] = v
  })
  console.log('Configuração lida de api/local.settings.json')
} else {
  console.log('AVISO: api/local.settings.json não existe. A API vai falhar.')
}

const FUNCOES = {
  '/api/criar-assinatura': require('./api/criar-assinatura'),
  '/api/asaas-webhook': require('./api/asaas-webhook'),
  '/api/comprar': require('./api/comprar'),
  '/api/admin': require('./api/admin')
}

// Rotas que também respondem a GET (o catálogo de produtos).
const ACEITA_GET = ['/api/comprar', '/api/admin']

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

function corpoDaRequisicao (req) {
  return new Promise((resolve) => {
    let bruto = ''
    req.on('data', (p) => { bruto += p })
    req.on('end', () => {
      if (!bruto) return resolve({})
      try {
        resolve(JSON.parse(bruto))
      } catch (e) {
        resolve({})
      }
    })
  })
}

async function servirApi (funcao, req, res) {
  const contexto = {
    res: null,
    log: Object.assign(
      (...a) => console.log('  ', ...a),
      { error: (...a) => console.error('   erro:', ...a), warn: (...a) => console.warn('   aviso:', ...a) }
    )
  }

  await funcao(contexto, {
    headers: req.headers,
    body: await corpoDaRequisicao(req),
    // A Azure entrega a consulta da URL em req.query; aqui ela precisava ser
    // lida na mão. Sem isso, toda chamada com ?acao=... chegava vazia.
    query: Object.fromEntries(new URL(req.url, 'http://local').searchParams),
    method: req.method
  })

  const r = contexto.res || { status: 204, body: '' }
  res.writeHead(r.status || 200, r.headers || { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body || ''))
  console.log(req.method, req.url, '→', r.status)
}

function servirArquivo (req, res) {
  const caminho = req.url.split('?')[0]
  const alvo = path.join(PUBLICO, caminho === '/' ? 'index.html' : caminho)

  // Não deixa sair da pasta public por caminho relativo.
  if (!alvo.startsWith(PUBLICO)) {
    res.writeHead(403).end('proibido')
    return
  }

  fs.readFile(alvo, (erro, dados) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>404</h1><p>Não existe: ' + caminho + '</p>')
      return
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream' })
    res.end(dados)
  })
}

http.createServer(async (req, res) => {
  const rota = req.url.split('?')[0]
  const funcao = FUNCOES[rota]

  if (funcao) {
    if (req.method !== 'POST' && !(req.method === 'GET' && ACEITA_GET.includes(rota))) {
      res.writeHead(405).end('use POST')
      return
    }
    try {
      await servirApi(funcao, req, res)
    } catch (e) {
      console.error(e)
      res.writeHead(500).end('erro interno')
    }
    return
  }

  servirArquivo(req, res)
}).listen(PORTA, '127.0.0.1', () => {
  console.log('Site  : http://127.0.0.1:' + PORTA)
  console.log('API   : /api/criar-assinatura e /api/asaas-webhook')
  console.log('Asaas : ' + (process.env.ASAAS_URL || 'não configurado'))
  console.log('\nCtrl+C para parar.')
})
