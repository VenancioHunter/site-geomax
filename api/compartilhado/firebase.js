'use strict'

/*
 * Acesso ao Realtime Database com a conta de serviço.
 *
 * Sem o SDK Admin de propósito: aqui só precisamos escrever alguns campos, e
 * a assinatura do token JWT em Node puro evita arrastar dezenas de megabytes
 * de dependência para dentro da função.
 */

const crypto = require('crypto')

const ESCOPO = 'https://www.googleapis.com/auth/firebase.database ' +
  'https://www.googleapis.com/auth/userinfo.email ' +
  // Necessário para achar a conta pelo e-mail ao promover um administrador.
  'https://www.googleapis.com/auth/identitytoolkit ' +
  // Envio de notificações pelo Cloud Messaging.
  'https://www.googleapis.com/auth/firebase.messaging'

let tokenCache = { valor: null, expiraEm: 0 }

function contaDeServico () {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!bruto) throw new Error('FIREBASE_SERVICE_ACCOUNT não configurada')
  return JSON.parse(bruto)
}

function base64url (buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * True quando nao ha conta de servico configurada.
 *
 * Nesse caso as chamadas vao sem credencial, o que SO funciona enquanto as
 * regras do banco estiverem abertas. Serve para testar na maquina antes de
 * gerar a chave; em producao, sem a conta de servico, o banco fechado recusa
 * a escrita e a assinatura nunca e liberada.
 */
function semCredencial () {
  return !process.env.FIREBASE_SERVICE_ACCOUNT
}

/** Token de acesso do Google, assinado com a chave privada da conta. */
async function token () {
  const agora = Math.floor(Date.now() / 1000)
  // Renova um minuto antes de vencer: relógio de servidor não é exato.
  if (tokenCache.valor && tokenCache.expiraEm > agora + 60) return tokenCache.valor

  const conta = contaDeServico()
  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const corpo = base64url(JSON.stringify({
    iss: conta.client_email,
    scope: ESCOPO,
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600
  }))

  const assinatura = base64url(
    crypto.createSign('RSA-SHA256')
      .update(cabecalho + '.' + corpo)
      .sign(conta.private_key)
  )

  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: cabecalho + '.' + corpo + '.' + assinatura
    })
  })

  if (!resposta.ok) {
    throw new Error('Google recusou o token: ' + await resposta.text())
  }

  const dados = await resposta.json()
  tokenCache = { valor: dados.access_token, expiraEm: agora + dados.expires_in }
  return tokenCache.valor
}

function url (caminho) {
  const base = process.env.FIREBASE_DB_URL
  if (!base) throw new Error('FIREBASE_DB_URL não configurada')
  return base.replace(/\/$/, '') + '/' + caminho.replace(/^\//, '') + '.json'
}

async function ler (caminho) {
  const r = await fetch(url(caminho) + (semCredencial() ? '' : '?access_token=' + await token()))
  if (!r.ok) throw new Error('Leitura falhou em ' + caminho + ': ' + await r.text())
  return r.json()
}

/** PATCH e não PUT: mexe só nos campos enviados, preserva o resto. */
async function gravar (caminho, dados) {
  const r = await fetch(url(caminho) + (semCredencial() ? '' : '?access_token=' + await token()), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados)
  })
  if (!r.ok) throw new Error('Escrita falhou em ' + caminho + ': ' + await r.text())
  return r.json()
}

/**
 * Confere o token que o app ou o site mandaram e devolve o uid.
 *
 * Usa o endpoint de contas do Firebase em vez de validar a assinatura aqui:
 * é uma chamada a mais, mas não exige manter as chaves públicas do Google
 * atualizadas dentro da função.
 */
async function uidDoToken (idToken) {
  const chave = process.env.FIREBASE_API_KEY
  if (!chave) throw new Error('FIREBASE_API_KEY não configurada')

  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + chave,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    }
  )
  if (!r.ok) return null

  const dados = await r.json()
  const usuario = dados.users && dados.users[0]
  return usuario ? { uid: usuario.localId, email: usuario.email } : null
}

/**
 * Acha a conta pelo e-mail. Exige a conta de serviço: é uma operação
 * administrativa do Firebase, não pode sair do navegador.
 */
async function contaPorEmail (email) {
  if (semCredencial()) {
    throw new Error('Sem conta de serviço configurada: informe o código da conta em vez do e-mail.')
  }

  const projeto = contaDeServico().project_id
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/projects/' + projeto + '/accounts:lookup',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + await token()
      },
      body: JSON.stringify({ email: [String(email).trim().toLowerCase()] })
    }
  )

  if (!r.ok) throw new Error('Não foi possível consultar o e-mail: ' + await r.text())

  const dados = await r.json()
  const usuario = dados.users && dados.users[0]
  return usuario ? { uid: usuario.localId, email: usuario.email } : null
}

module.exports = { ler, gravar, uidDoToken, contaPorEmail, semCredencial, tokenDeAcesso: token }
