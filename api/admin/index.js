'use strict'

/*
 * Painel do administrador: assinantes, pedidos, produtos e preço.
 *
 * Uma função só, com a ação no corpo ou na consulta. São operações pequenas e
 * todas exigem a mesma verificação; separar em seis funções só multiplicaria
 * a checagem de permissão, que é o ponto em que um erro custa caro.
 *
 * Toda chamada confirma no servidor que quem pediu é administrador. O painel
 * esconder botões não protege nada.
 */

const admin = require('../compartilhado/admin')
const asaas = require('../compartilhado/asaas')
const firebase = require('../compartilhado/firebase')
const avisos = require('../compartilhado/avisos')

const DIA_MS = 24 * 60 * 60 * 1000

function emDias (dias) {
  return new Date(Date.now() + dias * DIA_MS).toISOString().slice(0, 10)
}

/** O mapa do Firebase vira lista, com a chave junto. */
function paraLista (mapa, nomeDaChave) {
  if (!mapa) return []
  return Object.entries(mapa).map(([chave, valor]) => ({ [nomeDaChave]: chave, ...valor }))
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
    const quem = await admin.administrador(req)
    if (!quem) return responder(403, { erro: 'Conta sem permissão de administrador.' })

    const corpo = req.body || {}
    // GET sem ação nenhuma cai em "config": é o que o painel pede ao abrir, e
    // evita um 400 confuso quando a consulta se perde no caminho.
    const acao = (req.query && req.query.acao) || corpo.acao ||
      ((req.method || 'GET').toUpperCase() === 'GET' ? 'config' : null)

    switch (acao) {
      /* ------------------------------------------------ leituras ----- */

      case 'assinantes': {
        const [assinaturas, clientes] = await Promise.all([
          firebase.ler('assinaturas'),
          firebase.ler('clientes')
        ])

        // O e-mail mora no vínculo com o cliente do Asaas; a assinatura
        // guarda só o uid. Sem esta junção, a lista seria de códigos.
        const porUid = {}
        paraLista(clientes, 'clienteAsaas').forEach(c => {
          if (c.uid) porUid[c.uid] = c.email
        })

        const lista = paraLista(assinaturas, 'uid')
          .map(a => ({ ...a, email: a.email || porUid[a.uid] || null }))
          .sort((x, y) => String(y.atualizadoEm || '').localeCompare(String(x.atualizadoEm || '')))

        return responder(200, {
          assinantes: lista,
          resumo: {
            total: lista.length,
            ativas: lista.filter(a => a.status === 'ativa').length,
            vencidas: lista.filter(a => a.status === 'vencida').length,
            aguardando: lista.filter(a => a.status === 'aguardando_pagamento').length
          }
        })
      }

      case 'pedidos': {
        const pedidos = paraLista(await firebase.ler('pedidos'), 'id')
          .sort((x, y) => String(y.criadoEm || '').localeCompare(String(x.criadoEm || '')))
        return responder(200, {
          pedidos,
          resumo: {
            total: pedidos.length,
            aEnviar: pedidos.filter(p => !p.envio || p.envio.status !== 'enviado').length,
            valor: pedidos.reduce((s, p) => s + (Number(p.valor) || 0), 0)
          }
        })
      }

      case 'admins':
        return responder(200, {
          admins: paraLista(await firebase.ler('admins'), 'uid')
        })

      case 'avisos':
        return responder(200, {
          avisos: paraLista(await firebase.ler('avisos'), 'em')
            .sort((x, y) => String(y.em || '').localeCompare(String(x.em || '')))
            .slice(0, 30)
        })

      case 'config':
        return responder(200, {
          preco: await admin.precoAssinatura(),
          produtos: await admin.catalogo()
        })

      /* ------------------------------------------------ escritas ----- */

      case 'liberar': {
        // Libera na mão: teste, cortesia, ou cliente que pagou por fora.
        const dias = Math.min(3650, Math.max(1, Number(corpo.dias) || 30))

        // Aceita e-mail porque a conta nova ainda não está na lista: quem
        // nunca teve assinatura não tem registro para clicar.
        let uid = (corpo.uid || '').trim()
        let email = (corpo.email || '').trim()
        if (!uid) {
          if (!email) return responder(400, { erro: 'Informe o e-mail ou o código da conta.' })
          const conta = await firebase.contaPorEmail(email)
          if (!conta) return responder(404, { erro: 'Não existe conta com este e-mail.' })
          uid = conta.uid
          email = conta.email
        }

        await firebase.gravar('assinaturas/' + uid, {
          email: email || null,
          status: corpo.comoTeste ? 'teste' : 'ativa',
          validoAte: emDias(dias),
          liberadoPor: quem.email,
          atualizadoEm: new Date().toISOString()
        })
        return responder(200, { ok: true, uid, validoAte: emDias(dias) })
      }

      case 'bloquear': {
        if (!corpo.uid) return responder(400, { erro: 'Informe a conta.' })
        await firebase.gravar('assinaturas/' + corpo.uid, {
          status: 'cancelada',
          validoAte: new Date().toISOString().slice(0, 10),
          bloqueadoPor: quem.email,
          atualizadoEm: new Date().toISOString()
        })
        return responder(200, { ok: true })
      }

      case 'cancelar-cobranca': {
        // Cancela no Asaas: para de cobrar o cartão. O acesso continua até a
        // data já paga, que é o que o app lê.
        const assinatura = await firebase.ler('assinaturas/' + corpo.uid)
        if (!assinatura || !assinatura.assinaturaAsaas) {
          return responder(400, { erro: 'Esta conta não tem assinatura no Asaas.' })
        }
        await asaas.cancelarAssinatura(assinatura.assinaturaAsaas)
        await firebase.gravar('assinaturas/' + corpo.uid, {
          status: 'cancelada',
          canceladoPor: quem.email,
          atualizadoEm: new Date().toISOString()
        })
        return responder(200, { ok: true, validoAte: assinatura.validoAte })
      }

      case 'promover': {
        // Aceita e-mail ou código. O e-mail é o que a pessoa sabe de cor; o
        // código serve quando a conta de serviço ainda não está configurada.
        let uid = (corpo.uid || '').trim()
        let email = (corpo.email || '').trim()

        if (!uid) {
          if (!email) return responder(400, { erro: 'Informe o e-mail ou o código da conta.' })
          const conta = await firebase.contaPorEmail(email)
          if (!conta) return responder(404, { erro: 'Não existe conta com este e-mail.' })
          uid = conta.uid
          email = conta.email
        }

        await firebase.gravar('admins/' + uid, {
          email: email || null,
          promovidoPor: quem.email,
          desde: new Date().toISOString()
        })
        return responder(200, { ok: true, uid, email })
      }

      case 'despromover': {
        if (!corpo.uid) return responder(400, { erro: 'Informe a conta.' })
        // Sem isto, o último administrador poderia se remover e ninguém mais
        // entraria no painel - só pelo console do Firebase.
        if (corpo.uid === quem.uid) {
          return responder(400, { erro: 'Você não pode remover a si mesmo.' })
        }
        await firebase.gravar('admins/' + corpo.uid, {
          email: null, promovidoPor: null, desde: null
        })
        return responder(200, { ok: true })
      }

      case 'avisar': {
        const titulo = (corpo.titulo || '').trim()
        const texto = (corpo.texto || '').trim()
        if (!titulo || !texto) return responder(400, { erro: 'Escreva título e mensagem.' })

        const resultado = corpo.uid
          ? await avisos.avisar(corpo.uid, titulo, texto)
          : await avisos.avisarTodos(titulo, texto)

        // Guarda o que foi enviado: sem histórico, ninguém sabe o que a
        // equipe já recebeu nem por que um cliente reclamou.
        await firebase.gravar('avisos/' + Date.now(), {
          titulo,
          texto,
          para: corpo.uid || 'todos',
          enviadoPor: quem.email,
          em: new Date().toISOString(),
          resultado
        })

        return responder(200, resultado)
      }

      case 'preco':
        return responder(200, { preco: await admin.gravarPreco(corpo.valor) })

      case 'produtos':
        return responder(200, { produtos: await admin.gravarCatalogo(corpo.produtos) })

      case 'pedido': {
        if (!corpo.id) return responder(400, { erro: 'Informe o pedido.' })
        await firebase.gravar('pedidos/' + corpo.id, {
          envio: {
            status: corpo.status || 'enviado',
            rastreio: corpo.rastreio || null,
            marcadoPor: quem.email,
            em: new Date().toISOString()
          }
        })
        return responder(200, { ok: true })
      }

      default:
        return responder(400, { erro: 'Ação desconhecida: ' + acao })
    }
  } catch (e) {
    context.log.error('admin', e)
    responder(500, { erro: e.message || 'Falhou.' })
  }
}
