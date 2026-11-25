# MUSHROOM PARTY CIAC — Documentación Técnica y Arquitectura N64

## 1. Ejecución Portable (Sin Instalación ni Permisos de Administrador)

El proyecto incluye la versión portable oficial de **Node.js para Windows (`v22.14.0-win-x64`)** descomprimida en `C:\juego ciac\tools\node\node.exe`. No requiere permisos de administrador, no modifica variables de entorno (`PATH`) ni altera el registro de Windows.

Para iniciar el servidor directamente:

```powershell
& "C:\juego ciac\tools\node\node.exe" "C:\juego ciac\server.js"
```

- **Pantalla Principal Proyectada (Anfitrión + Escenario 3D N64)**: `http://localhost:3000/`
- **Mando Móvil para Equipos (QR / Wi-Fi Local)**: `http://10.34.85.30:3000/play` (o la IP LAN detectada automáticamente en el código QR en pantalla).

---

## 2. Extracción en Solo Lectura desde `Mario Party (USA).z64`

La ROM original (`C:\juego ciac\Mario Party (USA)\Mario Party (USA).z64`, `33.554.432` bytes, ID `CLBE`) se conserva **100% intacta** y se lee exclusivamente con descriptor de solo lectura (`fs.openSync(ROM_PATH, "r")`).

- **Descompresión Hudson LZSS (`ctype = 1`)**: Buffer circular de 1024 bytes inicializado en `0x3BE` desde la tabla maestra de 73 directorios en `0x31C7E0`.
- **Decodificación de Texturas N64 CI4 (`BMP1` + `PAL1`)**: Desempaquetado de nibbles de 4 bits (2 píxeles por byte, `high nibble` seguido de `low nibble`) cruzado con su tabla de paleta RGBA `PAL1` de 16 colores.
- **Minijuego `#32: IROIRO KINOKO` (*Mushroom Mix-Up*, Directorio `44`)**:
  - `Archivo 0 (kinokomap-32m_004)`: Geometría 3D exterior del hongo (97 vértices, 18 caras).
  - `Archivo 1 (all_kinoko-32m_005)`: Las 7 texturas originales de sombreros de hongo (`32mt001_DEF` rojo, `32mt002_DEF` azul, `32mt003_DEF` amarillo, `32mt004_DEF` verde, `32mt005_DEF` celeste, `32mt006_DEF` rosado, `32mt009_DEF` negro).
  - `Archivo 2 (all_kinoko-32m_007)`: Geometría 3D del tallo interior del hongo (72 vértices, 18 caras).
  - `Archivo 3 (all_kinoko-32m_008)`: Plano y textura original del agua del mar (`05mt001_DEF`).
- **Modelos 3D principales de los 6 personajes (`Directorios 1..6`, `Archivo 158`)**:
  - **Mario** (`Dir 1`, 994 vértices, 294 caras, 6 texturas CI4)
  - **Luigi** (`Dir 2`, 922 vértices, 262 caras, 3 texturas CI4)
  - **Yoshi** (`Dir 3`, 1000 vértices, 299 caras, 3 texturas CI4)
  - **Wario** (`Dir 4`, 505 vértices, 410 caras, 3 texturas CI4)
  - **Donkey Kong** (`Dir 5`, 1087 vértices, 324 caras, 4 texturas CI4)
  - **Peach** (`Dir 6`, 1078 vértices, 342 caras, 5 texturas CI4)

---

## 3. Pulido Visual, Jugabilidad N64 y Preparación para Cloudflare

1. **Escenario, Cámara y Distribución de Hongos ([public/stage.js](file:///C:/juego%20ciac/public/stage.js))**:
   - Resolución interna auténtica de consola N64 (`360p` escalada con `image-rendering: pixelated`).
   - Distribución en racimo hexagonal 3D de las plataformas sobre el mar con anillos de espuma dinámicos alrededor de cada tallo y sombras proyectadas bajo los pies de cada personaje.
   - Tres modos de cámara conmutables en vivo: **Panorámica N64**, **Enfoque al Líder** (sigue al hongo a mayor altura) y **Órbita Arcade**.
   - Extensión automática de segmentos del tallo (`all_kinoko-32m_007`) cuando un hongo alcanza gran altura.
2. **Animaciones Esqueléticas y Expresiones**:
   - Articulación en tiempo real sobre la jerarquía `OBJ1` de cada personaje: balanceo en reposo (`idle`), pose con brazo en alto al confirmar respuesta desde el teléfono (`ready`), salto de celebración con giro de 360° al subir (`jump_up`), pérdida de equilibrio con inclinación del hongo al bajar (`drop_down`) y baile de victoria en el podio (`victory`).
3. **Efectos de Sonido Retro N64 y Transiciones**:
   - Sintetizador **WebAudio API** integrado sin dependencias externas: fanfarria de inicio (*"START!"*), confirmación de respuesta móvil, resorte ascendente (`+1m`), descenso grave (`-1m`), alerta en los últimos 5 segundos del reloj y fanfarria de victoria (*"FINISH!"*).
   - Carteles centrales de transición arcade N64, barra de progreso de 15 bloques, reloj de cuenta regresiva sincronizado y **Podio Final** con los equipos a mayor altura.
4. **Mandos Móviles para Android y iPhone ([public/play.html](file:///C:/juego%20ciac/public/play.html))**:
   - Respuesta táctil inmediata (`touch-action: manipulation`), soporte de áreas seguras iOS (`env(safe-area-inset-*)`), retroalimentación háptica (`navigator.vibrate`) + confirmación sonora, indicador de estado de red (`EN LÍNEA` / `RECONECTANDO...`) y reconexión automática al desbloquear el teléfono (`visibilitychange`) conservando el `teamId` y la altura alcanzada.
5. **Compatibilidad con Alojamiento Estático en Cloudflare**:
   - Todos los modelos 3D y texturas N64 extraídos de la ROM están preempaquetados en [public/assets/n64_assets.json](file:///C:/juego%20ciac/public/assets/n64_assets.json) (`686 KB`), permitiendo alojar el frontend directamente en **Cloudflare Pages** y conectar el estado multijugador a un **Cloudflare Worker / Durable Object** sin depender de acceso en disco a la ROM ni de túneles locales.

## 4. Revisión de seguridad y despliegue independiente

Esta versión usa `game.mjs` para compartir las reglas entre Node.js y Cloudflare Workers. `worker.mjs` guarda el banco, los equipos y el estado de la partida en un Durable Object exclusivo. El cliente consulta el estado una vez por segundo por HTTP; no depende de SSE, LAN ni túneles. El QR se genera a partir del origen público. Existe una sola partida compartida de seis equipos en este proyecto, no salas múltiples.

El banco inicial está vacío deliberadamente: se carga con el botón BANCO 15 PREG. como un arreglo de exactamente quince objetos con `prompt`, cuatro `options` (texto o `{label}`) y `correctOption` (A/B/C/D). No se permite iniciar antes de cargar un banco válido. Las claves solo se muestran en el estado público al evaluar cada ronda. El anfitrión debe autenticarse con `HOST_KEY` (secreto de al menos 16 caracteres). No publicar el banco con las respuestas en un repositorio público; cargarlo mediante el panel autenticado. Cada equipo tiene un token privado, independiente de su ID público.

En Node.js define `HOST_KEY` en el entorno antes de ejecutar `node server.js`. El servidor local mantiene la partida en memoria; el Worker la persiste. En Cloudflare configura el secreto `HOST_KEY` exclusivamente en el Worker `ciacparty`. La configuración `wrangler.jsonc` es para un Worker nuevo con Static Assets y Durable Object; no modifica otros Workers. Si se requiere específicamente `ciacparty.pages.dev`, se necesita una configuración Pages y un binding al Worker dedicado; el archivo actual no crea Pages. No se ha desplegado. Confirmar permisos de publicación de los recursos N64 antes de publicar el paquete. `node verify.mjs` ejecuta las pruebas de lógica y simula el almacenamiento del Durable Object; no sustituye las pruebas en Cloudflare real o en teléfonos.
