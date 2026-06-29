# Counter-Strike 1.6 browser launcher

This page runs the WebAssembly port of Xash3D FWGS and CS16Client.

On localhost it first tries to load `../cs16-server/valve.zip` automatically.
That ZIP must contain both `valve` and `cstrike` from a legitimate
Counter-Strike installation. If the file is missing, the player can select a
local folder or ZIP manually. A valid manual selection is cached in IndexedDB,
so the next visit opens directly from the browser cache.

The archive `cs16-client-main.zip` contains native client source code. It is a
reference for the client, but it does not contain the proprietary game data or
a browser-ready build.

Runtime packages:

- `xash3d-fwgs@1.2.2`
- `cs16-client@0.1.2`
- `jszip@3.10.1`

Online rooms are coordinated by the Album Socket.io server. The browser then
uses WebRTC to join the dedicated Xash3D server configured with `CS16_WS_URL`.
