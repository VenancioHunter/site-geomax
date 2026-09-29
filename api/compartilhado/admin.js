'use strict'

/*
 * Quem é administrador.
 *
 * A lista fica em /admins/{uid} no banco, escrita só pela conta de serviço —
 * não há como se promover a administrador pelo site. A checagem acontece
 * SEMPRE no servidor: esconder o botão no navegador não protege nada.
 */

const firebase = require('./firebase')

/**
 * Devolve { uid, email } se quem chamou for administrador, ou null.
 * O token vem no cabeçalho Authorization, como no resto da API.
 */
async function administrador (req) {
  const autorizacao = req.headers.authorization || ''
  const idToken = autorizacao.startsWith('Bearer ') ? autorizacao.slice(7) : null
  if (!idToken) return null

  const conta = await firebase.uidDoToken(idToken)
  if (!conta) return null

  const marca = await firebase.ler('admins/' + conta.uid)
  return marca ? conta : null
}

/* ------------------------------------------------------- configurações */

const VALOR_PADRAO = () => Number(process.env.ASSINATURA_VALOR || '99.90')

/**
 * Preço da assinatura.
 *
 * Vem do banco, e não da variável de ambiente: preço em variável só muda
 * republicando o servidor, e mexer em preço é decisão de negócio, não de
 * implantação. A variável continua valendo como valor inicial.
 */
async function precoAssinatura () {
  const config = await firebase.ler('config/assinatura')
  const valor = config && Number(config.valor)
  return valor > 0 ? valor : VALOR_PADRAO()
}

async function gravarPreco (valor) {
  const numero = Number(valor)
  if (!(numero > 0) || numero > 100000) throw new Error('Valor inválido.')
  await firebase.gravar('config/assinatura', {
    valor: Math.round(numero * 100) / 100,
    atualizadoEm: new Date().toISOString()
  })
  return numero
}

/**
 * Catálogo de produtos, do banco, caindo para a lista do código quando o
 * banco ainda estiver vazio - é o que faz a primeira abertura do painel já
 * mostrar algo.
 */
async function catalogo () {
  const doBanco = await firebase.ler('config/produtos')
  if (doBanco && typeof doBanco === 'object') {
    const lista = Array.isArray(doBanco) ? doBanco : Object.values(doBanco)
    const validos = lista.filter(p => p && p.id && p.nome)
    if (validos.length) return validos
  }
  return require('./produtos').PRODUTOS
}

async function gravarCatalogo (produtos) {
  if (!Array.isArray(produtos) || produtos.length === 0) {
    throw new Error('Envie ao menos um produto.')
  }
  const limpos = produtos.map(p => {
    const preco = Number(p.preco)
    if (!p.id || !p.nome) throw new Error('Produto sem identificador ou nome.')
    if (!(preco >= 0)) throw new Error('Preço inválido em ' + p.nome + '.')
    return {
      id: String(p.id).trim(),
      nome: String(p.nome).trim(),
      descricao: String(p.descricao || '').trim(),
      preco: Math.round(preco * 100) / 100,
      ativo: p.ativo !== false
    }
  })
  await firebase.gravar('config', { produtos: limpos })
  return limpos
}

module.exports = {
  administrador,
  precoAssinatura,
  gravarPreco,
  catalogo,
  gravarCatalogo
}
