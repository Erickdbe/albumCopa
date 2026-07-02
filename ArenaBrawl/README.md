# Arena Brawl

FPS multiplayer .io original de navegador — arcade, rapido e competitivo, com visual low-poly/cartoon proprio (sem assets ou nomes de jogos existentes).

Stack: **Node.js + Express + Socket.io** no servidor, **Three.js** puro no cliente (sem bundler, modulos ES carregados via `importmap`).

## Instalar

```bash
cd ArenaBrawl
npm install
```

## Rodar localmente

```bash
npm start
```

Acesse `http://localhost:3300`. A porta pode ser trocada com a variavel de ambiente `PORT`.

## Testar com mais de um jogador

Como e um FPS de navegador (sem login — so um nome de jogador), basta abrir a mesma URL em abas/janelas diferentes (ou em outro computador na mesma rede acessando `http://SEU_IP:3300`):

1. Aba 1: clique em "Jogar", escolha classe/mapa, clique em "Criar sala" — copie o codigo da sala.
2. Aba 2 (ou outro jogador): clique em "Jogar", escolha uma classe, digite o codigo da sala em "Codigo da sala" e clique em "Entrar" (ou clique direto na sala listada em "Salas abertas").
3. O host clica em "Iniciar partida".

## O que tem implementado

- **Lobby**: nome do jogador, escolha de classe (7), arma secundaria (5), mapa (3), tempo de partida, limite de pontos, modo (todos contra todos / time x time), velocidade de movimento, altura do pulo, granadas on/off, secundaria on/off, max. de jogadores.
- **Salas**: criar, entrar por codigo ou pela lista de salas abertas, lista de jogadores com classe escolhida, times sorteados automaticamente no modo Time x Time, host inicia a partida.
- **3 mapas proprios expandidos**: Praia com mar, ondas e tubaroes; Cidade com bairros e destruicao progressiva; Floresta montanhosa com arvores gigantes e casas nas copas.
- **Veiculos sincronizados**: carros, motos, quadriciclo, jetskis e avioes com vida, dano, explosao e atropelamento. Veiculos terrestres permitem usar a arma secundaria.
- **Canhao fixo**: dispara bolas de canhao ou lanca o proprio jogador pela arena.
- **Eventos mundiais**: tsunami nao letal na Praia e tornado ancestral na Floresta, ambos sincronizados para toda a sala.
- **7 classes** com arma principal e habilidade unica com cooldown: Sniper, Arqueiro, Besteiro, SMG, Fuzil, Metralhadora, Pistoleiro.
- **5 armas secundarias**: pistola, mini shotgun, revolver, faca (corpo a corpo), pistola automatica fraca.
- **4 granadas** (2 cargas por vida): explosiva, fumaca, flash, impacto.
- **Mecanicas**: movimento em 1a pessoa (WASD + mouse), pulo, corrida (Shift), agachar (Ctrl), mira, recuo visual, recarga (R), municao limitada, dano extra na cabeca, respawn, placar de kills/pontos, times coloridos, tela de fim de partida com resultado.

### Controles

- `WASD` mover/dirigir · Mouse mirar · Clique esquerdo atirar · Botao direito usar mira · `R` recarregar
- `1` / `2` arma principal / secundaria · `G` arremessar granada · `V` trocar tipo de granada · `Q` habilidade da classe
- `Shift` correr · `Ctrl` agachar/descer aviao · `Espaco` pular/subir aviao
- `E` entrar ou sair de veiculo · dentro do canhao, `Espaco` lanca o jogador

## Limitacoes conhecidas (proxima etapa)

- Personagens ainda usam animacao procedural simples; armas e veiculos usam modelos low-poly proprios construidos com Three.js.
- Flecha/virote (Arqueiro/Besteiro) e granadas resolvem o acerto no instante do disparo/detonacao no servidor; a trajetoria visual e cosmetica.
- Sem persistencia (sem XP, ranking, loja ou skins ainda) — os dados de partida existem apenas em memoria, por sala.

## Preparado para expandir

- `server/config.js` e `public/js/config.js` centralizam classes/armas/granadas/mapas — adicionar uma nova classe ou mapa é so acrescentar uma entrada nesses dois arquivos (e, para mapa novo, uma funcao `buildXxx()` em `public/js/maps.js`).
- Estrutura pronta para acoplar depois: conta de jogador + XP + ranking (precisa de um banco, hoje nao ha persistencia), skins de personagem/arma (troca de cor/textura no lugar da cor fixa atual), e loja (creditos ja podem ser modelados como um campo a mais no player).
