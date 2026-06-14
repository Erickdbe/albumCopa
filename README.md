# Album da Copa Online

Album de figurinhas com pacotes, creditos diarios, Head Soccer online e Mesa 21 online via Socket.io.

Os creditos diarios do album acumulam: a cada novo dia de acesso, o servidor soma +30 creditos de figurinhas.

## Rodar localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

## Deploy no Railway

Use o comando de start:

```bash
npm start
```

Variaveis recomendadas:

```bash
PORT=3000
JWT_SECRET=sua_chave_secreta
DATA_DIR=/data
```

O arquivo `db.json` e criado automaticamente pelo servidor. Ele guarda usuarios, figurinhas, creditos e historico, entao nao deve ir para o Git.

Para nao perder contas e figurinhas a cada deploy, configure um disco/volume persistente no provedor e aponte `DATA_DIR` para ele. O servidor salva `db.json` dentro dessa pasta. Se preferir, use `DB_FILE=/caminho/persistente/db.json` para definir o arquivo exato.

Localmente, o servidor tambem le `.env` automaticamente. Um exemplo seguro e `DB_FILE=../db.json`, deixando o banco fora da pasta do app.

Se a plataforma nao tiver armazenamento persistente, qualquer redeploy pode apagar o progresso. Nesse caso, use um volume persistente ou migre o armazenamento para um banco como Postgres.

## Arquivos principais

- `server.js`: servidor Express, auth, Socket.io, partidas e Mesa 21.
- `Album/index.html`: interface do album, pacotes e jogos.
- `assets/album-copa/figurinhas/`: imagens das figurinhas.
- `assets/album-copa/fundo-cifrao.jpg`: imagem de fundo do site.
- `hitboll.mp3` e `jump.mp3`: sons do jogo de futebol.
