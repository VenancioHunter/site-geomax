'use strict'

/*
 * Roda o webhook na máquina, sem a Azure e sem o Asaas.
 *
 * Chama a mesma função que roda em produção, com um evento de mentira, e
 * confere o que ficou gravado no Firebase. É a forma mais curta de saber se a
 * cadeia "pagamento confirmado → app liberado" funciona.
 *
 *   node api/testar-webhook.js <uid-da-conta>
 *
 * O uid é o "código da conta" que aparece na tela de bloqueio do aplicativo.
 * Sem ele, o teste usa um uid de mentira e apaga o que criou no fim.
 */

const webhook = require('./asaas-webhook')
const firebase = require('./compartilhado/firebase')

const uid = process.argv[2] || 'uid-de-teste-local'
const ehTesteDescartavel = !process.argv[2]
const clienteFalso = 'cus_TESTE_LOCAL'

process.env.FIREBASE_DB_URL = process.env.FIREBASE_DB_URL ||
  'https://geomax-c3f78-default-rtdb.firebaseio.com'
process.env.ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || 'token-de-teste'
process.env.DIAS_TOLERANCIA = process.env.DIAS_TOLERANCIA || '5'

const contexto = {
  res: null,
  log: Object.assign((...a) => console.log('   log:', ...a), {
    error: (...a) => console.error('   erro:', ...a),
    warn: (...a) => console.warn('   aviso:', ...a)
  })
}

function evento (id, tipo, extra = {}) {
  return {
    id,
    event: tipo,
    payment: {
      customer: clienteFalso,
      subscription: 'sub_TESTE_LOCAL',
      dueDate: new Date().toISOString().slice(0, 10),
      externalReference: uid,
      ...extra
    }
  }
}

async function enviar (nome, corpo, token) {
  await webhook(contexto, {
    headers: { 'asaas-access-token': token || process.env.ASAAS_WEBHOOK_TOKEN },
    body: corpo
  })
  console.log(nome + ' → HTTP ' + contexto.res.status + ' ' + contexto.res.body)
  return contexto.res
}

async function main () {
  console.log('Banco:', process.env.FIREBASE_DB_URL)
  console.log('Conta:', uid, ehTesteDescartavel ? '(de mentira)' : '')
  console.log('Credencial:', firebase.semCredencial()
    ? 'nenhuma — só funciona com as regras do banco abertas'
    : 'conta de serviço')
  console.log('')

  // 1. Token errado tem de ser recusado: é a única proteção do webhook.
  const recusado = await enviar('1. token errado ', evento('evt_1', 'PAYMENT_CONFIRMED'), 'errado')
  if (recusado.status !== 401) throw new Error('FALHOU: token errado deveria dar 401')

  // 2. Pagamento confirmado libera o app.
  await enviar('2. pagamento    ', evento('evt_2', 'PAYMENT_CONFIRMED'))
  let estado = await firebase.ler('assinaturas/' + uid)
  console.log('   gravado:', JSON.stringify(estado))
  if (!estado || estado.status !== 'ativa') throw new Error('FALHOU: deveria ficar ativa')

  // 3. O mesmo evento de novo não pode estender a validade outra vez.
  const validadeAntes = estado.validoAte
  await enviar('3. evento repetido', evento('evt_2', 'PAYMENT_CONFIRMED'))
  estado = await firebase.ler('assinaturas/' + uid)
  if (estado.validoAte !== validadeAntes) {
    throw new Error('FALHOU: evento repetido mexeu na validade')
  }
  console.log('   validade intacta:', estado.validoAte)

  // 4. Atraso marca o status, mas não corta o acesso já pago.
  await enviar('4. atraso        ', evento('evt_3', 'PAYMENT_OVERDUE'))
  estado = await firebase.ler('assinaturas/' + uid)
  console.log('   status:', estado.status, '· validade:', estado.validoAte)
  if (estado.status !== 'vencida') throw new Error('FALHOU: deveria ficar vencida')
  if (estado.validoAte !== validadeAntes) {
    throw new Error('FALHOU: atraso não pode encurtar o que já foi pago')
  }

  if (ehTesteDescartavel) {
    await firebase.gravar('assinaturas/' + uid, { status: null, validoAte: null })
    console.log('\nLimpou o registro de mentira.')
  } else {
    console.log('\nConta ' + uid + ' liberada até ' + estado.validoAte + '.')
    console.log('Status ficou "vencida" por causa do teste 4 — rode o teste 2')
    console.log('sozinho se quiser deixá-la ativa.')
  }

  console.log('\nTudo certo.')
}

main().catch(e => {
  console.error('\n' + e.message)
  process.exit(1)
})
