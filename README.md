# Winamp Remote (winamp-tidal)

Una skin de **Winamp 2 real** (archivos `.wsz`, vía [Webamp](https://github.com/captbaritone/webamp)) que funciona como control remoto de **Spotify** y **TIDAL**: elegís el servicio, navegás tu biblioteca y usás los botones del Winamp para manejar la música.

```
┌──────── Electron renderer ─────────┐   ┌──── Electron main ────┐   ┌─ Windows ─┐
│ Webamp + RemoteMedia (motor falso) │◄─►│ Spotify  (Web API)    │   │           │
│ Media Library (proveedor/biblio)   │IPC│ TIDAL    (API v2) ────┼──►│ smtc-     │
└────────────────────────────────────┘   │ Sistema  (SMTC) ──────┼──►│ helper.exe│
                                         └───────────────────────┘   └───────────┘
```

## Cómo funciona

- **El audio lo emite la app oficial** (Spotify o TIDAL). La skin muestra título, tiempo, estado y portada, y manda los comandos. Así no hay problemas de DRM.
- **Spotify**: biblioteca y controles a través de la Web API (Spotify Connect). Funciona con cualquier dispositivo Spotify abierto: PC, celular o parlante.
- **TIDAL**: la biblioteca viene de la API oficial v2. La API de reproducción remota de TIDAL es solo interna, así que la app reproduce con links `tidal://track/<id>` en TIDAL desktop. Los controles van por los controles multimedia de Windows (SMTC), a través de `native/smtc-helper`.
- **Sistema**: controla cualquier reproductor activo de Windows, sin biblioteca. Sirve para usar Spotify sin Premium, el navegador u otros reproductores.

## Requisitos

- Windows 10/11, Node 20+, .NET 8 SDK.
- **Spotify**: cuenta **Premium**. Desde febrero de 2026, las apps en modo desarrollo lo exigen y además los controles de reproducción solo funcionan con Premium.
- **TIDAL**: app TIDAL desktop instalada y abierta.

## Configuración

1. **Spotify**: creá una app en <https://developer.spotify.com/dashboard>
   - Redirect URI: `http://127.0.0.1:8888/callback`
   - API: *Web API*
2. **TIDAL**: creá una app en <https://developer.tidal.com/dashboard>
   - Redirect URI: `http://127.0.0.1:8889/callback`
   - Scopes: `user.read collection.read playlists.read search.read`
3. Copiá `.env.example` a `.env` y completá los client IDs. Con PKCE no hace falta ningún secret.

## Uso

```bash
npm install
npm run dev     # compila el helper de Windows y abre la app con hot reload
npm run dist    # instalador NSIS en dist/ (helper self-contained incluido)
```

- **Library** (o el botón *eject* del Winamp, o la tecla `L`): abre la Media Library.
- Elegí la pestaña **Spotify / TIDAL / Sistema** y tocá *Conectar*. El login se abre en tu navegador.
- Doble click en un tema: se carga la lista en la playlist de Winamp y empieza a sonar.
- Play / pausa / stop / anterior / siguiente / barra de posición / volumen (solo Spotify) funcionan desde la skin.
- **Skin…**: carga cualquier `.wsz`. Hay miles en <https://skins.webamp.org>. También podés arrastrar el archivo sobre el Winamp.

## Limitaciones conocidas

- **Spotify**: solo se pueden listar los temas de playlists propias o colaborativas. Las playlists que seguís se pueden reproducir, pero no listar. La búsqueda trae hasta 30 resultados.
- **TIDAL**: Windows no expone el volumen de TIDAL. Para avanzar por la lista, la app abre el siguiente tema cuando termina el actual, y TIDAL puede alcanzar a arrancar su radio un instante antes.
- El ecualizador y el balance de Winamp son decorativos, y el visualizador es simulado: la app no tiene acceso al audio real.

## Estructura

```
src/main/        proceso principal: OAuth PKCE, tokens cifrados (safeStorage), proveedores, IPC
src/preload/     API `window.remote` (contextBridge)
src/renderer/    Webamp + RemoteMedia + controller + Media Library
src/shared/      tipos compartidos
native/smtc-helper/  helper C# (.NET 8) para los controles multimedia de Windows
```
