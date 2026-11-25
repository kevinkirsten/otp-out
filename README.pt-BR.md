# otp-out

[English](README.md)

O `otp-out` lê o QR que o Google Authenticator mostra quando você exporta as
contas e transforma esse QR em uma URI `otpauth://` padrão para cada conta.
Você cadastra essas URIs no 1Password, no Bitwarden, no Aegis, no 2FAS, no
KeePassXC ou em qualquer outro autenticador.

```
$ otp-out print.png
otpauth://totp/Exemplo:ana@exemplo.com?secret=JBSWY3DPEHPK3PXP&issuer=Exemplo&algorithm=SHA1&digits=6&period=30
```

O QR de exportação guarda um link `otpauth-migration://offline?data=...`. Esse
link está num formato (protobuf) que os outros apps não leem. O `otp-out` lê o
QR de um print ou de uma foto, ou recebe o link direto, decodifica e mostra as
contas. É um programa pequeno, sem dependências, que funciona sem internet e
nunca grava os seus segredos em disco.

Também existe uma página que faz o mesmo no navegador, sem mandar nada para
lugar nenhum: <https://kevinkirsten.github.io/otp-out/>.

## Como exportar o QR no Google Authenticator

1. No Google Authenticator, abra o menu e escolha **Transfer accounts ›
   Export accounts**.
2. Selecione as contas e toque em **Next**. O app mostra um QR, ou vários
   ("1 of 3") quando há muitas contas.
3. Guarde cada QR:
   - **iPhone:** tire um print de cada um.
   - **Android:** o app bloqueia print nessa tela. Fotografe a tela com outro
     celular ou com a câmera do computador. Outra opção é ler o QR com um app
     leitor de QR, copiar o link e colar no `otp-out` (veja "Colar o link"
     abaixo).
4. Passe todas as imagens para o `otp-out` de uma vez. Ele avisa se faltar uma
   parte de uma exportação com vários QRs.

O print dá acesso total às suas contas. Apague o print quando terminar (veja
[Segurança](#segurança)).

## Instalação

| Jeito | Comando |
| --- | --- |
| Homebrew (macOS, Linux) | `brew install kevinkirsten/tap/otp-out` |
| winget (Windows) | `winget install KevinKirsten.otp-out` |
| npm, sem instalar | `npx otp-out print.png` |
| pnpm, sem instalar | `pnpm dlx otp-out print.png` |
| Go, sem instalar | `go run github.com/kevinkirsten/otp-out@latest print.png` |
| Binário | baixe em [Releases](https://github.com/kevinkirsten/otp-out/releases) |
| Página web | <https://kevinkirsten.github.io/otp-out/> |

Todos rodam o mesmo programa, com as mesmas opções.

**O npx e o pnpm dlx** baixam a versão mais nova a cada uso. Para rodar sempre
uma versão que você já conferiu, fixe a versão: `npx otp-out@0.1.0` ou
`pnpm dlx otp-out@0.1.0`. O pacote do npm não tem script de instalação. Ele só
tem um lançador pequeno e o binário do seu sistema, publicados pelo GitHub
Actions com a procedência (provenance) do npm.

**Os binários do Releases** não têm assinatura de código, porque a assinatura
custa uma anuidade. Confira o arquivo baixado com o `checksums.txt` do mesmo
release:

```
shasum -a 256 -c checksums.txt --ignore-missing
```

- **macOS:** o arquivo baixado pelo navegador ganha uma marca de quarentena, e
  o Gatekeeper diz que não consegue verificar o desenvolvedor. Você tem dois
  caminhos. No Terminal, tire a marca com
  `xattr -d com.apple.quarantine ./otp-out`. Ou tente abrir uma vez e depois
  clique em **Open Anyway** em *System Settings › Privacy & Security*. A
  instalação pelo Homebrew não recebe essa marca.
- **Windows:** o SmartScreen pode mostrar "Windows protected your PC". Clique
  em **More info › Run anyway**. Outra opção é desbloquear o arquivo no
  PowerShell com `Unblock-File .\otp-out.exe`. A instalação pelo winget não
  passa por isso.

## Como usar

```
otp-out [opção] <imagem>...   lê os QRs de exportação de prints ou fotos
otp-out [opção]               pede o link colado, sem mostrar na tela
otp-out [opção] -             lê o link do stdin
otp-out [opção] <link>        link como argumento (fica no histórico do shell)
```

As imagens podem ser PNG, JPEG, WEBP, GIF ou HEIC. O formato é detectado pelo
conteúdo do arquivo, não pelo nome. O QR pode ocupar só uma parte do print, e
uma imagem pode ter mais de um QR.

### Mostrar as URIs (padrão)

```
otp-out print.png
otp-out parte1.png parte2.png parte3.png
```

Uma URI `otpauth://` inteira por linha no stdout. As mensagens vão para o
stderr, então você pode mandar a saída para um pipe.

### Conferir o que tem na exportação: `--dry-run`

```
$ otp-out --dry-run print.png
2 account(s) in the export:
Exemplo / ana@exemplo.com (TOTP)
Outra / bia@exemplo.com (HOTP)
```

Só o emissor e o nome da conta. Nunca o segredo.

### Copiar uma conta por vez: `--clipboard`

```
otp-out --clipboard print.png
```

Cada URI vai para o clipboard, uma conta por vez, e nada aparece na tela. Cole
no seu app (no 1Password: *Edit › + Add More › One-Time Password*) e aperte
Enter. Aí a conta seguinte é copiada. No fim, o clipboard é esvaziado. Isso
também acontece se você apertar Ctrl+C ou se der erro.

### Só os segredos: `--secrets`

```
otp-out --secrets print.png
```

Um segredo em base32 por linha, para os apps que pedem a chave em vez da URI.

### JSON: `--json`

```
otp-out --json print.png
```

```json
[
  {
    "issuer": "Exemplo",
    "name": "ana@exemplo.com",
    "type": "totp",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 30,
    "secret": "JBSWY3DPEHPK3PXP",
    "uri": "otpauth://totp/Exemplo:ana@exemplo.com?secret=JBSWY3DPEHPK3PXP&issuer=Exemplo&algorithm=SHA1&digits=6&period=30"
  }
]
```

As contas HOTP têm `counter` no lugar de `period`.

### Gravar no 1Password: `--op`

```
otp-out --op print.png
```

Usa o [CLI do 1Password](https://developer.1password.com/docs/cli/) (`op`),
com o app do 1Password aberto e destravado. Para cada conta, o `otp-out` lista
os itens parecidos e pergunta onde gravar a senha de uso único: num desses
itens, num item novo do tipo Login, ou em lugar nenhum. Antes de trocar uma
senha de uso único que já existe, ele pergunta. O `op` nem sempre consegue
editar itens com login pelo Google ou por outro provedor (`ssoLogin`). Quando
isso acontecer, use `--clipboard` e cole o código no app do 1Password.

### Colar o link

Se você já tem o link `otpauth-migration://` (copiado de um app leitor de QR,
por exemplo), rode o `otp-out` sem argumentos e cole o link. O texto não
aparece na tela e não vai para o histórico do shell. Você também pode mandar o
link por um pipe:

```
pbpaste | otp-out -            # macOS
Get-Clipboard | otp-out -      # PowerShell no Windows
wl-paste | otp-out -           # Linux com Wayland
```

### Códigos de saída

`0` deu certo, `1` erro, `2` uso errado das opções, `3` alguma conta foi
pulada, `130` interrompido. As contas com MD5 são puladas. O formato de
exportação aceita MD5, mas o 1Password, o Bitwarden e a maioria dos apps não
aceitam. O `otp-out` avisa no stderr o emissor e o nome dessas contas, mostra
as outras e termina com o código `3`.

## Segurança

O que o `otp-out` nunca faz:

- Não faz nenhuma conexão de rede.
- Não grava segredo em arquivo, em log nem em arquivo temporário. A imagem é
  lida na memória. Os segredos só existem na memória e na saída que você pediu.
- Mensagem de erro nunca tem dado do QR. Um erro inesperado mostra só o tipo
  do erro.
- Não passa segredo como argumento de outro programa, porque outros processos
  conseguem ler os argumentos. As ferramentas de clipboard recebem o texto pela
  entrada padrão. A única exceção é o `--op`. O CLI do 1Password só aceita o
  valor de um campo como argumento (ou num arquivo de modelo), então a URI é
  argumento do `op` durante o segundo em que ele roda. As mensagens do `op`
  passam por um filtro antes de aparecer na tela.
- Não apaga nem altera as suas imagens.

O que você precisa saber:

- **A saída tem os segredos.** A saída padrão, o `--secrets` e o `--json`
  mostram os segredos no terminal, e eles ficam no histórico de rolagem.
  Prefira o `--clipboard`, ou mande a saída direto para o destino por um pipe.
  Se você gravar num arquivo, apague o arquivo depois.
- **Histórico do shell.** Um link passado como argumento
  (`otp-out 'otpauth-migration://...'`) fica gravado no histórico do shell.
  Rode o `otp-out` sem argumentos e cole o link, ou mande o link pelo `-`.
- **Histórico do clipboard.** Gerenciadores de clipboard podem guardar o que
  foi copiado. O `otp-out --clipboard` marca o conteúdo como sigiloso onde o
  sistema permite isso sem bibliotecas extras:
  - macOS: as marcas `org.nspasteboard.ConcealedType` e `TransientType`, que a
    maioria dos gerenciadores de clipboard respeita, e a opção "só neste
    computador", para o Universal Clipboard não mandar o conteúdo para os seus
    outros aparelhos da Apple.
  - Windows: os formatos que pedem ao Windows para deixar o conteúdo fora do
    histórico do clipboard (Win+V), da sincronização na nuvem e dos monitores
    de clipboard. Isso é feito pelo PowerShell. Se falhar, o `clip.exe` é
    usado sem essas marcas.
  - Linux: sem marca, porque cada gerenciador de clipboard tem a sua
    convenção. Pause o seu gerenciador de clipboard enquanto copia.
  Se não der para marcar, o `otp-out` avisa na tela.
- **O npx e o pnpm dlx** baixam e rodam a versão mais nova publicada a cada
  uso. Fixe a versão (`npx otp-out@0.1.0`) ou instale pelo Homebrew ou pelo
  winget.
- **Apague o print** quando terminar, no computador e no celular. Isso inclui
  o álbum "Recently Deleted" e o backup de fotos na nuvem (iCloud Photos,
  Google Photos).
- Depois de levar as contas para outro app, só remova as contas do Google
  Authenticator quando tiver conferido que o app novo gera os mesmos códigos.

Achou um problema de segurança? Veja o [SECURITY.md](SECURITY.md).

## Projetos parecidos

| Projeto | O que faz | Comparado com o otp-out |
| --- | --- | --- |
| [scito/extract_otp_secrets](https://github.com/scito/extract_otp_secrets) | Python, GPL-3. O mais completo: lê imagem e câmera, exporta JSON, CSV, imagens de QR e mais. | Tem mais formatos de saída e lê da câmera. Precisa de Python com zbar ou OpenCV, ou de um executável baixado à mão. Não tem pacote no Homebrew nem no winget, nem modo clipboard, nem 1Password. |
| [dim13/otpauth](https://github.com/dim13/otpauth) | Go, ISC. Converte o link de migração em URIs, gera QR e serve os QRs num servidor local. | Não lê imagem. Você precisa de outro programa para tirar o link do QR antes. |
| [Heimlane/ga-decoder](https://github.com/Heimlane/ga-decoder) | Página web, MIT. Upload ou câmera, um QR por conta, JSON e CSV. | Só no navegador. O otp-out tem a página dele e um CLI com gerenciadores de pacotes. |

O `otp-out` não gera um QR por conta nem exporta CSV. Se você precisa disso,
use um dos projetos acima.

## Desenvolvimento

Você precisa do Go (a versão do `go.mod`). O Node e o pnpm só servem para os
scripts de empacotamento e para a página em `web/`.

```
go test ./...                              # todos os testes
go test -race ./...                        # com o detector de corrida
go test -tags nodynamic,wasm2go ./...      # com as tags do release
pnpm run otp-out -- --dry-run print.png    # compila e roda a sua cópia local
go build -o otp-out .                      # binário local
```

Onde fica cada parte:

- `main.go`: o comando. Fica na raiz do repositório para o
  `go run github.com/kevinkirsten/otp-out@latest` funcionar.
- `internal/migration`: decodificador do protobuf da exportação escrito à mão,
  URIs `otpauth://` e exportações com vários QRs.
- `internal/qrimage`: leitura da imagem (formato pelo conteúdo) e do QR com o
  [gozxing](https://github.com/makiuchi-d/gozxing), com várias estratégias
  para QR pequeno ou cortado.
- `internal/clipboard`, `internal/terminal`, `internal/onepassword`,
  `internal/cli`.
- `testdata/vectors.json`: casos de teste compartilhados com a página web.
  Todos os segredos nele são falsos.

Tags de build:

- `nodynamic,wasm2go` (usadas no release): o HEIC é lido pelo
  [gen2brain/heic](https://github.com/gen2brain/heic) convertido para Go, sem
  tentar carregar a `libheif` do sistema. O `go run ...@latest` usa o padrão
  da biblioteca: carrega a `libheif` se ela estiver instalada, e senão roda o
  decodificador em WebAssembly com o wazero.
- `noheic`: deixa o HEIC de fora (o binário fica uns 3 MB menor).

Os testes só usam segredos falsos (`JBSWY3DPEHPK3PXP`, `GEZDGNBVGY3TQOJQ` e os
do `testdata/vectors.json`) e QRs sintéticos gerados dentro dos próprios
testes. Eles nunca chamam o `op` de verdade nem mexem no seu clipboard (o teste
do macOS grava num pasteboard privado, com nome próprio). Nunca coloque um QR
ou segredo de verdade neste repositório. O CI roda o `gitleaks` com o
`.gitleaks.toml`.

### Release

Uma tag `v*` dispara o `.github/workflows/release.yml`. O GoReleaser compila os
binários e cria o release. Depois o workflow atualiza a fórmula do Homebrew no
`kevinkirsten/homebrew-tap` (a partir do `packaging/homebrew/otp-out.rb.tmpl`),
publica os pacotes do npm (montados pelo `packaging/npm/build.mjs`) com o
Trusted Publishing do npm, e anexa ao release os manifestos do winget (de
`packaging/winget/`, preenchidos pelo `packaging/fill.mjs`). O PR para o
`microsoft/winget-pkgs` é aberto à mão.

## Licença

[MIT](LICENSE), Kevin Kirsten.
