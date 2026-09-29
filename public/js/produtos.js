/*
 * Loja de equipamento.
 *
 * O carrinho vive só nesta página, e os preços exibidos vêm do servidor: o
 * que o navegador manda de volta são ids e quantidades, nunca valores.
 */

const carrinho = new Map()
let catalogo = []

const mensagem = document.getElementById('mensagem')
const elCatalogo = document.getElementById('catalogo')
const resumo = document.getElementById('resumo')
const pronto = document.getElementById('pronto')

function avisar (texto, tipo) {
  mensagem.innerHTML = texto ? '<div class="' + (tipo || 'erro') + '">' + texto + '</div>' : ''
  if (texto) mensagem.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function reais (valor) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

async function carregar () {
  try {
    const r = await fetch('/api/comprar')
    const dados = await r.json()
    catalogo = dados.produtos || []
    desenharCatalogo()
  } catch (e) {
    avisar('Não foi possível carregar os produtos. Recarregue a página.')
  }
}

function desenharCatalogo () {
  elCatalogo.innerHTML = catalogo.map(p => `
    <div class="cartao produto ${carrinho.has(p.id) ? 'escolhido' : ''}">
      <h3>${p.nome}</h3>
      <p>${p.descricao}</p>
      <div class="preco">${reais(p.preco)}</div>
      <button class="botao ${carrinho.has(p.id) ? '' : 'vazado'}" data-produto="${p.id}">
        ${carrinho.has(p.id) ? 'Escolhido ✓' : 'Adicionar'}
      </button>
    </div>
  `).join('')

  elCatalogo.querySelectorAll('button[data-produto]').forEach(b => {
    b.addEventListener('click', () => alternar(b.dataset.produto))
  })
}

function alternar (id) {
  if (carrinho.has(id)) carrinho.delete(id)
  else carrinho.set(id, 1)
  desenharCatalogo()
  desenharResumo()
}

function desenharResumo () {
  const barra = document.getElementById('barra-resumo')
  if (carrinho.size === 0) {
    resumo.hidden = true
    barra.hidden = true
    return
  }

  const itens = [...carrinho.keys()].map(id => catalogo.find(p => p.id === id))
  const total = itens.reduce((s, p) => s + p.preco, 0)

  // A barra fica colada embaixo enquanto a pessoa rola: no celular, o total
  // sumia da tela e ninguém sabia quanto ia pagar.
  barra.hidden = false
  document.getElementById('barra-itens').textContent =
    itens.length + (itens.length === 1 ? ' item' : ' itens')
  document.getElementById('barra-total').textContent = reais(total)

  resumo.hidden = false
  document.getElementById('resumo-itens').textContent = itens.map(p => p.nome).join(' · ')
  document.getElementById('resumo-total').textContent = reais(total)
}

document.getElementById('ir-para-dados').addEventListener('click', () => {
  document.getElementById('form-compra').scrollIntoView({ behavior: 'smooth' })
  document.getElementById('nome').focus()
})

Formulario.ligarMascaras()

// Cartão é o padrão; no Pix os campos de cartão somem para não confundir.
const forma = document.getElementById('forma')
const camposCartao = document.getElementById('campos-cartao')
forma.addEventListener('change', () => {
  camposCartao.hidden = forma.value !== 'CREDIT_CARD'
})

document.getElementById('form-compra').addEventListener('submit', async (e) => {
  e.preventDefault()
  const botao = e.target.querySelector('button')
  botao.disabled = true
  botao.textContent = 'Enviando…'
  avisar('')

  try {
    const corpo = {
      itens: [...carrinho.entries()].map(([id, quantidade]) => ({ id, quantidade })),
      cliente: {
        nome: document.getElementById('nome').value.trim(),
        email: document.getElementById('email').value.trim(),
        cpfCnpj: document.getElementById('documento').value,
        telefone: document.getElementById('telefone').value
      },
      entrega: {
        cep: document.getElementById('cep').value,
        endereco: document.getElementById('endereco').value.trim(),
        numero: document.getElementById('numero').value.trim(),
        complemento: document.getElementById('complemento').value.trim(),
        cidade: document.getElementById('cidade').value.trim()
      },
      formaPagamento: forma.value
    }

    if (forma.value === 'CREDIT_CARD') {
      const validade = (document.getElementById('cartao-validade').value || '').split('/')
      corpo.cartao = {
        nome: document.getElementById('cartao-nome').value.trim(),
        numero: document.getElementById('cartao-numero').value,
        mes: (validade[0] || '').trim(),
        ano: (validade[1] || '').trim(),
        cvv: document.getElementById('cartao-cvv').value
      }
    }

    const r = await fetch('/api/comprar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    })
    const dados = await r.json()
    if (!r.ok) throw new Error(dados.erro || 'Não foi possível concluir a compra.')

    resumo.hidden = true
    elCatalogo.hidden = true
    pronto.hidden = false

    document.getElementById('pronto-texto').textContent = dados.cartao
      ? 'Pagamento no ' + dados.cartao + ' — ' + dados.descricao + ', ' + reais(dados.valor) + '.'
      : 'Pedido de ' + reais(dados.valor) + ' registrado. Falta pagar.'

    if (dados.link) {
      const link = document.getElementById('pronto-link')
      link.href = dados.link
      link.hidden = false
    }
  } catch (erro) {
    avisar(erro.message)
  } finally {
    botao.disabled = false
    botao.textContent = 'Finalizar compra'
  }
})

carregar()
