# Read and Watch with AI en Español

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

## 1.2.0: nuevo nombre y configuración API

**Contextual AI Reader** pasa a llamarse **Read and Watch with AI**. El ID interno y la URL del repositorio no cambian: se conservan ajustes, cachés e historiales. Las rutas guardadas se mantienen; las instalaciones nuevas usan el nuevo nombre.

Selecciona **OpenAI-compatible API** o **Anthropic API token** en **AI backend** e introduce la clave, URL base y modelo correspondientes. OpenAI: `https://api.openai.com/v1`; Claude: `https://api.anthropic.com/v1`. No necesitas Codex, Claude Code, Node.js ni una suscripción CLI. Incluye traducción de selecciones/texto PDF, vocabulario, notas completas y lotes, subtítulos, resúmenes de vídeos, seguimiento del chat y preguntas sobre imágenes. Las imágenes requieren un modelo con visión. **Test text / Test image** envían pruebas pequeñas con una imagen sintética; pueden generar cargos.

**Auto** prioriza la clave compatible con OpenAI, luego Anthropic y después las CLI locales. Selecciona **Codex** explícitamente si prefieres la sesión local. La transcripción de audio sin subtítulos se configura aparte mediante **Transcription API key / base URL / model** o Groq. El servicio debe admitir `/audio/transcriptions`, `verbose_json` y segmentos con tiempos. Solo se reutiliza la clave de chat si ambas URL base coinciden. Una clave Claude no sirve para OpenAI Whisper. Las claves, protocolos y capacidades de modelos no son intercambiables. Extraer CC, capturar imágenes y leer con la voz del sistema no requiere una clave IA.

Read and Watch with AI es un complemento de escritorio para Obsidian pensado para lectura asistida: traducción, explicación de vocabulario en contexto, lectura en voz alta, notas de extractos, PDF seleccionables y traducción de archivos Markdown.

## Requisitos del sistema e instalación

Usa Obsidian de escritorio en macOS, Windows o Linux. En móvil puedes leer notas sincronizadas, pero no ejecutar las herramientas locales de CLI o vídeo. La instalación desde Community Plugins no necesita Node.js, npm ni el repositorio de código. Elige un backend de IA:

- Codex: instala [Codex App o CLI](https://developers.openai.com/codex/cli) y ejecuta `codex login` si usas la CLI.
- Claude Code: instala Claude Code e inicia sesión.
- API: configura una clave de OpenAI o Anthropic; no requiere una CLI local.

Los subtítulos protegidos de YouTube, la captura limpia de fotogramas y la transcripción sin CC requieren herramientas adicionales.

| Sistema | Instalar `yt-dlp` y `ffmpeg` |
| --- | --- |
| macOS | `brew install yt-dlp ffmpeg` |
| Windows | `winget install yt-dlp.yt-dlp` y `winget install Gyan.FFmpeg` |
| Ubuntu/Debian | `sudo apt update && sudo apt install yt-dlp ffmpeg` |
| Otro Linux | Usa el gestor de paquetes de la distribución |

Reinicia Obsidian después de instalarlas. Si la detección automática falla, escribe la ruta completa del ejecutable en los ajustes. La transcripción sin CC también necesita una clave de Groq u OpenAI.

## Datos locales y caché

Los ajustes, claves API, caché de vocabulario, subtítulos y traducciones de YouTube se guardan por bóveda en `<vault>/.obsidian/plugins/contextual-ai-reader/data.json`. Para conservar la caché, no borres `data.json`, la carpeta del complemento ni sus datos. Copia el archivo de forma privada al cambiar de bóveda.

La caché conserva los 30 vídeos más recientes. Las capturas y notas de transcripción son archivos normales de la bóveda y no se borran al limpiar la caché. `data.json` puede contener claves API: no lo publiques, compartas ni incluyas en Git.

## Funciones

- Elige el idioma de origen o usa detección automática.
- Elige el idioma de aprendizaje/destino para traducciones y explicaciones.
- Muestra el popup al seleccionar texto mientras mantienes `Command` en macOS o `Ctrl` en Windows/Linux.
- Para palabras o términos cortos, usa primero caché y traducción rápida; después puede usar IA para explicar el significado en el párrafo actual.
- Si el destino es chino y seleccionas una palabra inglesa, también usa un pequeño diccionario local inglés-chino.
- Traduce el Markdown actual y añade la traducción debajo del original.
- Traduce el Markdown actual en formato intercalado: párrafo original, párrafo traducido.
- Traduce varios archivos Markdown por ruta, carpeta o comodín.
- Muestra token usage cuando el backend de IA lo reporta.

## Backends de IA

Elige `AI backend` en la configuración.

- `Auto`: prioriza las claves OpenAI/Anthropic y después las CLI locales.
- `Codex`: usa el CLI local de Codex y tu sesión local.
- `Claude Code`: usa el CLI local de Claude Code y tu sesión local.
- `OpenAI API token`: usa tu API key de OpenAI.
- `Anthropic API token`: usa tu API key de Anthropic.

## Configuración básica

- `Source language`: idioma del texto que estás leyendo. Usa `Auto detect` si no estás seguro.
- `Learning / target language`: idioma de salida para traducciones y vocabulario.
- `Require Command/Ctrl key for auto translate`: recomendado para evitar activaciones accidentales.
- `Custom prompt / context`: describe el libro, dominio, terminología y estilo deseado.
- `Reasoning effort`: para traducción normalmente `none` es más rápido y económico.

## Uso

1. Abre una nota Markdown o un PDF con texto seleccionable.
2. Mantén `Command` en macOS o `Ctrl` en Windows/Linux y selecciona texto.
3. El popup aparece cerca de la selección.
4. Usa Sparkles para traducción o explicación con IA.
5. Usa Copy para copiar o Book plus para guardar en la nota de extractos.

## Traducción de Markdown

Usa la Command Palette:

- `Translate current Markdown file and append translation`
- `Translate current Markdown file with interleaved translation`

Para traducción por lotes, las rutas son relativas al vault, no rutas absolutas.

```text
Books/Example/
Books/Example/Chapter 1.md
Books/Example/*.md
Books/Example/**/*.md
```

## Privacidad

Este complemento no es un traductor offline. Según el backend elegido, el texto seleccionado o el contenido Markdown puede enviarse a Codex, Claude Code, OpenAI API o Anthropic API. Las API keys se guardan en la configuración local de Obsidian.

## License

MIT


## Novedades de 1.1.0: vídeos locales y chat con IA

Ejecuta **Open local video** en la paleta de comandos y elige un archivo o pega su ruta absoluta. Puede estar fuera de la bóveda. Comparte con YouTube la reproducción, los saltos por frase, los subtítulos bilingües, la caché de traducción, la pantalla completa dentro de la ventana, las capturas y la exportación de notas.

- Detecta archivos como `lesson.srt`, `lesson.en.srt` y `lesson.zh.vtt`. SRT/VTT no requieren herramientas externas. Los subtítulos de texto incrustados necesitan **ffmpeg y ffprobe**; ASS/SSA necesitan ffmpeg. Elige la pista con **Subtitle track**.
- **Create transcript note** guarda el original y las traducciones disponibles en una página Markdown. Las marcas de tiempo vuelven al punto correspondiente del vídeo. Si mueves el archivo original, tendrás que actualizar los enlaces.
- Sin subtítulos, el botón del micrófono permite transcribir con Groq/OpenAI Whisper previamente configurado. Esta acción envía audio; abrir el vídeo no lo envía. No se extraen como texto los subtítulos gráficos o incrustados en la imagen. La reproducción depende del códec; se recomiendan MP4 H.264/AAC o WebM.

Pulsa **AI help** arriba a la derecha del panel de subtítulos de un vídeo local o de YouTube. Usa **Summarize video**, **Explain this moment** o escribe preguntas y continúa la conversación. Las marcas de tiempo de las respuestas permiten navegar; **Save chat to note** exporta la conversación.

La IA recibe subtítulos, posición, conversación reciente y las imágenes seleccionadas: el fotograma actual, seis fotogramas repartidos por el vídeo o solo subtítulos. No ve cada fotograma ni escucha todo el audio. Los resúmenes de transcripciones largas procesan todos los fragmentos; las preguntas normales pueden usar solo extractos relevantes. Se indican los fallos de captura y la cobertura parcial. Las imágenes anteriores no se adjuntan de nuevo.

Se utiliza el proveedor de IA configurado. **Video chat Codex model** cambia solo el modelo del chat; vacío hereda el de traducción. Elige un modelo disponible para tu cuenta y con visión si envías imágenes. Codex/Claude utilizan la sesión de la CLI local; OpenAI/Anthropic, las claves API. Al enviar una pregunta se envían las pruebas a ese servicio. **Stop** detiene solo el chat; una petición API ya enviada puede terminar en el servidor.

El historial se guarda localmente por vídeo: los 100 vídeos más recientes, hasta 200 mensajes cada uno. Cada consulta reenvía hasta 30 mensajes recientes y 24.000 caracteres de texto. No hay resumen automático de conversaciones antiguas. Las imágenes no se guardan en el historial. **Clear chat** borra esa conversación, pero conserva las notas exportadas. Mantén privado `data.json`, que contiene ajustes e historial.
