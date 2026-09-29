# Site e servidor de assinatura do GeoMax

Site institucional, criação de conta, cobrança pelo Asaas e o webhook que
libera o app. Hospedagem na **Azure Static Web Apps** (site + funções no mesmo
recurso), dados no **Firebase** que o app já usa.

> Nada aqui foi publicado nem testado ainda. O passo a passo abaixo é a ordem
> em que isso precisa ser feito.

## Como as peças se encaixam

```
Pessoa no site  →  cria conta (Firebase Auth)
                →  /api/criar-assinatura  →  Asaas cria cliente + assinatura
                →  paga no link do Asaas (Pix, boleto ou cartão)

Asaas  →  /api/asaas-webhook  →  grava /assinaturas/{uid} no Firebase

App GeoMax  →  entra com a mesma conta  →  lê /assinaturas/{uid}  →  libera
```

O app **nunca** fala com o Asaas. Ele só lê a validade no Firebase. Trocar de
gateway um dia não mexe no aplicativo.

## O que você precisa criar (nesta ordem)

### 1. Domínio

Registre no [registro.br](https://registro.br), cerca de R$ 40 por ano.
Sugestão: `geomax.com.br`. O site fica na raiz e o app usa o mesmo domínio nos
links de política de privacidade e exclusão de conta, que a Play Store exige.

### 2. Conta no Asaas

1. Crie a conta em [asaas.com](https://www.asaas.com) com o CNPJ da empresa.
2. Comece no **sandbox** (ambiente de teste): `https://sandbox.asaas.com`.
3. Em **Integrações → API**, copie a chave. Ela vai numa variável de ambiente,
   **nunca** no código nem no site.
4. Crie o webhook apontando para `https://SEU-DOMINIO/api/asaas-webhook`, com
   um **token próprio** (invente uma senha longa) — não use a chave da API.
   Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`,
   `PAYMENT_REFUNDED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`.

### 3. Conta de serviço do Firebase

Console do Firebase → **Configurações do projeto → Contas de serviço →
Gerar nova chave privada**. Sai um arquivo JSON. Ele dá acesso total ao banco:
guarde como senha, não comite no Git.

### 4. Azure

1. Crie um **Static Web App** (plano gratuito) ligado ao repositório.
2. Em **Configuração → Variáveis de ambiente**, cadastre:

| Nome | Valor |
| --- | --- |
| `ASAAS_URL` | `https://api-sandbox.asaas.com/v3` (troque para `https://api.asaas.com/v3` na virada) |
| `ASAAS_CHAVE` | a chave da API do Asaas |
| `ASAAS_WEBHOOK_TOKEN` | o token que você inventou no passo 2 |
| `ASSINATURA_VALOR` | valor mensal, por exemplo `99.90` |
| `ASSINATURA_DESCRICAO` | `GeoMax — assinatura mensal` |
| `FIREBASE_SERVICE_ACCOUNT` | o JSON inteiro do passo 3, em uma linha |
| `FIREBASE_DB_URL` | `https://geomax-c3f78-default-rtdb.firebaseio.com` |
| `DIAS_TOLERANCIA` | `5` |

3. Aponte o domínio do passo 1 para o Static Web App.

### 5. Regras do banco

No Firebase → Realtime Database → Regras:

```json
{
  "rules": {
    "assinaturas": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    },
    "clientes": { ".read": false, ".write": false },
    "eventos": { ".read": false, ".write": false },
    "pedidos": { ".read": false, ".write": false },
    "admins": { ".read": false, ".write": false },
    "config": { ".read": false, ".write": false },
    "geofone": {
      "filtros": { ".read": false, ".write": "auth != null" }
    }
  }
}
```

Cada pessoa lê **só a própria** assinatura e não escreve nada: quem escreve é o
webhook, com a conta de serviço, que passa por cima das regras.

Hoje o banco está aberto. **Feche assim que o app novo estiver publicado** —
antes disso, o envio de filtros do app atual para de funcionar.

## Painel do administrador

Fica em `/admin.html`, com o mesmo login do site. Quem é administrador está em
`/admins/{uid}` no banco — **não há como se promover pelo site**, e toda ação
é verificada no servidor, não só escondida na tela.

O painel tem quatro abas:

| Aba | O que dá para fazer |
| --- | --- |
| Assinantes | ver status e validade, liberar 30 dias na mão, cancelar a cobrança no Asaas, bloquear o acesso |
| Pedidos | ver o que foi vendido, com endereço de entrega, e marcar como enviado com código de rastreio |
| Produtos | criar, editar preço e descrição, tirar da loja sem apagar |
| Preço | mudar o valor da assinatura |
| Administradores | dar e tirar acesso ao painel |

**Preço e catálogo ficam no banco**, em `/config`. Antes estavam em variável de
ambiente e no código — mexer em preço exigiria republicar o servidor, o que não
faz sentido para uma decisão de negócio. As variáveis continuam valendo como
valor inicial.

Trocar o preço vale para **novas** assinaturas. Quem já assina segue no valor
contratado até a assinatura dele ser alterada no Asaas.

### Dar acesso a alguém

Pelo painel, aba **Administradores**: digite o e-mail da pessoa e pronto — ela
precisa já ter conta no GeoMax. O servidor traduz o e-mail para o código da
conta, o que exige a conta de serviço configurada; sem ela, use o código da
conta no lugar do e-mail.

Ninguém consegue remover a si mesmo, para o painel nunca ficar sem dono.

### Criar o primeiro administrador

Entre uma vez em `/admin.html` com a sua conta. A tela vai recusar e mostrar o
seu código. Com ele, grave no banco:

```
/admins/SEU-CODIGO = { "email": "voce@exemplo.com" }
```

Pelo console do Firebase, ou pelo terminal:

```bash
node -e "const c=require('./api/local.settings.json').Values;Object.entries(c).forEach(([k,v])=>process.env[k]=v);require('./api/compartilhado/firebase').gravar('admins/SEU-CODIGO',{email:'voce@exemplo.com'}).then(()=>console.log('pronto'))"
```

## Estrutura dos dados

`/assinaturas/{uid}`:

```json
{
  "status": "ativa",
  "validoAte": "2026-11-05",
  "plano": "mensal",
  "clienteAsaas": "cus_000001234567",
  "assinaturaAsaas": "sub_1234567890",
  "atualizadoEm": "2026-10-05 14:22:31"
}
```

`status`: `ativa`, `vencida`, `cancelada` ou `teste`.
`validoAte` é o que o app compara. Ao pagar, vira o vencimento da parcela mais
os dias de tolerância.

`/clientes/{clienteAsaas}` guarda o `uid`, porque o webhook do Asaas fala em
cliente, não em conta do Firebase.

`/eventos/{idDoEvento}` guarda os eventos já processados: o Asaas entrega o
mesmo evento mais de uma vez, e sem isso a assinatura seria estendida duas
vezes.

`/pedidos/{cobranca}` guarda a venda de equipamento com o endereço de entrega —
o Asaas sabe do dinheiro, não sabe para onde mandar a caixa.

`/config` guarda o preço da assinatura e o catálogo da loja, editáveis pelo
painel.

`/admins/{uid}` é a lista de quem entra no painel.

## Rodar na sua máquina

Há dois modos. O primeiro serve para mexer no visual e já funciona; o segundo
é para testar a cobrança de ponta a ponta.

### Modo 1 — só as páginas (não precisa instalar nada)

```bash
cd "site/public" && python -m http.server 8080
```

Abre em `http://localhost:8080`. Funciona: página inicial, criar conta, entrar,
recuperar senha, ver a assinatura e excluir a conta — tudo isso fala direto
com o Firebase, que já está no ar.

**Não funciona:** o botão "Gerar cobrança", porque ele chama `/api`, que não
existe neste modo. Aparece um erro na tela, e é esperado.

### Modo 2 — site e servidor juntos

Precisa das ferramentas da Azure, instaladas uma vez:

```bash
npm install -g @azure/static-web-apps-cli azure-functions-core-tools@4
```

Depois copie `api/local.settings.example.json` para `api/local.settings.json` e
preencha os valores — a chave do Asaas em sandbox e o JSON da conta de serviço
do Firebase. Esse arquivo está no `.gitignore` e nunca deve ser enviado.

```bash
cd site && swa start public --api-location api
```

Abre em `http://localhost:4280`, com `/api` respondendo.

**Atenção à versão do Node.** As ferramentas de função da Azure suportam as
versões LTS (hoje a 20 e a 22). Nesta máquina está instalado o Node 26, que o
host pode recusar. Se der erro de versão, instale o Node 20 pelo
[nvm-windows](https://github.com/coreybutler/nvm-windows) e use `nvm use 20`
só para rodar o site.

### Conferir tudo de uma vez

Três roteiros de teste, que rodam contra o banco de verdade e limpam o que
criam:

```bash
node api/testar-webhook.js    # pagamento confirmado libera o app
node api/testar-fluxo.js      # cliente, assinatura, cobrança e webhook no sandbox
node api/testar-admin.js      # o painel inteiro: preço, produtos, liberar, bloquear
```

### Testar o webhook sem o Asaas

Com o modo 2 rodando, dá para simular um pagamento confirmado:

```bash
curl -X POST http://localhost:7071/api/asaas-webhook   -H "Content-Type: application/json"   -H "asaas-access-token: O-MESMO-TOKEN-DO-local.settings.json"   -d '{"id":"evt_teste_1","event":"PAYMENT_CONFIRMED","payment":{"customer":"cus_TESTE","dueDate":"2026-10-30","subscription":"sub_TESTE","externalReference":"UID-DA-CONTA"}}'
```

Troque `UID-DA-CONTA` pelo código que aparece na tela de bloqueio do app.
Depois disso, o app libera na próxima verificação.

## O que ainda falta decidir

- **Preço mensal** e se haverá teste grátis (hoje o código aceita, basta gravar
  `status: "teste"` com uma validade).
- **Textos do site**: a página inicial está com o texto que eu escrevi a partir
  das nossas conversas; revise, principalmente o que promete alcance.
- **Política de privacidade e termos**: os arquivos estão prontos na estrutura,
  mas o conteúdo jurídico precisa da revisão de alguém da área antes de
  publicar. O que está lá descreve o que o app realmente coleta.
