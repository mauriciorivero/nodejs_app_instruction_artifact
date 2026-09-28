# Construyendo Persona API

Presentación interactiva, sin build ni dependencias de servidor, que enseña paso a paso cómo construir una API REST de "Persona" con **Node.js**, **Express** y **MySQL**, siguiendo una arquitectura en capas (routes → controllers → services → models → MySQL).

Es un único sitio estático: se abre `index.html` directamente en el navegador (o se sirve con cualquier servidor estático) y no requiere `npm install`, backend propio ni conexión a internet.

## Qué hace

- Recorre ~25 pasos (26 diapositivas contando subdivisiones) desde crear la carpeta del proyecto hasta probar los endpoints con Postman/curl y cerrar el servidor.
- Cada paso combina una explicación narrada, comandos de terminal a ejecutar y/o un editor de código de solo lectura con resaltado de sintaxis.
- Una franja superior ("recorrido de una petición") y un diagrama de arquitectura muestran visualmente por qué capas pasa una petición HTTP (Cliente → Express → routes → controllers → services → models → MySQL), con `utils/` y `middleware/` como capas transversales.
- Un fondo animado en `<canvas>` (three.js) dibuja ese recorrido y anima "paquetes" viajando entre capas a medida que avanza la presentación.
- Un personaje mascota ("Bit") narra el punto clave de cada paso en una burbuja de texto.
- Incluye índice navegable, barra de progreso, tema claro/oscuro persistente, botones de copiar código y navegación por teclado (`←` `→`, espacio, `Inicio`/`Fin`, `i` para el índice).
- Todo el contenido está en español.

El código de `persona-api` que se muestra en las diapositivas (routes, controllers, services, models, config, middleware, utils, `database.sql`, `package.json`, etc.) vive embebido como datos en [js/code-files.js](js/code-files.js); no es un proyecto Node.js ejecutable en este repositorio, sino el material de referencia que la presentación explica y muestra con resaltado de sintaxis.

## Cómo usarlo

Simplemente abre `index.html` en un navegador moderno:

```bash
open index.html        # macOS
# o sirve la carpeta con cualquier servidor estático, por ejemplo:
python3 -m http.server 8000
```

No hay paso de build ni instalación de dependencias: todas las librerías de terceros (three.js, highlight.js) y las fuentes (Geist) están vendorizadas en el propio repositorio.

## Estructura del proyecto

```
index.html          Documento único de la presentación (estructura y contenedores)
css/
  styles.css         Todos los estilos, temas claro/oscuro y animaciones
js/
  code-files.js      Código fuente de persona-api mostrado en los editores de las diapositivas
  slides.js          Contenido y datos de cada diapositiva (texto, comandos, diagramas, narración de Bit)
  scene.js           Motor de animación 2D sobre three.js para el fondo y el recorrido de la petición
  app.js             Construye las diapositivas, maneja navegación, teclado, tema, copiar código e índice
vendor/
  three.min.js       three.js (animaciones de fondo)
  highlight.min.js    highlight.js (resaltado de sintaxis en los editores)
fonts/
  Geist-Variable.woff2, GeistMono-Variable.woff2   Tipografías Geist usadas en la interfaz
```

## Contenido enseñado (API de ejemplo)

La API de ejemplo que explican las diapositivas es un CRUD de `Persona` (`id`, `firstname`, `lastname`, `age`, `datebirth`) construido con:

- **Express** para el servidor HTTP y el enrutamiento
- **MySQL** (vía `mysql2/promise` y un pool de conexiones) como persistencia
- **dotenv** para variables de entorno, **cors** y **morgan** como middlewares
- Una arquitectura en capas: `routes/` → `controllers/` → `services/` → `models/`, con `config/` (Express + conexión a base de datos + entorno), `middleware/` (manejo centralizado de errores) y `utils/` (validadores, constantes, mensajes de error, formateo de fechas) como soporte transversal
- Buenas prácticas como clases con campos privados (`Persona`), errores operacionales tipados (`AppError`), y consultas preparadas para evitar inyección SQL

## Licencias de terceros

- three.js — ver [vendor/LICENSE-three.txt](vendor/LICENSE-three.txt)
- highlight.js — ver [vendor/LICENSE-highlightjs.txt](vendor/LICENSE-highlightjs.txt)
- Geist (fuentes) — ver [fonts/LICENSE-Geist.txt](fonts/LICENSE-Geist.txt)
