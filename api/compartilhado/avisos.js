'use strict'

/*
 * Envio de notificações pelo Firebase Cloud Messaging.
 *
 * Usa a API HTTP v1, que exige a conta de serviço — a antiga, com chave de
 * servidor, foi desativada pelo Google. Sem a conta de serviço configurada,
 * o envio falha com mensagem explicando, e não em silêncio.
 *
 * Os tokens ficam em /dispositivos/{uid}/{token}. Um token que o Firebase
 * recusa é apagado na hora: aparelho trocado ou app desinstalado deixariam
 * lixo que só cresce.
 */

const firebase = require('./firebase')

function projeto () {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!bruto) {
    throw new Error(
      'Sem conta de serviço configurada: o envio de notificações precisa dela.'
    )
  }
  return JSON.parse(bruto).project_id
}

async function enviarParaToken (token, titulo, texto, dados) {
  const r = await fetch(
    'https://fcm.googleapis.com/v1/projects/' + projeto() + '/messages:send',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + await firebase.tokenDeAcesso()
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: titulo, body: texto },
          data: Object.fromEntries(
            Object.entries(dados || {}).map(([k, v]) => [k, String(v)])
          ),
          android: {
            priority: 'high',
            notification: { channel_id: 'geomax_avisos' }
          }
        }
      })
    }
  )

  if (r.ok) return { ok: true }

  const erro = await r.text()
  // 404 e UNREGISTERED: o token não vale mais. 400 com INVALID_ARGUMENT
  // costuma ser token corrompido. Nos dois casos, sai da lista.
  const invalido = r.status === 404 ||
    /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(erro)
  return { ok: false, invalido, erro }
}

/** Manda para todos os aparelhos de uma conta. */
async function avisar (uid, titulo, texto, dados) {
  const aparelhos = await firebase.ler('dispositivos/' + uid)
  if (!aparelhos) return { enviados: 0, removidos: 0 }

  let enviados = 0
  let removidos = 0

  for (const token of Object.keys(aparelhos)) {
    const r = await enviarParaToken(token, titulo, texto, dados)
    if (r.ok) {
      enviados++
    } else if (r.invalido) {
      await firebase.gravar('dispositivos/' + uid, { [token]: null })
      removidos++
    }
  }

  return { enviados, removidos }
}

/** Manda para todo mundo que já abriu o app e permitiu notificação. */
async function avisarTodos (titulo, texto, dados) {
  const contas = await firebase.ler('dispositivos')
  if (!contas) return { contas: 0, enviados: 0, removidos: 0 }

  let enviados = 0
  let removidos = 0

  for (const uid of Object.keys(contas)) {
    const r = await avisar(uid, titulo, texto, dados)
    enviados += r.enviados
    removidos += r.removidos
  }

  return { contas: Object.keys(contas).length, enviados, removidos }
}

module.exports = { avisar, avisarTodos }
