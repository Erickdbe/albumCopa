# Arena Brawl Unity

Unity prototype for rebuilding Arena Brawl with a richer low-poly world.

## Como usar

1. Abra esta pasta pelo Unity Hub: `ArenaBrawlUnity`.
2. Deixe o Unity importar os pacotes.
3. No menu do editor, rode `Arena Brawl > Build Low Poly World`.
4. Abra a cena gerada em `Assets/ArenaBrawlUnity/Scenes/ArenaBrawlWorld.unity`.
5. Aperte Play.

Controles do preview:

- `WASD`: mover
- `Mouse`: olhar
- `Shift`: correr
- `Space`: pular
- `V`: alternar terceira/primeira pessoa
- `Esc`: soltar mouse

## Easy Poly Map Creator

O pacote **Easy Poly Map Creator--Custom your LowPoly world** ainda nao esta dentro do workspace. Importe ele pelo Package Manager/Asset Store ou coloque o `.unitypackage` dentro do projeto e depois rode o gerador novamente.

O mundo gerado ja vem separado por zonas, colliders, spawns e nomes de objetos. Isso facilita trocar os blocos gerados por prefabs do Easy Poly, KayKit ou Kenney sem mexer na logica principal.
