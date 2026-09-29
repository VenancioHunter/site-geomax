'use strict'

/*
 * Volta completa no sandbox: cliente → assinatura → cobrança → pagamento
 * confirmado → app liberado.
 *
 *   node api/testar-fluxo.js [uid-da-conta]
 *
 * Sem uid, usa um de mentira e apaga tudo no fim. Com o uid da sua conta (o
 * "código da conta" da tela de bloqueio), deixa a assinatura gravada e o app
 * abre na próxima verificação.
 *
 * SÓ RODE COM A CHAVE DE SANDBOX. Com a chave de produção isto cria cliente,
 * assinatura e fatura de verdade.
 */

const fs = require('fs')
const path = require('path')

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'local.settings.json'), 'utf8')
).Values
Object.entries(config).forEach(([k, v]) => { process.env[k] = v })

const asaas = require('./compartilhado/asaas')
const firebase = require('./compartilhado/firebase')
const webhook = require('./asaas-webhook')

const uid = process.argv[2] || 'uid-de-teste-fluxo'
const descartavel = !process.argv[2]

const contexto = {
  res: null,
  log: Object.assign(() => {}, { error: (...a) => console.error('   ', ...a), warn: () => {} })
}

async function passo (numero, titulo, fn) {
  process.stdout.write(numero + '. ' + titulo + ' … ')
  const r = await fn()
  console.log('ok')
  return r
}

async function main () {
  if (!/hmlg|sandbox/.test(process.env.ASAAS_CHAVE + process.env.ASAAS_URL)) {
    throw new Error('A chave ou a URL não são de sandbox. Abortado.')
  }

  console.log('Ambiente:', process.env.ASAAS_URL)
  console.log('Conta   :', uid, descartavel ? '(de mentira)' : '')
  console.log('')

  const cliente = await passo(1, 'criando cliente no Asaas', () =>
    asaas.acharOuCriarCliente({
      nome: 'Teste GeoMax',
      email: 'teste.geomax@example.com',
      cpfCnpj: '24971563792',
      telefone: "11988887777"
    })
  )
  console.log('   cliente:', cliente.id)

  const assinatura = await passo(2, 'criando assinatura mensal', () =>
    asaas.criarAssinatura({ clienteId: cliente.id, uid, formaPagamento: 'BOLETO' })
  )
  console.log('   assinatura:', assinatura.id, '· R$', assinatura.value)

  const cobranca = await passo(3, 'buscando a primeira cobrança', () =>
    asaas.primeiraCobranca(assinatura.id)
  )
  console.log('   cobrança:', cobranca.id, '· vence', cobranca.dueDate)
  console.log('   link:', cobranca.invoiceUrl)

  await passo(4, 'ligando cliente à conta do app', () =>
    firebase.gravar('clientes/' + cliente.id, {
      uid,
      email: 'teste.geomax@example.com',
      assinaturaAsaas: assinatura.id
    })
  )

  // Em sandbox dá para confirmar o pagamento pela API. Em produção quem faz
  // isso é o cliente pagando o boleto ou o Pix.
  await passo(5, 'confirmando o pagamento no sandbox', async () => {
    const r = await fetch(process.env.ASAAS_URL + '/payments/' + cobranca.id + '/receiveInCash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: process.env.ASAAS_CHAVE },
      body: JSON.stringify({
        // Data de Brasília: o relógio desta máquina está em UTC e o Asaas
        // recusa pagamento com data "no futuro" pelo fuso dele.
        paymentDate: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10),
        value: cobranca.value,
        notifyCustomer: false
      })
    })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  })

  // O Asaas chamaria o webhook sozinho; na máquina ele não tem como chegar
  // aqui, então entregamos o mesmo evento na mão.
  await passo(6, 'entregando o evento ao webhook', async () => {
    await webhook(contexto, {
      headers: { 'asaas-access-token': process.env.ASAAS_WEBHOOK_TOKEN },
      body: {
        id: 'evt_fluxo_' + Date.now(),
        event: 'PAYMENT_CONFIRMED',
        payment: {
          customer: cliente.id,
          subscription: assinatura.id,
          dueDate: cobranca.dueDate,
          value: cobranca.value,
          externalReference: uid
        }
      }
    })
    if (contexto.res.status !== 200) throw new Error('webhook devolveu ' + contexto.res.status)
  })

  const estado = await firebase.ler('assinaturas/' + uid)
  console.log('\nO que o app vai ler:')
  console.log(JSON.stringify(estado, null, 2))

  if (!estado || estado.status !== 'ativa') throw new Error('FALHOU: não ficou ativa')

  if (descartavel) {
    process.stdout.write('\nlimpando … ')
    await asaas.cancelarAssinatura(assinatura.id)
    await fetch(process.env.ASAAS_URL + '/customers/' + cliente.id, {
      method: 'DELETE',
      headers: { access_token: process.env.ASAAS_CHAVE }
    })
    await firebase.gravar('assinaturas/' + uid, {
      status: null, validoAte: null, plano: null, clienteAsaas: null,
      assinaturaAsaas: null, ultimoPagamento: null, atualizadoEm: null
    })
    await firebase.gravar('clientes/' + cliente.id, {
      uid: null, email: null, assinaturaAsaas: null
    })
    console.log('ok')
  }

  console.log('\nFluxo completo funcionando.')
}

main().catch((e) => {
  console.error('\nERRO:', e.message)
  process.exit(1)
})
