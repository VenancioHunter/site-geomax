'use strict'

/*
 * Exercita o painel contra o banco de verdade, sem precisar de uma conta de
 * administrador: só a verificação de identidade é substituída.
 *
 *   node api/testar-admin.js
 *
 * Cria uma marca de administrador de mentira, roda todas as ações e apaga
 * tudo o que criou.
 */

const fs = require('fs')
const path = require('path')

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'local.settings.json'), 'utf8')
).Values
Object.entries(config).forEach(([k, v]) => { process.env[k] = v })

const firebase = require('./compartilhado/firebase')

const UID_ADMIN = 'admin-de-teste'
const UID_ALVO = 'assinante-de-teste'

// Substitui a checagem do token: o resto do caminho é o mesmo de produção.
firebase.uidDoToken = async () => ({ uid: UID_ADMIN, email: 'teste@local' })

const painel = require('./admin')

const contexto = {
  res: null,
  log: Object.assign(() => {}, { error: (...a) => console.error('   ', ...a), warn: () => {} })
}

async function chamar (acao, corpo) {
  await painel(contexto, {
    headers: { authorization: 'Bearer qualquer' },
    query: corpo ? {} : { acao },
    body: corpo ? { acao, ...corpo } : {},
    method: corpo ? 'POST' : 'GET'
  })
  const r = contexto.res
  return { status: r.status, dados: JSON.parse(r.body) }
}

async function passo (titulo, fn) {
  process.stdout.write(titulo.padEnd(34) + ' ')
  const r = await fn()
  console.log('ok')
  return r
}

async function main () {
  console.log('Banco:', process.env.FIREBASE_DB_URL, '\n')

  await passo('marca de administrador', () =>
    firebase.gravar('admins/' + UID_ADMIN, { email: 'teste@local', desde: new Date().toISOString() })
  )

  const config1 = await passo('lê preço e produtos', async () => {
    const r = await chamar('config')
    if (r.status !== 200) throw new Error(JSON.stringify(r.dados))
    return r.dados
  })
  console.log('   preço atual:', config1.preco, '· produtos:', config1.produtos.length)

  await passo('troca o preço para 99,90', async () => {
    const r = await chamar('preco', { valor: 99.9 })
    if (r.dados.preco !== 99.9) throw new Error('não gravou: ' + JSON.stringify(r.dados))
  })

  await passo('recusa preço inválido', async () => {
    const r = await chamar('preco', { valor: -5 })
    if (r.status === 200) throw new Error('aceitou valor negativo')
  })

  await passo('salva o catálogo', async () => {
    const novos = config1.produtos.map(p => ({ ...p, ativo: true }))
    novos.push({ id: 'teste', nome: 'Produto de teste', descricao: 'apagar', preco: 1.5, ativo: false })
    const r = await chamar('produtos', { produtos: novos })
    if (r.status !== 200) throw new Error(JSON.stringify(r.dados))
    if (r.dados.produtos.length !== novos.length) throw new Error('quantidade errada')
  })

  await passo('loja esconde o inativo', async () => {
    const comprar = require('./comprar')
    await comprar(contexto, { method: 'GET', headers: {}, body: {} })
    const lista = JSON.parse(contexto.res.body).produtos
    if (lista.some(p => p.id === 'teste')) throw new Error('produto inativo apareceu na loja')
  })

  await passo('libera uma conta por 30 dias', async () => {
    const r = await chamar('liberar', { uid: UID_ALVO, dias: 30 })
    if (r.status !== 200) throw new Error(JSON.stringify(r.dados))
    const gravado = await firebase.ler('assinaturas/' + UID_ALVO)
    if (gravado.status !== 'ativa') throw new Error('não ficou ativa')
  })

  const lista = await passo('lista assinantes', async () => {
    const r = await chamar('assinantes')
    if (r.status !== 200) throw new Error(JSON.stringify(r.dados))
    return r.dados
  })
  console.log('   contas:', lista.resumo.total, '· ativas:', lista.resumo.ativas)

  await passo('bloqueia a conta', async () => {
    await chamar('bloquear', { uid: UID_ALVO })
    const gravado = await firebase.ler('assinaturas/' + UID_ALVO)
    if (gravado.status !== 'cancelada') throw new Error('não bloqueou')
  })

  await passo('lista pedidos', async () => {
    const r = await chamar('pedidos')
    if (r.status !== 200) throw new Error(JSON.stringify(r.dados))
    console.log('\n   pedidos:', r.dados.resumo.total, '· a enviar:', r.dados.resumo.aEnviar)
  })

  await passo('promove por código', async () => {
    const r = await chamar('promover', { uid: 'outro-admin-de-teste', email: 'outro@local' })
    if (r.status !== 200) throw new Error(JSON.stringify(r.dados))
    const lista = await chamar('admins')
    if (!lista.dados.admins.some(a => a.uid === 'outro-admin-de-teste')) {
      throw new Error('não apareceu na lista')
    }
  })

  await passo('não deixa remover a si mesmo', async () => {
    const r = await chamar('despromover', { uid: UID_ADMIN })
    if (r.status !== 400) throw new Error('deixou remover a si mesmo')
  })

  await passo('remove o outro administrador', async () => {
    const r = await chamar('despromover', { uid: 'outro-admin-de-teste' })
    if (r.status !== 200) throw new Error(JSON.stringify(r.dados))
    const lista = await chamar('admins')
    if (lista.dados.admins.some(a => a.uid === 'outro-admin-de-teste' && a.email)) {
      throw new Error('continuou na lista')
    }
  })

  await passo('promover por e-mail sem credencial', async () => {
    const r = await chamar('promover', { email: 'alguem@exemplo.com' })
    // Sem conta de serviço, tem de falhar explicando - e não em silêncio.
    if (r.status === 200) throw new Error('promoveu sem conseguir consultar o e-mail')
  })

  await passo('recusa ação desconhecida', async () => {
    const r = await chamar('apagar-tudo', { uid: UID_ALVO })
    if (r.status !== 400) throw new Error('aceitou ação inexistente')
  })

  process.stdout.write('\nlimpando … ')
  await firebase.gravar('admins/' + UID_ADMIN, { email: null, desde: null })
  await firebase.gravar('assinaturas/' + UID_ALVO, {
    status: null, validoAte: null, liberadoPor: null, bloqueadoPor: null, atualizadoEm: null
  })
  await firebase.gravar('config', { produtos: config1.produtos })
  console.log('ok')

  console.log('\nPainel funcionando.')
}

main().catch((e) => {
  console.error('\nERRO:', e.message)
  process.exit(1)
})
