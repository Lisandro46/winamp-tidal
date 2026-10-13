# Winamp Remote para TIDAL y YouTube Music

**🇦🇷 Español** · [🇺🇸 English](#english)

Un **Winamp 2 de verdad** (con skins `.wsz`, vía [Webamp](https://github.com/captbaritone/webamp)) para escuchar **TIDAL** o **YouTube Music**: play, pausa, playlist, volumen, el ecualizador clásico de 10 bandas, el visualizador y **Milkdrop**, todo sobre lo que está sonando.

> Proyecto de fan, gratis y de código abierto. No está afiliado a TIDAL, YouTube ni Winamp.

## Descargar e instalar (2 minutos)

1. Andá a **[Releases](https://github.com/Lisandro46/winamp-tidal/releases/latest)** y bajá uno de estos:
   - `Winamp-Remote-Setup.exe` → instalador (recomendado; crea acceso directo).
   - `Winamp-Remote-Portable.exe` → sin instalar, lo abrís y listo.
2. Abrilo. Windows puede mostrar **"Windows protegió su PC"** porque la app no está firmada (un certificado cuesta cientos de dólares por año). Tocá **Más información → Ejecutar de todas formas**. El código es público y el instalador lo arma GitHub directamente desde este repo.
3. La primera vez te pregunta **qué servicio usás**. Lo podés cambiar cuando quieras con el botón del servicio (**TIDAL…** / **YouTube Music…**) de la Media Library.

| Servicio | Cómo suena | Qué necesitás |
|---|---|---|
| **YouTube Music** | Dentro del mismo Winamp, sin otra app | Nada para buscar y escuchar. Iniciá sesión para ver tu biblioteca |
| **TIDAL** | El Winamp maneja la app de escritorio de TIDAL | La app de TIDAL abierta. Para buscar desde el Winamp, una app gratis de desarrollador (ver abajo) |

### YouTube Music

- **Sin cuenta:** buscá con `J` o **+ Agregar desde YouTube Music** cualquier tema, disco, artista o playlist y reproducilo. Hay anuncios, igual que en la web.
- **Con tu cuenta:** aparecen tus favoritos, playlists, álbumes, artistas y mixes (**Mi supermix** y los demás). Con YouTube Premium, sin anuncios. Hay dos formas de conectarla:
  1. **Iniciar sesión con Google**, en una ventana de Google dentro de la app.
  2. **Usar la sesión de mi navegador**, si Google te pide una llave de acceso (passkey) o no te deja entrar en esa ventana:
     1. En Chrome o Edge abrí <https://music.youtube.com> con tu cuenta iniciada.
     2. Apretá `F12`, andá a la pestaña **Red** (Network) y recargá con `F5`.
     3. Filtrá por `browse` y hacé clic en el primer resultado.
     4. En **Encabezados de solicitud** buscá `cookie`, hacé clic derecho y elegí **Copiar valor**.
     5. Pegalo en el Winamp y tocá **Conectar**.

     Es tu sesión de YouTube: queda solo en tu PC. **No la compartas con nadie**, porque con ella se puede entrar a tu cuenta.

### TIDAL

1. Abrí la **app de TIDAL** y poné un tema. El Winamp ya lo controla.
2. Elegí el modo:

| Modo | Qué hacés | Configuración |
|---|---|---|
| **Solo control remoto** | Elegís la música en TIDAL y la manejás desde el Winamp | Ninguna |
| **Control remoto + buscar en TIDAL** | Además buscás temas, discos, artistas y playlists públicas desde el Winamp y armás tu playlist | Crear gratis una app en TIDAL (≈3 min) |

Para activar **buscar en TIDAL**:

1. Entrá a <https://developer.tidal.com/dashboard> e iniciá sesión con tu cuenta de TIDAL.
2. Creá una app nueva (**Create app**). El nombre no importa, por ejemplo "Winamp Remote".
3. Copiá el **Client ID** y el **Client Secret** de esa app.
4. En el Winamp tocá **TIDAL…**, elegí **TIDAL → Control remoto + buscar en TIDAL**, pegá los datos y tocá **Probar y guardar**.

Quedan guardados cifrados en tu PC (DPAPI de Windows). Cada usuario crea su propia app porque TIDAL no permite repartir esas claves dentro de un programa público.

### Skins

El botón **Skins…** abre el selector:

- **Destacados:** Pioneer de autoestéreo, Green Dimension, XMMS Green y otros clásicos.
- **Buscador del [Winamp Skin Museum](https://skins.webamp.org):** unos 70.000 skins clásicos. Por ejemplo, buscá "kenwood", "matrix" o "alpine".
- **Desde archivo…:** cualquier `.wsz` tuyo.

Cada skin se descarga una sola vez y después anda sin internet.

### Milkdrop

El botón **Milkdrop** muestra u oculta el visualizador clásico, con cientos de presets. Con **doble clic** pasa a **pantalla completa** en el monitor donde está la ventana. Ahí:

- `Espacio` o `→` pasa al preset siguiente y `←` vuelve al anterior;
- `R` activa o desactiva el cambio automático de preset;
- `Esc` o doble clic sale de la pantalla completa.

### Ecualizador (opcional)

El ecualizador del Winamp ecualiza el sonido de **todo Windows** usando [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) (gratis). Instalalo, marcá tu dispositivo de salida (parlantes o auriculares) y reiniciá si te lo pide. Sin Equalizer APO todo lo demás funciona igual.

## Qué hace y qué no (alcance)

| Winamp | Qué controla |
|---|---|
| Play / pausa / stop / anterior / siguiente / barra de posición | YouTube Music dentro de la app, o la app de TIDAL por los controles multimedia de Windows |
| Volumen | El volumen general de Windows (en los dos sentidos) |
| Ecualizador (10 bandas + preamp, presets) | Equalizer APO, a nivel sistema, con compensación para que no sature |
| Visualizador y Milkdrop | El audio real que está sonando |
| Playlist | Tu cola: lo que agregás desde la Media Library o la búsqueda |

**Atajos:**

- `L` o el botón eject abre la Media Library.
- `J` busca música.
- `Ctrl +`, `Ctrl −` y `Ctrl 0` cambian el tamaño de todo.

**Limitaciones:**

- Solo **Windows 10/11 (64 bits)**.
- **YouTube Music no tiene API oficial.** La app usa la web de YouTube Music y su API interna. Si YouTube las cambia, algo puede dejar de andar hasta que se actualice la app.
- **TIDAL necesita la app de escritorio abierta.** El sonido sale de TIDAL; con ese servicio esto es un control remoto.
- **Tus favoritos, mixes y playlists de TIDAL** todavía no aparecen, porque TIDAL aún no habilitó el login de apps de terceros ([pedido abierto](https://github.com/orgs/tidal-music/discussions/415)).
- Al reproducir un tema de TIDAL desde el Winamp, TIDAL arranca su disco y la app avanza hasta ese tema. Tarda unos segundos y puede escucharse un instante de los temas anteriores.
- Con el **modo exclusivo** de TIDAL activado, el ecualizador y el visualizador no reciben el audio.
- El balance de Winamp no tiene efecto.

## Problemas comunes

- **YouTube Music: "Este navegador o app puede no ser seguro" o "Usá tu llave de acceso":** usá **Usar la sesión de mi navegador…** (ver arriba).
- **TIDAL: el Winamp no reacciona.** Fijate que la app de TIDAL esté abierta y sonando algo.
- **"TIDAL no aceptó ese Client ID / Client Secret":** copialos de nuevo desde el dashboard, sin espacios.
- **El ecualizador no cambia nada:** reinstalá Equalizer APO marcando el dispositivo que estás usando y reiniciá.
- **Desinstalar:** desde *Configuración → Aplicaciones* como cualquier programa.

¿Otro problema? Abrí un [issue](https://github.com/Lisandro46/winamp-tidal/issues).

---

<a id="english"></a>

## English

A **real Winamp 2** (with `.wsz` skins, via [Webamp](https://github.com/captbaritone/webamp)) for **TIDAL** or **YouTube Music**. It covers play/pause, the playlist, volume, the classic 10-band equalizer, the visualizer and **Milkdrop**. Fan project, free and open source, not affiliated with TIDAL, YouTube or Winamp.

### Install

1. Download the latest `Winamp-Remote-Setup.exe` (installer) or `Winamp-Remote-Portable.exe` from **[Releases](https://github.com/Lisandro46/winamp-tidal/releases/latest)**.
2. If Windows shows *"Windows protected your PC"* (the app isn't code-signed), click **More info → Run anyway**. The installer is built by GitHub Actions straight from this repo.
3. On first run, pick a service. You can switch later with the service button in the Media Library.

**YouTube Music:**
- It plays inside the app, with no other app needed. Search and play without an account (with ads).
- Sign in to see your liked songs, playlists, albums, artists and mixes. YouTube Premium means no ads.
- If Google refuses the in-app sign-in (passkey-only accounts, "this browser may not be secure"), use **Usar la sesión de mi navegador** (use my browser's session):
  1. Open music.youtube.com in Chrome or Edge while signed in.
  2. Press F12 and open the Network tab, then reload the page.
  3. Open a `browse` request.
  4. Copy the value of its `cookie` request header.
  5. Paste it into the dialog in Winamp.

  It stays on your PC; never share it with anyone.

**TIDAL:**
- Winamp remote-controls the TIDAL desktop app, which must be running.
- Remote control alone needs no setup.
- To search TIDAL from Winamp:
  1. Create a free app at <https://developer.tidal.com/dashboard>.
  2. Copy its **Client ID** and **Client Secret**.
  3. Paste them into the dialog and click **Probar y guardar** (test & save).

  They're stored encrypted on your PC.

**Extras:**
- **Skins…:** featured skins, a search of the [Winamp Skin Museum](https://skins.webamp.org) (about 70,000 skins), or your own `.wsz`.
- **Milkdrop:** double-click it to go full screen on its monitor.
- Optional: install [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) for the system-wide equalizer.

### Scope and limitations

- **Windows 10/11 64-bit** only. The UI is in Spanish.
- YouTube Music has no official API. The app relies on its web player and internal API, which YouTube may change at any time.
- Your TIDAL favorites, mixes and playlists need TIDAL to approve user login for third-party apps ([request](https://github.com/orgs/tidal-music/discussions/415)).
- Playing a TIDAL track from Winamp starts its album in TIDAL and skips ahead to it, which takes a few seconds.
- TIDAL's exclusive mode bypasses the equalizer and visualizer.

---

## Para desarrolladores / For developers

```
┌──────── Electron renderer ─────────┐     ┌──────── Electron main ─────────┐     ┌──── Windows ────┐
│ Webamp + RemoteMedia (motor falso) │◄───►│ MusicProvider                  │     │ smtc-helper.exe │
│ Milkdrop (Butterchurn)             │ IPC │  · TIDAL: API v2 + TidalPlayer ┼────►│  · SMTC (TIDAL) │
│ Media Library · búsqueda · skins   │     │  · YouTube Music: ventana      │     │  · volumen      │
└────────────────────────────────────┘     │    oculta + InnerTube          │     │  · loopback     │
                                           │ skin:// (Skin Museum, caché)   │     └─────────────────┘
                                           │ Equalizer APO config           │
                                           └────────────────────────────────┘
```

Requisitos: Windows 10/11, Node 20+, .NET 8 SDK.

```bash
npm install
npm run dev     # compila el helper de Windows y abre la app
npm run dist    # instalador + portable en dist/ (helper self-contained incluido)
```

- **Proveedores:** `src/main/providers/types.ts` define `MusicProvider`. `ipc.ts` le pasa todas las llamadas del renderer al servicio elegido (`settings.provider`).
- **YouTube Music:**
  - **Reproducción:** music.youtube.com se carga en una `BrowserWindow` oculta (partición `persist:ytmusic`) y se maneja con su `#movie_player` (`loadVideoById`, `seekTo`…). La cola la lleva la app.
  - **Catálogo y biblioteca:** salen de InnerTube con [youtubei.js](https://github.com/LuanRT/YouTube.js), usando las cookies de esa partición.
  - **Login:** Google bloquea los navegadores embebidos, así que la ventana de login se presenta como Firefox. Como alternativa, el usuario puede importar las cookies de su navegador.
- **Skins:** el esquema `skin://<md5>/skin.wsz` descarga el skin del Skin Museum (`r2.webampskins.org`) y lo guarda en `userData/skins/`. La búsqueda usa la API GraphQL de `api.webamp.org`.
- **Milkdrop:** viene de `webamp/butterchurn`. La pantalla completa es una ventana aparte (`visualizer.html`), porque la ventana principal es una capa transparente que cubre todos los monitores.
- **Credenciales de TIDAL:** la app usa las que el usuario guarda en el diálogo. Para desarrollo podés copiar `.env.example` a `.env`. Lo que pongas ahí queda **dentro del build**, así que nunca compartas un instalador armado con un secret.
- **Login de usuario de TIDAL (PKCE):** en tu app de TIDAL agregá el redirect `https://lisandro46.github.io/winamp-remote-callback/`. TIDAL no acepta `http` ni `localhost`, así que esa página (repo [winamp-remote-callback](https://github.com/Lisandro46/winamp-remote-callback)) reenvía el login a `127.0.0.1:8889`.
- **Publicar una versión:** subí la versión en `package.json` y después corré `git tag vX.Y.Z && git push origin vX.Y.Z`. El workflow [`release.yml`](.github/workflows/release.yml) compila en Windows y adjunta los `.exe` a la Release.

```
src/main/providers/  types.ts · tidal.ts · ytmusic/ (catalog.ts InnerTube, player.ts ventana oculta, index.ts)
src/main/tidal/      api.ts (biblioteca, favoritos, búsqueda) · player.ts (control, cola, deep links)
src/main/skins.ts    esquema skin:// y búsqueda en el Skin Museum
src/main/visualizerWindow.ts  Milkdrop a pantalla completa
src/main/audio/      equalizer.ts (Equalizer APO)
src/main/smtc/       cliente del helper de Windows
src/main/auth/       OAuth PKCE + client credentials + datos cifrados (safeStorage) + ajustes
src/renderer/        Webamp + RemoteMedia + controller + Media Library + diálogos + visualizer
native/smtc-helper/  helper C# (.NET 8): SMTC, volumen del sistema y captura loopback (NAudio)
```

## Licencia

[MIT](LICENSE). Winamp es marca de sus respectivos dueños; TIDAL es marca de TIDAL Music AS; YouTube es marca de Google LLC. Las skins son de sus autores y se descargan del [Winamp Skin Museum](https://skins.webamp.org).
