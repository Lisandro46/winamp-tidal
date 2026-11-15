# Port a macOS — Winamp Remote (solo YouTube Music)

Plan para portar `Lisandro46/winamp-tidal` a macOS (Apple Silicon) con Claude Code.
Alcance: **YouTube Music completo en Mac**. TIDAL queda deshabilitado en macOS (no hay API pública
equivalente a los controles multimedia de Windows). Windows debe seguir funcionando igual que antes.

## Diagnóstico (ya revisado)

| Área | Archivo(s) | Estado en Mac |
|---|---|---|
| UI Webamp, skins, biblioteca, búsqueda | `src/renderer/**`, `src/main/skins.ts` | ✅ Funciona tal cual |
| YouTube Music (ventana oculta + `youtubei.js`) | `src/main/providers/ytmusic/*` | ✅ Funciona tal cual |
| Secretos cifrados | `src/main/auth/store.ts` (`safeStorage`) | ✅ Usa Keychain en Mac. Solo cambiar el texto de error que dice "Windows" |
| Volumen del sistema + PCM para el visualizador | `native/smtc-helper` (C#/WinRT) vía `src/main/smtc/helperClient.ts` | ❌ Reemplazar |
| Ecualizador | `src/main/audio/equalizer.ts` (Equalizer APO, registro de Windows) | ❌ Reemplazar |
| Control de TIDAL | `src/main/tidal/player.ts` (usa `smtc`) | ❌ Deshabilitar en Mac |
| Scripts / empaquetado | `package.json` (`dev` llama a `dotnet`, `dist` usa `--win`) | ❌ Ajustar |
| CI | `.github/workflows/release.yml` | ➕ Agregar job `macos-latest` |

## Estrategia

En Mac la música suena **dentro** de la `BrowserWindow` oculta de YouTube Music, así que todo se resuelve
con **Web Audio dentro de esa página**, sin binarios nativos:

```
<video> de music.youtube.com
   └─ MediaElementSource → 10× BiquadFilter (peaking, bandas de Winamp) → GainNode (volumen) → AnalyserNode → destination
                                                                                              └─ PCM mono int16 → IPC → visualizador
```

Ventaja extra: el ecualizador de 10 bandas funciona en Mac sin instalar nada.

---

## Pasos (un prompt por paso para Claude Code)

### Paso 0 — Preparar
```bash
gh repo fork Lisandro46/winamp-tidal --clone && cd winamp-tidal
git checkout -b macos-port
npm ci
```
Copiá este archivo a la raíz del repo como `PORT-MACOS.md`.

### Paso 1 — Abstracción de plataforma
> Leé PORT-MACOS.md. Creá `src/main/platform/types.ts` con una interfaz `AudioBackend` que cubra lo que hoy
> usa `ipc.ts` de `smtc`: `setVolume(volume)`, `onVolume(listener)`, `onPcm(listener)`, `setVisualizer(enabled)`,
> `start()`, `stop()`; y una interfaz `EqBackend` con `status()` y `apply(state)` (la misma forma que la clase
> `Equalizer` actual). Implementá `src/main/platform/windows.ts` envolviendo `smtc` y `Equalizer` sin cambiar
> su comportamiento, y `src/main/platform/index.ts` que elija según `process.platform`. Cambiá `ipc.ts` e
> `index.ts` para usar la abstracción. No toques todavía nada de Mac. Corré `npm run typecheck`.

### Paso 2 — Backend de audio para Mac (Web Audio en la ventana oculta)
> Implementá `src/main/platform/mac.ts`. Agregá a `ytmusic/player.ts` un método que inyecte (vía
> `executeJavaScript`, de forma idempotente) un grafo Web Audio sobre el `<video>` de la página:
> `MediaElementSource → 10 BiquadFilter peaking (frecuencias EQ_BANDS, Q≈1.4) → preamp GainNode → volume GainNode → AnalyserNode → destination`.
> Re-inyectá si YouTube reemplaza el elemento `<video>` (MutationObserver). Exponé en la página funciones
> `__wr.setVolume(0-100)`, `__wr.setEq(state)` y `__wr.setPcm(enabled)`. Para el PCM, mientras esté activo,
> leé el analyser cada ~40 ms, convertí a mono int16 a 24000 Hz y mandalo al main con el mismo formato
> `PcmChunk` que hoy usa el helper de Windows (base64). Usá un preload propio para la ventana oculta
> con `contextBridge`/`ipcRenderer.send` en lugar de exponer `ipcRenderer` a la página. El volumen reportado
> por `onVolume` es el del GainNode (no el del sistema).

### Paso 3 — Ecualizador en Mac
> En `mac.ts`, implementá `EqBackend` llamando a `__wr.setEq(state)` con la misma conversión slider→dB que
> `equalizer.ts` (`toDb`, ±12 dB, preamp incluido). `status()` debe devolver que está disponible sin
> instalación. Al cargar la página o re-inyectar el grafo, re-aplicá el último `settings.eq` guardado.
> Si la UI muestra mensajes sobre instalar Equalizer APO, ocultalos en Mac.

### Paso 4 — TIDAL fuera en Mac
> En macOS, que el setup y el botón de servicio solo ofrezcan YouTube Music (o que TIDAL aparezca
> deshabilitado con el texto "Solo disponible en Windows"). Asegurate de que nada en Mac intente lanzar
> `smtc-helper.exe`. Cambiá el mensaje de `auth/store.ts` que dice "Windows no permite cifrar…" por uno
> neutro.

### Paso 5 — Scripts y empaquetado
> En `package.json`: que `dev` solo corra `build:helper` en Windows (script Node chico o `run-script-os`);
> agregá `dist:mac` = `npm run build && electron-builder --mac --arm64 --publish never`; en `build` agregá
> `mac: { target: ["dmg", "zip"], category: "public.app-category.music", identity: null }` y que
> `extraResources` del helper solo aplique en Windows (moverlo a `win.extraResources`). Agregá un icono
> `.icns` si hace falta. Corré `npm run dist:mac`.

### Paso 6 — Probar en la Mac
```bash
npm run dev            # modo desarrollo
npm run dist:mac       # genera dist/*.dmg
xattr -cr "/Applications/Winamp Remote.app"   # la app no está firmada
```
Checklist:
- [ ] Busca y reproduce sin cuenta
- [ ] Login con Google y biblioteca (favoritos, playlists, mixes)
- [ ] Play / pausa / siguiente / anterior / seek desde Webamp
- [ ] Volumen de Webamp cambia el audio
- [ ] Las 10 bandas del EQ se escuchan; preamp funciona; se mantiene al cambiar de tema
- [ ] Visualizador de Webamp y Milkdrop se mueven con la música
- [ ] Skins del Winamp Skin Museum cargan
- [ ] Teclas multimedia del teclado (ver paso 7)

### Paso 7 — Teclas multimedia y noTunes (opcional)
> Registrá `globalShortcut` para `MediaPlayPause`, `MediaNextTrack`, `MediaPreviousTrack` (en Mac requiere
> permiso de Accesibilidad la primera vez) o, mejor, publicá `navigator.mediaSession` desde la ventana
> oculta para que la app aparezca en "Está sonando" del Centro de Control.

Después apuntá noTunes a la app nueva:
```bash
defaults write digital.twisted.noTunes replacement "/Applications/Winamp Remote.app"
```

### Paso 8 — CI (opcional, para compartirlo)
> Agregá a `.github/workflows/release.yml` un job `macos` en `macos-latest` que corra `npm ci` y
> `npm run dist:mac` y suba `dist/*.dmg` al release. Sin firmar/notarizar.

---

## Notas
- `PcmChunk`, `SystemVolume`, `EqState`, `EqStatus` están en `src/shared/types.ts`: reusarlos, no duplicar tipos.
- Web Audio sobre `<video>` de YouTube: la página es same-origin con su media, así que `createMediaElementSource`
  funciona; si el audio se corta al conectarlo, verificar que el `AudioContext` se reanude (`resume()`) tras el play.
- Licencia MIT: mantener el `LICENSE` original y dar crédito al autor en el README si se publica el fork.
- Si al final funciona bien, vale la pena abrirle un PR al repo original.

---

## Estado actual (2026-11-15)

Ya resuelto y probado en una Mac instalada:

- App flotante sin ventana contenedora: la ventana mide solo lo visible, se arrastra a otras pantallas y recupera el foco bien.
- Menú nativo (Cuenta, Ver), nombre "Winamp Remote" e ícono clásico de Winamp en el `.app`.
- Login de YouTube Music con la sesión del navegador. Se puede desconectar y volver a conectar. macOS pide permiso del Llavero.

## Pendientes

### Bug prioritario: la tecla `L` cierra la biblioteca mientras se escribe

Con el foco en el buscador de la biblioteca, escribir una `L` (por ejemplo "metallica") oculta la Winamp Media Library.

- Causa probable: el listener de `keydown` en `src/renderer/webamp/controller.ts` ignora `input, textarea, #library`, pero la comprobación usa `event.target` y no cubre el caso de foco dentro de la biblioteca o de sus diálogos.
- Esperado: `L` (y también `J`, `B`, `Z`) no deben actuar como atajos cuando el foco está en un campo de texto de cualquier panel.

### Cuentas de YouTube Music

- Un mismo correo puede tener varias cuentas o canales (ejemplo: dos canales bajo el mismo mail). Hoy la app toma la primera, que puede no ser la que se usa para música.
- Hace falta poder elegir la cuenta o el canal asociado al correo.
- La interfaz no muestra qué cuenta está conectada: ni el correo ni el nombre del canal. Mostrarlo en la barra de estado de la biblioteca y en el menú Cuenta.

### Interfaz de la Winamp Media Library

- Rediseñar la ventana para que use la misma skin que Webamp (hoy usa colores y botones propios que desentonan).

### Íconos

- Todos los íconos de la app deben ser el clásico de Winamp (ícono de la app, Dock, favicon, ventanas secundarias). No debe quedar el ícono de Electron en ningún lado.

### Firma de la app

- Resolver la necesidad de correr `xattr -cr` a mano tras instalar. Opciones: firmar con Developer ID y notarizar, o documentar un flujo claro de instalación.

### Documentación

- Actualizar el `README.md` con los cambios del port a macOS (instalación, permisos, diferencias con Windows) para poder abrir un Pull Request al repositorio original y dejar documentado lo hecho.
