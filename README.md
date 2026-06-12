# Album da Copa Online

Album de figurinhas com pacotes, creditos diarios, Head Soccer online e Mesa 21 online via Socket.io.

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
```

O arquivo `db.json` e criado automaticamente pelo servidor. Ele guarda usuarios, figurinhas, creditos e historico, entao nao deve ir para o Git.

## Arquivos principais

- `server.js`: servidor Express, auth, Socket.io, partidas e Mesa 21.
- `Album/index.html`: interface do album, pacotes e jogos.
- `assets/album-copa/figurinhas/`: imagens das figurinhas.
- `hitboll.mp3` e `jump.mp3`: sons do jogo de futebol.
