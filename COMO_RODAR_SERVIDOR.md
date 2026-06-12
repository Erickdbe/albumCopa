# Como rodar o servidor

## Primeira vez

```bash
cd C:\Users\erick.vieira\Desktop\PROJETOS
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
```

O Railway define a porta pela variavel `PORT`, e o servidor ja usa essa variavel automaticamente.

## Banco de dados

O servidor usa `db.json` como armazenamento simples. Se o arquivo nao existir, ele e criado automaticamente.

Esse arquivo contem usuarios, senhas criptografadas, creditos, figurinhas e historico de partidas. Por isso ele fica no `.gitignore`.
