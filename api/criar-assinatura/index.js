'use strict'

/*
 * Cria a assinatura no Asaas e devolve o que a tela precisa mostrar.
 *
 * Quem chama é a página /assinar.html, já com a pessoa autenticada no
 * Firebase: o token vai no cabeçalho e é ele que diz de quem é a assinatura.
 * Sem isso, qualquer um poderia criar cobrança no nome de outro.
 *
 * A assinatura só existe no cartão de crédito: o débito é automático a cada
 * mês. O número do cartão passa por aqui uma vez, vira token no Asaas e NÃO é
 * gravado em lugar nenhum - nem em log, nem no banco. O que fica é o token, os
 * quatro últimos dígitos e a bandeira, que é o suficiente para o assinante
 * reconhecer o cartão.
 */

const asaas = require('../compartilhado/asaas')
const firebase = require('../compartilhado/firebase')

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

  try {
    const autorizacao = req.headers.authorization || ''
    const idToken = autorizacao.startsWith('Bearer ') ? autorizacao.slice(7) : null
    if (!idToken) return responder(401, { erro: 'Faça login novamente.' })

    const conta = await firebase.uidDoToken(idToken)
    if (!conta) return responder(401, { erro: 'Sessão expirada. Entre de novo.' })

    const { nome, cpfCnpj, telefone, cartao, endereco } = req.body || {}
    if (!nome || !cpfCnpj) {
      return responder(400, { erro: 'Informe nome e CPF ou CNPJ.' })
    }

    // Assinatura é SÓ no cartão. Pix e boleto exigiriam o assinante lembrar de
    // pagar todo mês, e quem esquece vira bloqueio no meio de um serviço.
    if (!cartao || !cartao.numero || !cartao.cvv || !cartao.mes || !cartao.ano) {
      return responder(400, { erro: 'Preencha os dados do cartão.' })
    }
    if (!endereco || !endereco.cep || !endereco.numero) {
      return responder(400, { erro: 'Informe o CEP e o número do endereço da fatura.' })
    }

    // Já assinante: não cria uma segunda cobrança. Sem esta guarda, dois
    // toques no botão viram duas assinaturas e uma dor de cabeça de estorno.
    const atual = await firebase.ler('assinaturas/' + conta.uid)
    if (atual && atual.status === 'ativa') {
      return responder(409, {
        erro: 'Esta conta já tem assinatura ativa.',
        validoAte: atual.validoAte
      })
    }

    const cliente = await asaas.acharOuCriarCliente({
      nome,
      email: conta.email,
      cpfCnpj: String(cpfCnpj).replace(/\D/g, ''),
      telefone
    })

    const t = await asaas.tokenizarCartao({
      clienteId: cliente.id,
      cartao,
      titular: {
        nome: cartao.nome || nome,
        email: conta.email,
        cpfCnpj,
        cep: endereco.cep,
        numero: endereco.numero,
        telefone
      },
      ip: ipDoPagador(req)
    })
    const cartaoSalvo = { token: t.token, ultimos: t.ultimos, bandeira: t.bandeira }

    const assinatura = await asaas.criarAssinatura({
      clienteId: cliente.id,
      uid: conta.uid,
      cartaoToken: cartaoSalvo.token,
      ip: ipDoPagador(req)
    })

    // O webhook fala em cliente do Asaas; esta linha é o que permite traduzir
    // de volta para a conta do Firebase quando o pagamento chegar.
    await firebase.gravar('clientes/' + cliente.id, {
      uid: conta.uid,
      email: conta.email,
      assinaturaAsaas: assinatura.id
    })

    await firebase.gravar('assinaturas/' + conta.uid, {
      status: 'aguardando_pagamento',
      plano: 'mensal',
      clienteAsaas: cliente.id,
      assinaturaAsaas: assinatura.id,
      // Só o que serve para o assinante reconhecer o cartão na tela.
      cartaoFinal: cartaoSalvo.ultimos,
      cartaoBandeira: cartaoSalvo.bandeira,
      atualizadoEm: new Date().toISOString()
    })

    const cobranca = await asaas.primeiraCobranca(assinatura.id)

    responder(200, {
      assinatura: assinatura.id,
      cartao: cartaoSalvo.bandeira + ' •••• ' + cartaoSalvo.ultimos,
      vencimento: cobranca ? cobranca.dueDate : assinatura.nextDueDate
    })
  } catch (e) {
    context.log.error('criar-assinatura', e)
    responder(500, { erro: e.message || 'Não foi possível criar a assinatura.' })
  }
}
