'use strict'

/*
 * Venda de equipamento — separada da assinatura.
 *
 * Não exige conta no aplicativo: quem compra um sensor pode ainda nem ser
 * assinante. O pedido é identificado pelo CPF ou CNPJ e pelo e-mail.
 *
 * Os preços vêm do catálogo do servidor, nunca do navegador: preço que chega
 * do site é preço que o comprador edita.
 */

const asaas = require('../compartilhado/asaas')
const firebase = require('../compartilhado/firebase')
const catalogo = require('../compartilhado/produtos')
const config = require('../compartilhado/admin')

function ipDoPagador (req) {
  const encaminhado = req.headers['x-forwarded-for']
  if (encaminhado) return String(encaminhado).split(',')[0].trim()
  return req.headers['x-client-ip'] || '127.0.0.1'
}

module.exports = async function (context, req) {
  const responder = (status, corpo) => {
    context.res = {
      status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    }
  }

  // GET devolve o catálogo para a página montar a lista.
  if ((req.method || 'POST').toUpperCase() === 'GET') {
    return responder(200, { produtos: catalogo.PRODUTOS })
  }

  try {
    const { itens, cliente, entrega, formaPagamento, cartao } = req.body || {}

    if (!Array.isArray(itens) || itens.length === 0) {
      return responder(400, { erro: 'Escolha ao menos um produto.' })
    }
    if (!cliente || !cliente.nome || !cliente.email || !cliente.cpfCnpj) {
      return responder(400, { erro: 'Informe nome, e-mail e CPF ou CNPJ.' })
    }
    if (!entrega || !entrega.cep || !entrega.endereco || !entrega.numero || !entrega.cidade) {
      return responder(400, { erro: 'Informe o endereço de entrega completo.' })
    }

    // Cartão ou Pix. Boleto ficou de fora: demora a compensar e a entrega
    // ficaria parada esperando.
    if (!['CREDIT_CARD', 'PIX'].includes(formaPagamento)) {
      return responder(400, { erro: 'Escolha cartão de crédito ou Pix.' })
    }

    const noCartao = formaPagamento === 'CREDIT_CARD'
    if (noCartao && (!cartao || !cartao.numero || !cartao.cvv || !cartao.mes || !cartao.ano)) {
      return responder(400, { erro: 'Preencha os dados do cartão.' })
    }

    const valor = catalogo.total(itens)
    const descricao = catalogo.descrever(itens)

    const asaasCliente = await asaas.acharOuCriarCliente({
      nome: cliente.nome,
      email: cliente.email,
      cpfCnpj: String(cliente.cpfCnpj).replace(/\D/g, ''),
      telefone: cliente.telefone
    })

    let cartaoToken = null
    let cartaoFinal = null
    if (noCartao) {
      const t = await asaas.tokenizarCartao({
        clienteId: asaasCliente.id,
        cartao,
        titular: {
          nome: cartao.nome || cliente.nome,
          email: cliente.email,
          cpfCnpj: cliente.cpfCnpj,
          cep: entrega.cep,
          numero: entrega.numero,
          telefone: cliente.telefone
        },
        ip: ipDoPagador(req)
      })
      cartaoToken = t.token
      cartaoFinal = t.bandeira + ' •••• ' + t.ultimos
    }

    const referencia = 'pedido-' + Date.now()

    const cobranca = await asaas.criarCobranca({
      clienteId: asaasCliente.id,
      valor,
      descricao: 'GeoMax — ' + descricao,
      formaPagamento,
      cartaoToken,
      ip: ipDoPagador(req),
      referencia
    })

    // O pedido fica no banco porque a entrega é responsabilidade de vocês: o
    // Asaas sabe do dinheiro, não sabe para onde mandar a caixa.
    await firebase.gravar('pedidos/' + cobranca.id, {
      referencia,
      itens,
      descricao,
      valor,
      cliente: {
        nome: cliente.nome,
        email: cliente.email,
        cpfCnpj: cliente.cpfCnpj,
        telefone: cliente.telefone || null
      },
      entrega,
      pagamento: {
        forma: cobranca.billingType,
        status: cobranca.status,
        cartao: cartaoFinal
      },
      criadoEm: new Date().toISOString()
    })

    responder(200, {
      pedido: cobranca.id,
      valor,
      descricao,
      status: cobranca.status,
      link: cobranca.invoiceUrl || null,
      cartao: cartaoFinal
    })
  } catch (e) {
    context.log.error('comprar', e)
    responder(500, { erro: e.message || 'Não foi possível concluir a compra.' })
  }
}
