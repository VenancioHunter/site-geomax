'use strict'

/*
 * Chamadas ao Asaas. A chave da API só existe aqui dentro, nunca no site.
 */

function base () {
  const url = process.env.ASAAS_URL
  if (!url) throw new Error('ASAAS_URL não configurada')
  return url.replace(/\/$/, '')
}

async function chamar (caminho, opcoes = {}) {
  const chave = process.env.ASAAS_CHAVE
  if (!chave) throw new Error('ASAAS_CHAVE não configurada')

  const r = await fetch(base() + caminho, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      access_token: chave,
      ...(opcoes.headers || {})
    }
  })

  const texto = await r.text()
  const dados = texto ? JSON.parse(texto) : {}

  if (!r.ok) {
    // O Asaas devolve os problemas em errors[].description; repassar isso ao
    // site evita a mensagem inútil de "erro ao processar".
    const erro = dados.errors && dados.errors[0]
    throw new Error(erro ? erro.description : 'Asaas respondeu ' + r.status)
  }
  return dados
}

/** Procura o cliente pelo e-mail antes de criar: evita cliente duplicado. */
async function acharOuCriarCliente ({ nome, email, cpfCnpj, telefone }) {
  const busca = await chamar('/customers?email=' + encodeURIComponent(email))
  if (busca.data && busca.data.length > 0) return busca.data[0]

  return chamar('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: nome,
      email,
      cpfCnpj,
      mobilePhone: telefone || undefined,
      notificationDisabled: false
    })
  })
}

/**
 * Troca os dados do cartão por um token.
 *
 * O número do cartão aparece UMA vez, aqui, e não é gravado em lugar nenhum:
 * nem em log, nem no banco. O que sobra é o token, que só serve para este
 * cliente e não vale para cobrar ninguém mais.
 */
async function tokenizarCartao ({ clienteId, cartao, titular, ip }) {
  const resposta = await chamar('/creditCard/tokenizeCreditCard', {
    method: 'POST',
    body: JSON.stringify({
      customer: clienteId,
      creditCard: {
        holderName: cartao.nome,
        number: String(cartao.numero).replace(/\D/g, ''),
        expiryMonth: cartao.mes,
        expiryYear: cartao.ano,
        ccv: cartao.cvv
      },
      creditCardHolderInfo: {
        name: titular.nome,
        email: titular.email,
        cpfCnpj: String(titular.cpfCnpj).replace(/\D/g, ''),
        postalCode: String(titular.cep).replace(/\D/g, ''),
        addressNumber: String(titular.numero),
        phone: titular.telefone ? String(titular.telefone).replace(/\D/g, '') : undefined
      },
      remoteIp: ip
    })
  })

  return {
    token: resposta.creditCardToken,
    ultimos: resposta.creditCardNumber,
    bandeira: resposta.creditCardBrand
  }
}

/**
 * Assinatura mensal no cartão. externalReference guarda o uid do Firebase.
 *
 * Só cartão: com o cartão tokenizado o Asaas debita sozinho a cada ciclo.
 * Pix e boleto obrigariam o assinante a lembrar de pagar todo mês, e quem
 * esquece descobre no meio de um serviço, com o medidor bloqueado.
 */
async function criarAssinatura ({ clienteId, uid, cartaoToken, ip }) {
  const valor = Number(process.env.ASSINATURA_VALOR || '0')
  if (!valor) throw new Error('ASSINATURA_VALOR não configurada')
  if (!cartaoToken) throw new Error('Assinatura exige cartão de crédito.')

  const vencimento = new Date()
  vencimento.setDate(vencimento.getDate() + 1)

  return chamar('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: clienteId,
      billingType: 'CREDIT_CARD',
      value: valor,
      nextDueDate: vencimento.toISOString().slice(0, 10),
      cycle: 'MONTHLY',
      description: process.env.ASSINATURA_DESCRICAO || 'GeoMax — assinatura mensal',
      externalReference: uid,
      creditCardToken: cartaoToken,
      remoteIp: ip
    })
  })
}

/**
 * Cobrança avulsa - a venda de equipamento, que não tem nada a ver com a
 * assinatura. Aceita cartão e Pix: no cartão o débito acontece na hora, no
 * Pix o vencimento é em três dias.
 */
async function criarCobranca ({ clienteId, valor, descricao, formaPagamento, cartaoToken, ip, referencia }) {
  const vencimento = new Date()
  vencimento.setDate(vencimento.getDate() + 3)

  const corpo = {
    customer: clienteId,
    billingType: cartaoToken ? 'CREDIT_CARD' : (formaPagamento || 'UNDEFINED'),
    value: valor,
    dueDate: vencimento.toISOString().slice(0, 10),
    description: descricao,
    externalReference: referencia
  }

  if (cartaoToken) {
    corpo.creditCardToken = cartaoToken
    corpo.remoteIp = ip
  }

  return chamar('/payments', { method: 'POST', body: JSON.stringify(corpo) })
}

/** A primeira cobrança da assinatura, que é para onde a pessoa vai pagar. */
async function primeiraCobranca (assinaturaId) {
  const lista = await chamar('/subscriptions/' + assinaturaId + '/payments')
  return (lista.data && lista.data[0]) || null
}

async function cancelarAssinatura (assinaturaId) {
  return chamar('/subscriptions/' + assinaturaId, { method: 'DELETE' })
}

module.exports = {
  acharOuCriarCliente,
  tokenizarCartao,
  criarAssinatura,
  criarCobranca,
  primeiraCobranca,
  cancelarAssinatura
}
