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

## macOS (Apple Silicon)

Port a macOS con **YouTube Music** completo. TIDAL no está disponible en Mac porque no hay un equivalente a los controles multimedia de Windows. En Windows todo sigue igual.

### Instalar

1. Descargá `Winamp-Remote-Mac.dmg` (o armalo vos, ver más abajo), abrilo y arrastrá **Winamp Remote** a *Aplicaciones*.
2. Abrila. Está firmada de forma *ad-hoc* (sin Apple Developer ID), así que si la instalás desde un `.dmg` que armaste vos no pasa nada. Si la **descargaste** de internet, macOS la bloquea la primera vez: hacé clic derecho sobre la app → **Abrir** → **Abrir**, o andá a *Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente*. Con un certificado de Apple Developer ID y notarización ese paso desaparece.

### Cómo funciona en Mac

- **Ventana:** no hay ventana contenedora. La ventana mide exactamente lo que se ve (Winamp, y la Media Library acoplada a su derecha). Se mueve arrastrando la barra de título de cualquier panel, también a otro monitor, y se comporta como una app normal para el foco y Mission Control.
- **Menú nativo:** **Cuenta** (iniciar o cerrar sesión, cambiar de cuenta) y **Ver** (biblioteca `L`, buscar `J`, skins, Milkdrop).
- **Audio:** el sonido sale de la ventana oculta de YouTube Music a través de un grafo de **Web Audio**: ecualizador de 10 bandas, preamp, volumen y el audio real para el visualizador, sin instalar nada. El volumen es el del programa, no el del sistema.
- **Teclas multimedia:** play/pausa, siguiente y anterior del teclado y de "Está sonando" en el Centro de Control manejan la cola de la app.
- **Inicio de sesión:** **Iniciar sesión** (o *Cuenta → Iniciar sesión*) usa la sesión de **tu navegador por defecto**. Si ya tenés YouTube Music abierto con tu cuenta, entra directo. Si no, abre `music.youtube.com` en tu navegador y espera a que inicies sesión. Funciona con Chrome, Brave, Edge, Arc, Firefox y Safari. macOS te va a pedir permiso para leer el Llavero ("… Safe Storage"); para Safari hace falta además **Acceso total al disco** en *Ajustes del Sistema → Privacidad y seguridad*. Las cookies se leen solo en tu Mac y se guardan en la sesión de la app.
- **Varias cuentas:** si tu correo tiene más de una cuenta o canal de YouTube, la app muestra cuál está conectada y *Cuenta → Cambiar de cuenta…* te deja elegir.
- **Skins:** la Media Library y los diálogos toman los colores del skin de Winamp activo y cambian junto con él.

### Armarlo desde el código

```bash
npm ci
npm run dev        # modo desarrollo
npm run dist:mac   # genera dist/Winamp-Remote-Mac.dmg y .zip (arm64)
```

Para firmar con tu propio certificado: `npx electron-builder --mac --arm64 -c.mac.identity="Developer ID Application: …"` (y las variables de notarización de electron-builder).

## Qué hace y qué no (alcance)

| Winamp | Qué controla |
|---|---|
| Play / pausa / stop / anterior / siguiente / barra de posición | YouTube Music dentro de la app, o la app de TIDAL por los controles multimedia de Windows |
| Volumen | El volumen general de Windows (en los dos sentidos). En Mac, el volumen del programa |
| Ecualizador (10 bandas + preamp, presets) | Equalizer APO a nivel sistema en Windows, con compensación para que no sature. En Mac, Web Audio dentro de la app, sin instalar nada |
| Visualizador y Milkdrop | El audio real que está sonando |
| Playlist | Tu cola: lo que agregás desde la Media Library o la búsqueda |

**Atajos:**

- `L` o el botón eject abre la Media Library.
- `J` busca música.
- `Ctrl +`, `Ctrl −` y `Ctrl 0` cambian el tamaño de todo.

**Limitaciones:**

- **Windows 10/11 (64 bits)** con TIDAL y YouTube Music, o **macOS (Apple Silicon)** solo con YouTube Music.
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

### macOS (Apple Silicon)

macOS port with the full **YouTube Music** experience (TIDAL is Windows-only: Mac has no equivalent of the Windows media-control APIs).

- **Install:** open `Winamp-Remote-Mac.dmg` and drag **Winamp Remote** to *Applications*. The app is ad-hoc signed (no Apple Developer ID). A copy you built yourself opens normally; a *downloaded* copy needs right-click → **Open** the first time (or *System Settings → Privacy & Security → Open Anyway*).
- **Window:** no full-screen overlay. The window is exactly as big as what is visible (Winamp plus the Media Library docked to its right), drags by any panel title bar, including to another display, and behaves like a normal macOS app.
- **Native menu bar:** **Cuenta** (sign in/out, switch account) and **Ver** (library `L`, search `J`, skins, Milkdrop).
- **Audio:** a Web Audio graph inside the hidden YouTube Music window provides the 10-band equalizer, preamp, volume and the real audio for the visualizer, with nothing to install. Volume is the app's, not the system's. Keyboard media keys and the Now Playing widget drive the app's queue.
- **Sign-in:** uses your **default browser's** session. If you are already signed in to YouTube Music it connects immediately; otherwise it opens `music.youtube.com` in your browser and waits. Works with Chrome, Brave, Edge, Arc, Firefox and Safari. macOS asks for Keychain access ("… Safe Storage"); Safari also needs **Full Disk Access**. Cookies are read locally only.
- **Multiple accounts:** if your email has several YouTube accounts/channels, the app shows which one is connected and *Cuenta → Cambiar de cuenta…* lets you pick.
- **Skins:** the Media Library and dialogs take their colors from the active Winamp skin.
- **Build:** `npm ci && npm run dist:mac` writes `dist/Winamp-Remote-Mac.dmg` and `.zip`. To sign with your own certificate: `npx electron-builder --mac --arm64 -c.mac.identity="Developer ID Application: …"`.

### Scope and limitations

- **Windows 10/11 64-bit** (TIDAL and YouTube Music) or **macOS on Apple Silicon** (YouTube Music only). The UI is in Spanish.
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

Requisitos: Node 20+. En Windows, además, Windows 10/11 y .NET 8 SDK. En macOS no hace falta .NET.

```bash
npm install
npm run dev     # compila el helper de Windows y abre la app
npm run dist    # instalador + portable en dist/ (helper self-contained incluido)
npm run dist:mac  # macOS: .dmg y .zip en dist/ (arm64)
```

- **Proveedores:** `src/main/providers/types.ts` define `MusicProvider`. `ipc.ts` le pasa todas las llamadas del renderer al servicio elegido (`settings.provider`).
- **YouTube Music:**
  - **Reproducción:** music.youtube.com se carga en una `BrowserWindow` oculta (partición `persist:ytmusic`) y se maneja con su `#movie_player` (`loadVideoById`, `seekTo`…). La cola la lleva la app.
  - **Catálogo y biblioteca:** salen de InnerTube con [youtubei.js](https://github.com/LuanRT/YouTube.js), usando las cookies de esa partición.
  - **Login:** Google bloquea los navegadores embebidos, así que la ventana de login se presenta como Firefox. Como alternativa, el usuario puede importar las cookies de su navegador.
- **Plataformas:** `src/main/platform/` elige el backend de audio según `process.platform`. En Windows usa `smtc-helper.exe` (volumen del sistema, captura loopback) y Equalizer APO. En macOS inyecta un grafo Web Audio en la ventana oculta de YouTube Music (`ytmusic/player.ts`, preload `ytmusic.ts`) para el ecualizador, el volumen y el PCM del visualizador, y reenvía las teclas multimedia a la cola de la app.
- **Ventana en macOS:** en vez del overlay transparente de Windows, `macFit.ts` mide los paneles visibles y pide a `main` que ajuste el tamaño de la ventana (`window:fit`). El arrastre mueve la ventana del sistema siguiendo el cursor (`window:drag`).
- **Sesión en macOS:** `src/main/auth/browserCookies.ts` lee las cookies de YouTube del navegador por defecto (Chromium con la clave del Llavero, Firefox y Safari) y las importa a la partición `persist:ytmusic`.
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
src/main/platform/   AudioBackend/EqBackend: windows.ts (smtc-helper + Equalizer APO) y mac.ts (Web Audio)
src/main/menu.ts     menú nativo de macOS (Cuenta, Ver)
src/main/appIcon.ts  ícono de Winamp para ventanas y Dock
src/renderer/ui/macFit.ts  ventana de macOS que se ajusta al contenido y se arrastra por los paneles
src/main/smtc/       cliente del helper de Windows
src/main/auth/       OAuth PKCE + client credentials + datos cifrados (safeStorage) + ajustes
src/renderer/        Webamp + RemoteMedia + controller + Media Library + diálogos + visualizer
native/smtc-helper/  helper C# (.NET 8): SMTC, volumen del sistema y captura loopback (NAudio)
```

## Licencia

[MIT](LICENSE). Winamp es marca de sus respectivos dueños; TIDAL es marca de TIDAL Music AS; YouTube es marca de Google LLC. Las skins son de sus autores y se descargan del [Winamp Skin Museum](https://skins.webamp.org).
