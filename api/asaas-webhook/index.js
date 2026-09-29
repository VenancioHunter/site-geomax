'use strict'

/*
 * Recebe os eventos do Asaas e é o único lugar que grava a validade da
 * assinatura.
 *
 * Três cuidados que não são opcionais:
 *
 * 1. Confere o token no cabeçalho asaas-access-token. Sem isso, qualquer um
 *    com a URL libera o app de graça.
 * 2. Guarda o id de cada evento. O Asaas entrega o mesmo evento mais de uma
 *    vez por projeto, e sem isso a validade seria estendida duas vezes.
 * 3. Responde 200 rápido. Fila parada depois de 15 falhas seguidas significa
 *    assinante pagando e app bloqueado.
 */

const firebase = require('../compartilhado/firebase')
const avisos = require('../compartilhado/avisos')

const DIA_MS = 24 * 60 * 60 * 1000

function somarDias (dataIso, dias) {
  const d = dataIso ? new Date(dataIso + 'T12:00:00Z') : new Date()
  return new Date(d.getTime() + dias * DIA_MS).toISOString().slice(0, 10)
}

/** Envia sem deixar o webhook cair: aviso é acessório, validade não é. */
async function avisar (context, uid, titulo, texto) {
  try {
    await avisos.avisar(uid, titulo, texto)
  } catch (e) {
    context.log.warn('não avisou ' + uid + ': ' + e.message)
  }
}

module.exports = async function (context, req) {
  const responder = (status, corpo) => {
    context.res = { status, body: corpo }
  }

  const esperado = process.env.ASAAS_WEBHOOK_TOKEN
  const recebido = req.headers['asaas-access-token']
  if (!esperado || recebido !== esperado) {
    context.log.warn('webhook com token inválido')
    return responder(401, 'token inválido')
  }

  const evento = req.body || {}
  const tipo = evento.event
  const pagamento = evento.payment || {}
  const assinatura = evento.subscription || {}

  try {
    // Idempotência: se este id já passou por aqui, não faz nada de novo.
    if (evento.id) {
      const visto = await firebase.ler('eventos/' + evento.id)
      if (visto) return responder(200, 'repetido')
    }

    const clienteId = pagamento.customer || assinatura.customer
    if (!clienteId) return responder(200, 'sem cliente')

    const vinculo = await firebase.ler('clientes/' + clienteId)
    const uid = (vinculo && vinculo.uid) ||
      pagamento.externalReference || assinatura.externalReference
    if (!uid) {
      context.log.warn('cliente sem conta no app: ' + clienteId)
      return responder(200, 'sem conta')
    }

    const tolerancia = Number(process.env.DIAS_TOLERANCIA || '5')
    const caminho = 'assinaturas/' + uid
    const agora = new Date().toISOString()

    switch (tipo) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED': {
        // Vale até o próximo vencimento mais a tolerância: quem paga em dia
        // nunca vê bloqueio, e quem atrasa um dia também não.
        const base = pagamento.dueDate || new Date().toISOString().slice(0, 10)
        await firebase.gravar(caminho, {
          status: 'ativa',
          validoAte: somarDias(base, 30 + tolerancia),
          plano: 'mensal',
          clienteAsaas: clienteId,
          assinaturaAsaas: pagamento.subscription || assinatura.id || null,
          ultimoPagamento: pagamento.paymentDate || pagamento.confirmedDate || agora,
          atualizadoEm: agora
        })

        // Aviso de cortesia: o assinante fica sabendo que está em dia sem
        // precisar abrir o app. Falha no envio não pode derrubar o webhook,
        // senão o Asaas reenviaria o evento e a validade seria estendida.
        await avisar(context, uid, 'Pagamento confirmado',
          'Sua assinatura do GeoMax está em dia. Bom trabalho.')
        break
      }

      case 'PAYMENT_OVERDUE':
        // Marca o atraso, mas NÃO mexe na validade: o app libera pela data, e
        // os dias de tolerância que já foram gravados continuam valendo. É o
        // que evita cortar o operador no meio de um serviço por uma cobrança
        // que falhou por limite ou saldo.
        await firebase.gravar(caminho, { status: 'vencida', atualizadoEm: agora })

        // Este é o aviso que importa: o cliente tem alguns dias antes de o
        // medidor bloquear, e quase sempre é limite ou saldo, não decisão.
        await avisar(context, uid, 'Cobrança não aprovada',
          'Não conseguimos cobrar a sua assinatura. Regularize para o GeoMax ' +
          'continuar funcionando.')
        break

      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_DELETED':
        await firebase.gravar(caminho, {
          status: 'cancelada',
          validoAte: new Date().toISOString().slice(0, 10),
          atualizadoEm: agora
        })
        break

      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_INACTIVATED':
        // Cancelou: continua usando até o fim do período já pago.
        await firebase.gravar(caminho, { status: 'cancelada', atualizadoEm: agora })
        break

      default:
        context.log('evento ignorado: ' + tipo)
    }

    if (evento.id) {
      await firebase.gravar('eventos/' + evento.id, { tipo, uid, em: agora })
    }

    responder(200, 'ok')
  } catch (e) {
    // 500 faz o Asaas reenviar, que é o certo: falha de rede não pode virar
    // assinante pagando com app bloqueado.
    context.log.error('webhook', e)
    responder(500, 'erro')
  }
}
