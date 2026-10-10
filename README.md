# Winamp Remote para TIDAL

Una skin de **Winamp 2 real** (archivos `.wsz`, vía [Webamp](https://github.com/captbaritone/webamp)) que funciona como control remoto de la app de escritorio de **TIDAL**. Desde ahí manejás la reproducción, navegás tu biblioteca, ajustás el volumen de Windows y usás el ecualizador clásico de Winamp.

```
┌──────── Electron renderer ─────────┐     ┌──── Electron main ────┐     ┌──── Windows ────┐
│ Webamp + RemoteMedia (motor falso) │◄───►│ TIDAL API v2 (biblio) │     │ smtc-helper.exe │
│ Media Library (TIDAL)              │ IPC │ TidalPlayer ──────────┼────►│  · SMTC (TIDAL) │
│                                    │     │ Equalizer APO config  │     │  · volumen      │
└────────────────────────────────────┘     └───────────────────────┘     │  · loopback     │
                                                                         └─────────────────┘
```

## Qué hace cada parte del Winamp

| Winamp | Qué controla |
|---|---|
| Play / pausa / stop / anterior / siguiente / barra de posición | La app TIDAL, a través de los controles multimedia de Windows (SMTC) |
| Volumen | **El volumen general de Windows**, en los dos sentidos |
| Ecualizador (10 bandas + preamp, ON, presets) | **Equalizer APO**, a nivel sistema. Incluye compensación automática para que no sature |
| Visualizador (espectro / osciloscopio) | El audio real que está sonando (captura loopback del dispositivo de salida) |
| Display y playlist | El tema que suena en TIDAL. Doble click en la playlist reproduce ese tema |
| Eject (o la tecla `L`) | Abre o cierra la Media Library |

**Media Library:** temas favoritos, *Mixes para vos* (Daily, Discovery y New Releases), playlists, álbumes, artistas y búsqueda (temas, álbumes, artistas, playlists). Con el ♥ agregás o quitás temas de favoritos, también el que está sonando. Además están los botones *Reproducir*, *Aleatorio* y *Enviar al Winamp*.

## Requisitos

- Windows 10/11, Node 20+, .NET 8 SDK.
- App **TIDAL desktop** instalada y abierta.
- Opcional, para el ecualizador: [Equalizer APO](https://sourceforge.net/projects/equalizerapo/). Al instalarlo, marcá tu dispositivo de salida (parlantes o auriculares) y reiniciá si te lo pide.

## Configuración

1. Creá una app en <https://developer.tidal.com/dashboard>
   - Redirect URI: `https://lisandro46.github.io/winamp-remote-callback/`
     (TIDAL no acepta redirects `http`/`localhost`; esa página —repo público [winamp-remote-callback](https://github.com/Lisandro46/winamp-remote-callback)— reenvía el login a la app en `127.0.0.1:8889`. Es segura: el código no sirve sin el verificador PKCE, que nunca sale de tu PC)
   - Scopes: `user.read collection.read collection.write playlists.read search.read recommendations.read`
2. Copiá `.env.example` a `.env` y poné tu client ID. Con PKCE no hace falta ningún secret.

Sin client ID igual funcionan los controles, el volumen, el ecualizador y el visualizador. Solo falta la biblioteca.

## Uso

```bash
npm install
npm run dev     # compila el helper de Windows y abre la app
npm run dist    # instalador NSIS en dist/ (helper self-contained incluido)
```

- **Library**: abre la Media Library. Tocá *Conectar TIDAL* y el login se abre en el navegador.
- Doble click en un tema: la lista se carga en la playlist del Winamp, empieza a sonar y la app sigue con el próximo cuando termina.
- **Skin…**: carga cualquier `.wsz`. Hay miles en <https://skins.webamp.org>. También podés arrastrar el archivo sobre el Winamp.

## Notas y limitaciones

- La API de reproducción remota de TIDAL es solo interna. Por eso los temas se abren con links `tidal://track/<id>` y la app maneja su propia cola. Cuando termina un tema, TIDAL puede alcanzar a arrancar su radio un instante antes de que la app pase al siguiente.
- El ecualizador escribe `winamp-remote.txt` en la carpeta de configuración de Equalizer APO y agrega una línea `Include: winamp-remote.txt` a su `config.txt`. Afecta todo lo que suena por ese dispositivo.
- Con el **modo exclusivo** de TIDAL activado, TIDAL toma la placa de sonido directamente y se saltea Equalizer APO y la captura del visualizador.
- El balance de Winamp no tiene efecto.

## Estructura

```
src/main/tidal/      api.ts (biblioteca, favoritos, búsqueda) · player.ts (control, cola, deep links)
src/main/audio/      equalizer.ts (Equalizer APO)
src/main/smtc/       cliente del helper de Windows
src/main/auth/       OAuth PKCE + tokens cifrados (safeStorage) + ajustes
src/renderer/        Webamp + RemoteMedia + controller + Media Library
native/smtc-helper/  helper C# (.NET 8): SMTC, volumen del sistema y captura loopback (NAudio)
```
