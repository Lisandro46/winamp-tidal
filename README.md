# Winamp Remote para TIDAL

**🇦🇷 Español** · [🇺🇸 English](#english)

Un **Winamp 2 de verdad** (con skins `.wsz`, vía [Webamp](https://github.com/captbaritone/webamp)) que funciona como control remoto de la app de escritorio de **TIDAL**. Play, pausa, temas, volumen, el ecualizador clásico de 10 bandas y el visualizador, todo sobre lo que suena en TIDAL.

> Proyecto de fan, gratis y de código abierto. No está afiliado a TIDAL ni a Winamp.

## Descargar e instalar (2 minutos)

1. Andá a **[Releases](https://github.com/Lisandro46/winamp-tidal/releases/latest)** y bajá uno de estos:
   - `Winamp-Remote-TIDAL-Setup-x.y.z.exe` → instalador (recomendado; crea acceso directo).
   - `Winamp-Remote-TIDAL-Portable-x.y.z.exe` → sin instalar, lo abrís y listo.
2. Abrilo. Windows puede mostrar **"Windows protegió su PC"** porque la app no está firmada (un certificado cuesta cientos de dólares por año). Tocá **Más información → Ejecutar de todas formas**. El código es público y el instalador lo arma GitHub directamente desde este repo.
3. Abrí la **app de TIDAL** y poné un tema. El Winamp ya lo controla.
4. La primera vez te pregunta cómo lo querés usar (lo podés cambiar después con el botón **TIDAL…** de la Media Library):

| Modo | Qué hacés | Configuración |
|---|---|---|
| **Solo control remoto** | Elegís la música en TIDAL y la manejás desde el Winamp | Ninguna |
| **Control remoto + buscar en TIDAL** | Además buscás temas, discos, artistas y playlists públicas desde el Winamp y armás tu playlist | Crear gratis una app en TIDAL (≈3 min, ver abajo) |

### Activar "buscar en TIDAL" (opcional)

1. Entrá a <https://developer.tidal.com/dashboard> e iniciá sesión con tu cuenta de TIDAL.
2. Creá una app nueva (**Create app**). El nombre no importa, por ejemplo "Winamp Remote".
3. Copiá el **Client ID** y el **Client Secret** de esa app.
4. En el Winamp: **TIDAL… → Control remoto + buscar en TIDAL**, pegalos y tocá **Probar y guardar**.

Quedan guardados cifrados en tu PC (DPAPI de Windows) y solo se usan para hablar con TIDAL. ¿Por qué cada uno crea su app? Porque TIDAL no permite repartir esas claves dentro de un programa público.

### Ecualizador (opcional)

El ecualizador del Winamp ecualiza el sonido de **todo Windows** usando [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) (gratis). Instalalo, marcá tu dispositivo de salida (parlantes o auriculares) y reiniciá si te lo pide. Sin Equalizer APO todo lo demás funciona igual.

## Qué hace y qué no (alcance)

| Winamp | Qué controla |
|---|---|
| Play / pausa / stop / anterior / siguiente / barra de posición | La app TIDAL, con los controles multimedia de Windows |
| Volumen | El volumen general de Windows (en los dos sentidos) |
| Ecualizador (10 bandas + preamp, presets) | Equalizer APO, a nivel sistema, con compensación para que no sature |
| Visualizador (espectro / osciloscopio) | El audio real que está sonando |
| Display y playlist | Lo que suena en TIDAL. Con "buscar en TIDAL" la playlist del Winamp es tu cola |
| Skins | Cualquier `.wsz`: hay miles en <https://skins.webamp.org>. Botón **Skin…** o arrastrá el archivo |

**Atajos:** `L` o el botón eject abre la Media Library · `J` busca en TIDAL · `Ctrl +` / `Ctrl −` / `Ctrl 0` cambia el tamaño de todo.

**Limitaciones:**

- **Necesita la app de escritorio de TIDAL abierta** y una cuenta de TIDAL. El sonido sale de TIDAL; esto es un control remoto, no un reproductor aparte.
- Solo **Windows 10/11 (64 bits)**.
- **Tus favoritos, mixes y playlists** todavía no aparecen: TIDAL aprueba a mano el login de apps de terceros y aún no lo habilitó ([pedido abierto](https://github.com/orgs/tidal-music/discussions/415)). Cuando lo haga, se activan sin reinstalar nada.
- Al terminar un tema, TIDAL puede arrancar su radio un instante antes de que el Winamp pase al siguiente.
- Con el **modo exclusivo** de TIDAL activado, el ecualizador y el visualizador no reciben el audio.
- El balance de Winamp no tiene efecto.

## Problemas comunes

- **El Winamp no reacciona:** fijate que la app de TIDAL esté abierta y sonando algo.
- **"TIDAL no aceptó ese Client ID / Client Secret":** copialos de nuevo desde el dashboard, sin espacios.
- **El ecualizador no cambia nada:** reinstalá Equalizer APO marcando el dispositivo que estás usando y reiniciá.
- **Desinstalar:** desde *Configuración → Aplicaciones* como cualquier programa.

¿Otro problema? Abrí un [issue](https://github.com/Lisandro46/winamp-tidal/issues).

---

<a id="english"></a>

## English

A **real Winamp 2** (with `.wsz` skins, via [Webamp](https://github.com/captbaritone/webamp)) that works as a remote control for the **TIDAL desktop app**: play/pause, tracks, volume, the classic 10-band equalizer and the visualizer, all driving what TIDAL is playing. Fan project, free and open source, not affiliated with TIDAL or Winamp.

### Install

1. Download the latest `Winamp-Remote-TIDAL-Setup-x.y.z.exe` (installer) or `…-Portable-…exe` from **[Releases](https://github.com/Lisandro46/winamp-tidal/releases/latest)**.
2. If Windows shows *"Windows protected your PC"* (the app isn't code-signed), click **More info → Run anyway**. The installer is built by GitHub Actions straight from this repo.
3. Open the **TIDAL app** and play something. Winamp now controls it.
4. On first run, pick a mode (change it later with the **TIDAL…** button in the Media Library):
   - **Remote control only:** no setup.
   - **Remote control + search TIDAL:** search tracks, albums, artists and public playlists from Winamp. Create a free app at <https://developer.tidal.com/dashboard>, copy its **Client ID** and **Client Secret**, paste them in the dialog and click **Probar y guardar** (test & save). They're stored encrypted on your PC. Each user needs their own app because TIDAL doesn't allow shipping those keys in a public program.
5. Optional: install [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) for the system-wide equalizer.

### Scope and limitations

- Requires the **TIDAL desktop app** running and a TIDAL account; sound comes from TIDAL.
- **Windows 10/11 64-bit** only. The UI is in Spanish.
- Your favorites, mixes and playlists need TIDAL to approve user login for third-party apps ([request](https://github.com/orgs/tidal-music/discussions/415)); they'll light up without reinstalling once it does.
- TIDAL's exclusive mode bypasses the equalizer and visualizer.

---

## Para desarrolladores / For developers

```
┌──────── Electron renderer ─────────┐     ┌──── Electron main ────┐     ┌──── Windows ────┐
│ Webamp + RemoteMedia (motor falso) │◄───►│ TIDAL API v2 (biblio) │     │ smtc-helper.exe │
│ Media Library (TIDAL)              │ IPC │ TidalPlayer ──────────┼────►│  · SMTC (TIDAL) │
│                                    │     │ Equalizer APO config  │     │  · volumen      │
└────────────────────────────────────┘     └───────────────────────┘     │  · loopback     │
                                                                         └─────────────────┘
```

Requisitos: Windows 10/11, Node 20+, .NET 8 SDK.

```bash
npm install
npm run dev     # compila el helper de Windows y abre la app
npm run dist    # instalador + portable en dist/ (helper self-contained incluido)
```

- **Credenciales de TIDAL:** la app usa las que el usuario guarda en el diálogo **TIDAL…**. Para desarrollo podés copiar `.env.example` a `.env`; lo que pongas ahí queda **dentro del build**, así que nunca compartas un instalador armado con un secret. Los instaladores públicos los arma el workflow de GitHub, que no usa `.env`.
- **Login de usuario (PKCE):** en tu app de TIDAL agregá el redirect `https://lisandro46.github.io/winamp-remote-callback/` (TIDAL no acepta `http`/`localhost`; esa página —repo [winamp-remote-callback](https://github.com/Lisandro46/winamp-remote-callback)— reenvía el login a `127.0.0.1:8889`; el código no sirve sin el verificador PKCE, que nunca sale de la PC) y los scopes `user.read collection.read collection.write playlists.read search.read recommendations.read`.
- **Publicar una versión:** subí la versión en `package.json`, y luego `git tag vX.Y.Z && git push origin vX.Y.Z`. El workflow [`release.yml`](.github/workflows/release.yml) compila en Windows y adjunta los `.exe` a la Release.
- La API de reproducción remota de TIDAL es interna, así que los temas se abren con links `tidal://track/<id>` y la app maneja su propia cola.
- El ecualizador escribe `winamp-remote.txt` en la carpeta de configuración de Equalizer APO y agrega `Include: winamp-remote.txt` a su `config.txt`.

```
src/main/tidal/      api.ts (biblioteca, favoritos, búsqueda) · player.ts (control, cola, deep links)
src/main/audio/      equalizer.ts (Equalizer APO)
src/main/smtc/       cliente del helper de Windows
src/main/auth/       OAuth PKCE + client credentials + datos cifrados (safeStorage) + ajustes
src/renderer/        Webamp + RemoteMedia + controller + Media Library + diálogos
native/smtc-helper/  helper C# (.NET 8): SMTC, volumen del sistema y captura loopback (NAudio)
```

## Licencia

[MIT](LICENSE). Winamp es marca de sus respectivos dueños; TIDAL es marca de TIDAL Music AS. Las skins son de sus autores.
