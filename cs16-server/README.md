# CS 1.6 dedicated web server

Place a legitimate `valve.zip` in this directory. The ZIP must contain:

```text
valve.zip
|- valve/
`- cstrike/
```

Start the WebRTC server with:

```powershell
docker compose -f docker-compose.cs16.yml up -d
```

The signaling service listens on TCP `27016` and the game server uses UDP
`27018` by default. Set `CS16_PUBLIC_IP` to the public server IP before hosting
outside the local network. Configure `CS16_WS_URL` in the Album server when the
WebSocket endpoint uses another host or a TLS reverse proxy.
