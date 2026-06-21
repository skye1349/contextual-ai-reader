# Contextual AI Reader en Español

[English](https://github.com/skye1349/contextual-ai-reader/blob/main/README.md) · [中文](https://github.com/skye1349/contextual-ai-reader/blob/main/README.zh-CN.md) · [日本語](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ja.md) · [한국어](https://github.com/skye1349/contextual-ai-reader/blob/main/README.ko.md) · [Français](https://github.com/skye1349/contextual-ai-reader/blob/main/README.fr.md) · [Deutsch](https://github.com/skye1349/contextual-ai-reader/blob/main/README.de.md)

Contextual AI Reader es un complemento de escritorio para Obsidian pensado para lectura asistida: traducción, explicación de vocabulario en contexto, lectura en voz alta, notas de extractos, PDF seleccionables y traducción de archivos Markdown.

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

- `Auto`: usa Codex local primero y Claude Code como alternativa.
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

- `Translate current Markdown file: append target language below`
- `Translate current Markdown file: interleave target-language paragraphs`

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
