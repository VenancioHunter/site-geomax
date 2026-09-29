/*
 * Ajudas de formulário: máscara, validação e mensagens.
 *
 * Nada de biblioteca. São quatro campos que precisam de máscara e uma
 * validação de CPF — carregar 40 kB de dependência para isso seria pior para
 * quem abre o site no 3G da rua.
 */

function mascarar (input, formatar) {
  if (!input) return
  input.addEventListener('input', () => {
    const posicaoNoFim = input.selectionStart === input.value.length
    input.value = formatar(input.value)
    if (posicaoNoFim) input.setSelectionRange(input.value.length, input.value.length)
  })
}

const digitos = (v) => (v || '').replace(/\D/g, '')

function formatarDocumento (v) {
  const d = digitos(v).slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

const formatarCep = (v) => digitos(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')

const formatarTelefone = (v) => digitos(v).slice(0, 11)
  .replace(/(\d{2})(\d)/, '($1) $2')
  .replace(/(\d{5})(\d)/, '$1-$2')

const formatarCartao = (v) => digitos(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')

function formatarValidade (v) {
  const d = digitos(v).slice(0, 6)
  return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d
}

/** Dígitos verificadores do CPF: pega o erro de digitação antes do servidor. */
function cpfValido (valor) {
  const d = digitos(valor)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  for (const [peso, posicao] of [[10, 9], [11, 10]]) {
    let soma = 0
    for (let i = 0; i < posicao; i++) soma += Number(d[i]) * (peso - i)
    let resto = (soma * 10) % 11
    if (resto === 10) resto = 0
    if (resto !== Number(d[posicao])) return false
  }
  return true
}

/** Mensagem embaixo do campo, e não num alerta lá em cima. */
function erroNoCampo (input, texto) {
  if (!input) return
  const campo = input.closest('.campo') || input.parentElement
  let aviso = campo.querySelector('.erro-campo')

  if (!texto) {
    input.removeAttribute('aria-invalid')
    if (aviso) aviso.remove()
    return
  }

  input.setAttribute('aria-invalid', 'true')
  if (!aviso) {
    aviso = document.createElement('p')
    aviso.className = 'erro-campo'
    campo.appendChild(aviso)
  }
  aviso.textContent = texto
}

function ligarMascaras () {
  mascarar(document.getElementById('documento'), formatarDocumento)
  mascarar(document.getElementById('cep'), formatarCep)
  mascarar(document.getElementById('telefone'), formatarTelefone)
  mascarar(document.getElementById('cartao-numero'), formatarCartao)
  mascarar(document.getElementById('cartao-validade'), formatarValidade)
  mascarar(document.getElementById('cartao-cvv'), (v) => digitos(v).slice(0, 4))

  const documento = document.getElementById('documento')
  if (documento) {
    documento.addEventListener('blur', () => {
      const d = digitos(documento.value)
      if (d.length === 11 && !cpfValido(d)) erroNoCampo(documento, 'Confira o CPF: os dígitos não batem.')
      else erroNoCampo(documento, null)
    })
  }
}

window.Formulario = { ligarMascaras, erroNoCampo, digitos, cpfValido }
