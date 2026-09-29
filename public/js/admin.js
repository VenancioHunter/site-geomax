/*
 * Painel administrativo.
 *
 * Toda decisão de permissão acontece no servidor: aqui só escondemos o que
 * não adianta mostrar. Se alguém abrir esta página sem ser administrador, as
 * chamadas voltam 403 e a tela diz isso.
 */

const mensagem = document.getElementById('mensagem')
const areaEntrar = document.getElementById('area-entrar')
const areaPainel = document.getElementById('area-painel')

let produtos = []

function avisar (texto, tipo) {
  mensagem.innerHTML = texto ? '<div class="' + (tipo || 'erro') + '">' + texto + '</div>' : ''
  if (texto) window.scrollTo({ top: 0, behavior: 'smooth' })
}

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function data (iso) {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso)
  return isNaN(d) ? iso : d.toLocaleDateString('pt-BR')
}

function escapar (texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Toda chamada leva o token; sem ele o servidor devolve 403. */
async function api (acao, corpo) {
  const token = await Conta.token()
  if (!token) throw new Error('Sessão expirada. Entre de novo.')

  const opcoes = {
    method: corpo ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token }
  }
  if (corpo) {
    opcoes.headers['Content-Type'] = 'application/json'
    opcoes.body = JSON.stringify({ acao, ...corpo })
  }

  const url = '/api/admin' + (corpo ? '' : '?acao=' + acao)
  const r = await fetch(url, opcoes)
  const dados = await r.json()
  if (!r.ok) throw new Error(dados.erro || 'Falhou.')
  return dados
}

/* ----------------------------------------------------------- entrada */

document.getElementById('form-entrar').addEventListener('submit', async (e) => {
  e.preventDefault()
  const botao = e.target.querySelector('button')
  botao.disabled = true
  avisar('')
  try {
    await Conta.entrar(
      document.getElementById('email').value.trim(),
      document.getElementById('senha').value
    )
    await abrirPainel()
  } catch (erro) {
    avisar(erro.message)
  } finally {
    botao.disabled = false
  }
})

document.getElementById('sair').addEventListener('click', (e) => {
  e.preventDefault()
  Conta.sair()
  location.reload()
})

async function abrirPainel () {
  const sessao = Conta.sessao()
  if (!sessao) return

  try {
    const config = await api('config')
    areaEntrar.hidden = true
    areaPainel.hidden = false
    document.getElementById('quem').textContent = sessao.email

    produtos = config.produtos
    document.getElementById('preco-atual').textContent = reais(config.preco)
    desenharProdutos()
    await carregarAssinantes()
  } catch (erro) {
    // 403 aqui é o caso comum: conta válida, sem permissão.
    avisar(erro.message + ' Peça para incluírem o seu código de conta na lista de administradores: ' + sessao.uid)
  }
}

/* --------------------------------------------------------------- abas */

document.querySelectorAll('.aba').forEach(botao => {
  botao.addEventListener('click', async () => {
    document.querySelectorAll('.aba').forEach(b => b.classList.toggle('atual', b === botao))
    const alvo = botao.dataset.aba
    ;['assinantes', 'pedidos', 'produtos', 'preco', 'admins', 'avisos'].forEach(nome => {
      document.getElementById('painel-' + nome).hidden = nome !== alvo
    })
    if (alvo === 'assinantes') await carregarAssinantes()
    if (alvo === 'pedidos') await carregarPedidos()
    if (alvo === 'admins') await carregarAdmins()
    if (alvo === 'avisos') await carregarAvisos()
  })
})

/* --------------------------------------------------------- assinantes */

async function carregarAssinantes () {
  try {
    const { assinantes, resumo } = await api('assinantes')

    document.getElementById('resumo-assinantes').innerHTML = `
      <div class="numero"><b>${resumo.ativas}</b>ativas</div>
      <div class="numero"><b>${resumo.vencidas}</b>vencidas</div>
      <div class="numero"><b>${resumo.aguardando}</b>aguardando pagamento</div>
      <div class="numero"><b>${resumo.total}</b>contas</div>`

    if (!assinantes.length) {
      document.getElementById('lista-assinantes').innerHTML =
        '<p class="miudo">Nenhuma conta com assinatura ainda.</p>'
      return
    }

    document.getElementById('lista-assinantes').innerHTML = assinantes.map(a => `
      <div class="linha">
        <div>
          <strong>${escapar(a.email || 'sem e-mail')}</strong>
          <div class="miudo">${escapar(a.uid)}</div>
        </div>
        <div>
          <span class="selo ${a.status === 'ativa' || a.status === 'teste' ? 'ativa' : (a.status === 'cancelada' ? 'cancelada' : 'vencida')}">${escapar(a.status || '—')}</span>
          <div class="miudo">até ${data(a.validoAte)}</div>
        </div>
        <div class="miudo">${a.cartaoFinal ? escapar(a.cartaoBandeira + ' ••••' + a.cartaoFinal) : 'sem cartão'}</div>
        <div class="acoes-linha">
          <button class="botao vazado" data-liberar="${escapar(a.uid)}">Liberar 30 dias</button>
          <button class="botao vazado" data-cancelar="${escapar(a.uid)}">Cancelar cobrança</button>
          <button class="botao perigo" data-bloquear="${escapar(a.uid)}">Bloquear</button>
        </div>
      </div>`).join('')

    ligarAcoesAssinante()
  } catch (erro) {
    avisar(erro.message)
  }
}

function ligarAcoesAssinante () {
  const lista = document.getElementById('lista-assinantes')

  lista.querySelectorAll('[data-liberar]').forEach(b => b.addEventListener('click', async () => {
    await executar(b, () => api('liberar', { uid: b.dataset.liberar, dias: 30 }), 'Liberado por 30 dias.')
  }))

  lista.querySelectorAll('[data-cancelar]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Cancelar a cobrança no Asaas? O acesso continua até a data já paga.')) return
    await executar(b, () => api('cancelar-cobranca', { uid: b.dataset.cancelar }), 'Cobrança cancelada.')
  }))

  lista.querySelectorAll('[data-bloquear]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Bloquear o acesso agora? O aplicativo para de abrir para esta conta.')) return
    await executar(b, () => api('bloquear', { uid: b.dataset.bloquear }), 'Acesso bloqueado.')
  }))
}

async function executar (botao, acao, sucesso) {
  botao.disabled = true
  try {
    await acao()
    avisar(sucesso, 'ok')
    await carregarAssinantes()
  } catch (erro) {
    avisar(erro.message)
  } finally {
    botao.disabled = false
  }
}

document.getElementById('liberar-conta').addEventListener('click', async (e) => {
  const quem = document.getElementById('liberar-quem').value.trim()
  const dias = Number(document.getElementById('liberar-dias').value) || 30
  if (!quem) return avisar('Informe o e-mail ou o código da conta.')

  const corpo = quem.includes('@') ? { email: quem } : { uid: quem }
  corpo.dias = dias
  corpo.comoTeste = document.getElementById('liberar-teste').checked

  e.target.disabled = true
  try {
    const dados = await api('liberar', corpo)
    document.getElementById('liberar-quem').value = ''
    avisar('Liberado até ' + data(dados.validoAte) + '.', 'ok')
    await carregarAssinantes()
  } catch (erro) {
    avisar(erro.message)
  } finally {
    e.target.disabled = false
  }
})

/* ------------------------------------------------------------ pedidos */

async function carregarPedidos () {
  try {
    const { pedidos, resumo } = await api('pedidos')

    document.getElementById('resumo-pedidos').innerHTML = `
      <div class="numero"><b>${resumo.total}</b>pedidos</div>
      <div class="numero"><b>${resumo.aEnviar}</b>a enviar</div>
      <div class="numero"><b>${reais(resumo.valor)}</b>vendido</div>`

    if (!pedidos.length) {
      document.getElementById('lista-pedidos').innerHTML = '<p class="miudo">Nenhum pedido ainda.</p>'
      return
    }

    document.getElementById('lista-pedidos').innerHTML = pedidos.map(p => {
      const e = p.entrega || {}
      const c = p.cliente || {}
      const enviado = p.envio && p.envio.status === 'enviado'
      return `
      <div class="linha">
        <div>
          <strong>${escapar(c.nome || '—')}</strong>
          <div class="miudo">${escapar(p.descricao || '')}</div>
          <div class="miudo">${escapar(e.endereco || '')} ${escapar(e.numero || '')} · ${escapar(e.cidade || '')} · ${escapar(e.cep || '')}</div>
          <div class="miudo">${escapar(c.telefone || '')} ${escapar(c.email || '')}</div>
        </div>
        <div>
          <strong>${reais(p.valor)}</strong>
          <div class="miudo">${data(p.criadoEm)}</div>
          <div class="miudo">${escapar((p.pagamento && p.pagamento.forma) || '')}</div>
        </div>
        <div>
          <span class="selo ${enviado ? 'ativa' : 'vencida'}">${enviado ? 'enviado' : 'a enviar'}</span>
          ${p.envio && p.envio.rastreio ? '<div class="miudo">' + escapar(p.envio.rastreio) + '</div>' : ''}
        </div>
        <div class="acoes-linha">
          <input placeholder="código de rastreio" data-rastreio="${escapar(p.id)}" style="min-width:180px">
          <button class="botao vazado" data-enviar="${escapar(p.id)}">Marcar enviado</button>
        </div>
      </div>`
    }).join('')

    document.querySelectorAll('[data-enviar]').forEach(b => b.addEventListener('click', async () => {
      const campo = document.querySelector('[data-rastreio="' + b.dataset.enviar + '"]')
      b.disabled = true
      try {
        await api('pedido', { id: b.dataset.enviar, status: 'enviado', rastreio: campo.value.trim() })
        avisar('Pedido marcado como enviado.', 'ok')
        await carregarPedidos()
      } catch (erro) {
        avisar(erro.message)
      } finally {
        b.disabled = false
      }
    }))
  } catch (erro) {
    avisar(erro.message)
  }
}

/* -------------------------------------------------------------- avisos */

async function carregarAvisos () {
  try {
    const { avisos } = await api('avisos')
    document.getElementById('lista-avisos').innerHTML = (avisos || []).length
      ? avisos.map(a => `
        <div class="linha">
          <div>
            <strong>${escapar(a.titulo)}</strong>
            <div class="miudo">${escapar(a.texto)}</div>
          </div>
          <div class="miudo">${a.para === 'todos' ? 'toda a base' : escapar(a.para)}</div>
          <div class="miudo">${data(a.em)}</div>
          <div class="miudo">${a.resultado ? a.resultado.enviados + ' aparelho(s)' : ''}</div>
        </div>`).join('')
      : '<p class="miudo">Nenhum aviso enviado ainda.</p>'
  } catch (erro) {
    avisar(erro.message)
  }
}

document.getElementById('enviar-aviso').addEventListener('click', async (e) => {
  const titulo = document.getElementById('aviso-titulo').value.trim()
  const texto = document.getElementById('aviso-texto').value.trim()
  const para = document.getElementById('aviso-para').value.trim()

  if (!titulo || !texto) return avisar('Escreva título e mensagem.')

  const destino = para ? ' para esta conta' : ' para TODA a base de assinantes'
  if (!confirm('Enviar "' + titulo + '"' + destino + '?')) return

  e.target.disabled = true
  try {
    const r = await api('avisar', { titulo, texto, uid: para || null })
    document.getElementById('aviso-titulo').value = ''
    document.getElementById('aviso-texto').value = ''
    avisar('Enviado para ' + r.enviados + ' aparelho(s).' +
      (r.removidos ? ' ' + r.removidos + ' token(s) inválido(s) removido(s).' : ''), 'ok')
    await carregarAvisos()
  } catch (erro) {
    avisar(erro.message)
  } finally {
    e.target.disabled = false
  }
})

/* ----------------------------------------------------- administradores */

async function carregarAdmins () {
  try {
    const { admins } = await api('admins')
    const eu = Conta.sessao().uid

    document.getElementById('lista-admins').innerHTML = admins.length
      ? admins.map(a => `
        <div class="linha">
          <div>
            <strong>${escapar(a.email || 'sem e-mail')}</strong>
            <div class="miudo">${escapar(a.uid)}</div>
          </div>
          <div class="miudo">desde ${data(a.desde)}</div>
          <div class="miudo">${a.promovidoPor ? 'por ' + escapar(a.promovidoPor) : ''}</div>
          <div class="acoes-linha">
            ${a.uid === eu
              ? '<span class="miudo">você</span>'
              : '<button class="botao perigo" data-remover="' + escapar(a.uid) + '">Remover</button>'}
          </div>
        </div>`).join('')
      : '<p class="miudo">Nenhum administrador cadastrado.</p>'

    document.querySelectorAll('[data-remover]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remover o acesso desta pessoa ao painel?')) return
      b.disabled = true
      try {
        await api('despromover', { uid: b.dataset.remover })
        avisar('Acesso removido.', 'ok')
        await carregarAdmins()
      } catch (erro) {
        avisar(erro.message)
      } finally {
        b.disabled = false
      }
    }))
  } catch (erro) {
    avisar(erro.message)
  }
}

document.getElementById('promover').addEventListener('click', async (e) => {
  const campo = document.getElementById('novo-admin')
  const valor = campo.value.trim()
  if (!valor) return avisar('Informe o e-mail ou o código da conta.')

  // Com arroba é e-mail; sem arroba, é o código da conta.
  const corpo = valor.includes('@') ? { email: valor } : { uid: valor }

  e.target.disabled = true
  try {
    const dados = await api('promover', corpo)
    campo.value = ''
    avisar('Acesso concedido a ' + (dados.email || dados.uid) + '.', 'ok')
    await carregarAdmins()
  } catch (erro) {
    avisar(erro.message)
  } finally {
    e.target.disabled = false
  }
})

/* ----------------------------------------------------------- produtos */

function desenharProdutos () {
  document.getElementById('lista-produtos').innerHTML = produtos.map((p, i) => `
    <div class="cartao" style="margin-top:var(--e3)">
      <div class="campo">
        <label>Nome</label>
        <input value="${escapar(p.nome)}" data-campo="nome" data-i="${i}">
      </div>
      <div class="campo">
        <label>Descrição</label>
        <input value="${escapar(p.descricao || '')}" data-campo="descricao" data-i="${i}">
      </div>
      <div class="campo metade">
        <label>Identificador</label>
        <input value="${escapar(p.id)}" data-campo="id" data-i="${i}">
      </div>
      <div class="campo metade">
        <label>Preço (R$)</label>
        <input value="${p.preco}" inputmode="decimal" data-campo="preco" data-i="${i}">
      </div>
      <label class="miudo" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" ${p.ativo === false ? '' : 'checked'} data-campo="ativo" data-i="${i}"
               style="width:auto">
        à venda na loja
      </label>
    </div>`).join('')

  document.querySelectorAll('[data-campo]').forEach(campo => {
    campo.addEventListener('input', () => {
      const p = produtos[Number(campo.dataset.i)]
      const nome = campo.dataset.campo
      p[nome] = nome === 'ativo' ? campo.checked
        : (nome === 'preco' ? Number(String(campo.value).replace(',', '.')) : campo.value)
    })
  })
}

document.getElementById('novo-produto').addEventListener('click', () => {
  produtos.push({ id: 'produto-' + (produtos.length + 1), nome: 'Novo produto', descricao: '', preco: 0, ativo: true })
  desenharProdutos()
})

document.getElementById('salvar-produtos').addEventListener('click', async (e) => {
  e.target.disabled = true
  try {
    const dados = await api('produtos', { produtos })
    produtos = dados.produtos
    desenharProdutos()
    avisar('Produtos salvos. A loja já mostra os novos valores.', 'ok')
  } catch (erro) {
    avisar(erro.message)
  } finally {
    e.target.disabled = false
  }
})

/* -------------------------------------------------------------- preço */

document.getElementById('salvar-preco').addEventListener('click', async (e) => {
  const valor = Number(String(document.getElementById('novo-preco').value).replace(',', '.'))
  if (!(valor > 0)) return avisar('Informe um valor válido, por exemplo 99,90.')

  e.target.disabled = true
  try {
    const dados = await api('preco', { valor })
    document.getElementById('preco-atual').textContent = reais(dados.preco)
    document.getElementById('novo-preco').value = ''
    avisar('Preço atualizado. Vale para novas assinaturas.', 'ok')
  } catch (erro) {
    avisar(erro.message)
  } finally {
    e.target.disabled = false
  }
})

if (Conta.sessao()) abrirPainel()
