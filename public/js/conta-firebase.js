/*
 * Conta do usuário no site: criar, entrar, recuperar senha e excluir.
 *
 * Fala direto com a API REST do Firebase, sem SDK. São cinco chamadas, e
 * assim o site não carrega meio megabyte de JavaScript nem depende de CDN —
 * o mesmo caminho que o aplicativo Android usa.
 */

const CHAVE_API = 'AIzaSyBs2J-71wp82OrqbAej1cwtnnlsDwf4Nq0'
const BANCO = 'https://geomax-c3f78-default-rtdb.firebaseio.com'
const GUARDADO = 'geomax.sessao'

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts:'
const TOKEN = 'https://securetoken.googleapis.com/v1/token'

/** Mensagens do Firebase são em inglês e técnicas demais para a tela. */
const MENSAGENS = {
  EMAIL_EXISTS: 'Já existe uma conta com este e-mail.',
  EMAIL_NOT_FOUND: 'Não encontramos uma conta com este e-mail.',
  INVALID_PASSWORD: 'Senha incorreta.',
  INVALID_LOGIN_CREDENTIALS: 'E-mail ou senha incorretos.',
  USER_DISABLED: 'Esta conta foi desativada.',
  WEAK_PASSWORD: 'A senha precisa de pelo menos 6 caracteres.',
  INVALID_EMAIL: 'E-mail inválido.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Muitas tentativas. Espere alguns minutos.',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'Por segurança, entre de novo antes de fazer isso.'
}

function traduzir (codigo) {
  if (!codigo) return 'Não foi possível concluir. Tente de novo.'
  const chave = Object.keys(MENSAGENS).find(k => codigo.startsWith(k))
  return chave ? MENSAGENS[chave] : 'Não foi possível concluir. Tente de novo.'
}

async function chamar (metodo, corpo) {
  const r = await fetch(IDENTITY + metodo + '?key=' + CHAVE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  })
  const dados = await r.json()
  if (!r.ok) throw new Error(traduzir(dados.error && dados.error.message))
  return dados
}

function guardar (dados) {
  localStorage.setItem(GUARDADO, JSON.stringify({
    idToken: dados.idToken,
    refreshToken: dados.refreshToken,
    email: dados.email,
    uid: dados.localId,
    expiraEm: Date.now() + (Number(dados.expiresIn || 3600) - 60) * 1000
  }))
}

function sessao () {
  try {
    return JSON.parse(localStorage.getItem(GUARDADO) || 'null')
  } catch (e) {
    return null
  }
}

function sair () {
  localStorage.removeItem(GUARDADO)
}

/** Token válido, renovando quando faltar menos de um minuto. */
async function token () {
  const s = sessao()
  if (!s) return null
  if (s.expiraEm > Date.now()) return s.idToken

  const r = await fetch(TOKEN + '?key=' + CHAVE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: s.refreshToken
    })
  })
  if (!r.ok) {
    sair()
    return null
  }
  const d = await r.json()
  guardar({
    idToken: d.id_token,
    refreshToken: d.refresh_token,
    email: s.email,
    localId: d.user_id,
    expiresIn: d.expires_in
  })
  return d.id_token
}

async function criarConta (nome, email, senha) {
  const dados = await chamar('signUp', { email, password: senha, returnSecureToken: true })
  await chamar('update', { idToken: dados.idToken, displayName: nome, returnSecureToken: false })
  guardar({ ...dados, email })
  return dados
}

async function entrar (email, senha) {
  const dados = await chamar('signInWithPassword', {
    email, password: senha, returnSecureToken: true
  })
  guardar({ ...dados, email })
  return dados
}

async function recuperarSenha (email) {
  return chamar('sendOobCode', { requestType: 'PASSWORD_RESET', email })
}

async function excluirConta () {
  const idToken = await token()
  if (!idToken) throw new Error('Entre de novo para excluir a conta.')
  await chamar('delete', { idToken })
  sair()
}

/** A assinatura da própria conta. As regras do banco impedem ler a de outro. */
async function minhaAssinatura () {
  const s = sessao()
  const idToken = await token()
  if (!s || !idToken) return null

  const r = await fetch(BANCO + '/assinaturas/' + s.uid + '.json?auth=' + idToken)
  if (!r.ok) return null
  return r.json()
}

window.Conta = {
  criarConta, entrar, recuperarSenha, excluirConta,
  minhaAssinatura, sessao, sair, token
}
