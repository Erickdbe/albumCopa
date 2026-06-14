# Como rodar o servidor

## Primeira vez

```bash
cd C:\Users\erick.vieira\Desktop\PROJETOS
cd AlbumCopaOnline
npm install
```

## Rodar localmente

```bash
npm start
```

Depois acesse:

```text
http://localhost:3000
```

## Arquivos que devem ir para o Git

- `server.js`
- `package.json`
- `package-lock.json`
- `Album/index.html`
- `assets/album-copa/figurinhas/`
- `assets/album-copa/fundo-cifrao.jpg`
- `hitboll.mp3`
- `jump.mp3`
- `.gitignore`
- `.env.example`
- `db.example.json`
- `README.md`

## Arquivos que nao devem ir para o Git

- `node_modules/`
- `db.json`
- `.env`
- arquivos `.zip`
- instaladores `.msi`
- pastas e arquivos de outros projetos desta workspace

## Deploy no Railway

O Railway deve rodar:

```bash
npm start
```

Configure pelo painel do Railway:

```bash
JWT_SECRET=sua_chave_secreta
DATA_DIR=/data
```

O Railway define a porta pela variavel `PORT`, e o servidor ja usa essa variavel automaticamente.

Importante: `DATA_DIR` precisa apontar para um disco/volume persistente do provedor. Se for uma pasta temporaria do deploy, as contas e figurinhas vao sumir quando o app for recriado.

## Banco de dados

O servidor usa `db.json` como armazenamento simples. Se o arquivo nao existir, ele e criado automaticamente.

Esse arquivo contem usuarios, senhas criptografadas, creditos, figurinhas e historico de partidas. Por isso ele fica no `.gitignore`.

Por padrao, sem configurar nada, ele fica em:

```text
AlbumCopaOnline/db.json
```

Para nao perder os dados quando subir mudancas no Git/deploy, coloque o banco fora da pasta do codigo ou em um volume persistente:

No local, este projeto ja pode usar um `.env` com:

```env
DB_FILE=../db.json
```

Esse `.env` nao deve ir para o Git.

```powershell
$env:DATA_DIR="C:\Users\erick.vieira\Desktop\album-copa-data"
npm start
```

Ou escolha o arquivo exato:

```powershell
$env:DB_FILE="C:\Users\erick.vieira\Desktop\album-copa-data\db.json"
npm start
```

Se voce ja tiver um `db.json` com contas antigas, copie esse arquivo uma vez para o novo caminho persistente antes de iniciar o servidor com `DATA_DIR` ou `DB_FILE`.
