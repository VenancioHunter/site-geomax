'use strict'

/*
 * Catálogo de produtos.
 *
 * Fica no servidor, e não no site, de propósito: preço que vem do navegador é
 * preço que o comprador edita. O site só mostra; quem soma é daqui.
 *
 * Preços em reais. AJUSTE ANTES DE PUBLICAR.
 */

const PRODUTOS = [
  {
    id: 'sensor',
    nome: 'Sensor de solo GeoMax',
    descricao: 'Sensor piezoelétrico com saída P10, base metálica e cabo blindado.',
    preco: 1290.00,
    entrega: true
  },
  {
    id: 'haste',
    nome: 'Haste de escuta',
    descricao: 'Haste de aço para escuta direta em registro, cavalete e hidrante.',
    preco: 390.00,
    entrega: true
  },
  {
    id: 'interface',
    nome: 'Interface de áudio USB',
    descricao: 'Interface compacta para ligar o sensor ao celular por USB-C.',
    preco: 490.00,
    entrega: true
  },
  {
    id: 'kit',
    nome: 'Kit completo',
    descricao: 'Sensor, haste, interface e fone. Tudo o que o aplicativo precisa.',
    preco: 2290.00,
    entrega: true
  }
]

function porId (id, lista) {
  return (lista || PRODUTOS).find(p => p.id === id) || null
}

/** Total em reais, com duas casas. */
function total (itens, lista) {
  const soma = itens.reduce((acc, item) => {
    const produto = porId(item.id, lista)
    if (!produto) throw new Error('Produto desconhecido: ' + item.id)
    const quantidade = Math.max(1, Math.min(10, Number(item.quantidade) || 1))
    return acc + produto.preco * quantidade
  }, 0)
  return Math.round(soma * 100) / 100
}

/** Uma linha por item, para a descrição da cobrança. */
function descrever (itens, lista) {
  return itens.map(item => {
    const p = porId(item.id, lista)
    const q = Math.max(1, Math.min(10, Number(item.quantidade) || 1))
    return q + 'x ' + p.nome
  }).join(', ')
}

module.exports = { PRODUTOS, porId, total, descrever }
