# Fiesta

[English](README.md) · [Para desarrolladores (en inglés)](DEVELOPERS.md)

<img src="icon.png" width="96" alt="Ícono de Fiesta" align="right">

Un plugin de [Kino](https://github.com/kinotvapp/kino-light) para **ver juntos**, cada quien en su aparato: una pestaña
**Fiesta** en el reproductor con chat, ocho reacciones rápidas y el video al mismo paso que el del anfitrión. La sala vive
en el aparato de quien la crea y se llega a ella por el túnel propio de Kino. No hay cuenta ni registro. El único servicio
de afuera es un pequeño servicio de códigos cortos del autor del plugin (mira [Privacidad y seguridad](#privacidad-y-seguridad)).

- **Un código de 5 números para entrar**: el anfitrión recibe un código corto como **41 408**. Los invitados escriben esos
  5 números o escanean el código QR del anfitrión.
- **Un chat que se ve como un chat**: tus mensajes a la derecha, los de los demás a la izquierda con su nombre. Texto
  plano (hasta 300 caracteres) y ocho reacciones rápidas (👍 😂 😮 😢 ❤️ 🔥 👏 🍿). Sin imágenes, archivos, enlaces ni
  formato: un enlace en un mensaje es solo texto.
- **Sincronizado**: el anfitrión manda. Cuando pausa, reanuda o salta, el video de todos lo sigue. Quien pausa por su
  cuenta deja de seguirlo hasta tocar **Volver a sincronizar**.
- **Celular + TV**: mira en la TV y chatea desde el celular. La TV entra como un asiento de solo reacciones vinculado a tu
  celular.
- **Nadie es imprescindible**: si el anfitrión se va, la sala sigue con la siguiente persona, por una puerta de respaldo.
- Hasta **8 aparatos** por sala. Una sala dura como máximo 4 horas.

## Capturas

<!-- Por capturar antes de publicar, en screenshots/:
  1-home-phone.jpg       la pestaña Fiesta antes de crear la sala (Crear sala, Unirme a sala)
  2-join-code-phone.jpg  el paso para unirse: Código de la sala (5 números) y Siguiente
  3-room-phone.jpg       la pestaña Sala del anfitrión: «Sala: 41 408» con el ícono de copiar, personas, QR
  4-chat-phone.jpg       el chat con burbujas, una reacción y el campo con su ícono de enviar
  5-pinned-tv.jpg        el panel fijado junto al video en una TV
-->
_Muy pronto._

## Instalar

Necesita una versión de Kino compatible con la `apiVersion` 14 de los plugins (pestañas de plugin en el reproductor). Un
Kino más viejo dice «Este plugin necesita una versión más nueva de Kino».

1. En el celular, abre **Menú ▸ Plugins** y toca **+** (Agregar plugin). En la TV, abre **Plugins** y elige **Agregar
   plugin**.
2. Deja el tipo en **Kino**. En **Dirección del plugin**, escribe `kinotvapp/kino-plugin-watch-party` y toca **Agregar**.
3. Kino muestra **Instalar Fiesta**. Toca **Ver detalles**, lee las líneas (abajo te explicamos cada una) y toca
   **Instalar**.
4. Reproduce cualquier título de cualquier plugin y abre el panel del reproductor: ahí está la pestaña **Fiesta**.

Todas las personas de la fiesta necesitan el plugin instalado. Está **firmado por su autor** («Firmado por su autor» en la
hoja de instalación): Kino comprueba que cada actualización venga firmada con la misma clave.

## Antes de empezar: el mismo plugin, el mismo título

Todos deben reproducir **el mismo título con el mismo plugin de contenido** (la misma película o el mismo episodio). El
mismo plugin quiere decir el mismo corte y el mismo archivo, así las posiciones coinciden. Si no:

- otro título: la pestaña ofrece **Abrir este título**, la página de Kino de ese título, donde eliges tu fuente;
- otro plugin: la pestaña dice qué plugin usa la sala; necesitas ese plugin instalado;
- un título cuyo plugin no da identificador de TMDB ni de IMDb, un canal en vivo o un video que no viene de un plugin:
  solo chat, sin sincronizar.

## Organizar una fiesta

1. Reproduce el título, abre el panel y la pestaña **Fiesta**, y toca **Crear sala**. La primera vez te pregunta
   **¿Cómo te llamas?** (lo que ven los demás) y lo recuerda.
2. Abrir una sala tarda unos segundos. La sala abre en el chat, y la pestaña **Sala** empieza con una línea:
   **Sala: 41 408**.
3. Invita: diles los 5 números a tus amigos, deja que escaneen el QR de la pestaña **Sala** o toca el ícono de copiar al
   final de esa línea (solo en el celular) para copiar una invitación para cualquier chat.
4. **Fija el panel** (mira abajo) y dale play. Quienes entren siguen tu reproducción.

La invitación es texto plano, sin ningún enlace, por ejemplo:

```
Únete a mi fiesta en Kino 🎬
Película: Dune (2021), con «Mi plugin»
Código: 41408
En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ Unirme.
(Join my Kino watch party: code above.)
```

Lleva el título con su año (y la temporada y el episodio), el nombre del plugin y el código. Nada más: ni la dirección de
tu aparato ni identificadores. Kino dice «Copiado» y la deja fuera de las vistas previas del portapapeles. En la TV no hay
botón para copiar (Kino no puede copiar ahí).

Si el servicio de códigos cortos no responde, la sala igual abre: la pestaña dice que no pudo crear el código y ofrece
**Obtener un código**. Mientras tanto el QR funciona, y **Opciones avanzadas** en la pestaña Sala muestra las palabras de
la sala y su código de 12 números para **Entrar con palabras y código**.

## Unirse a una fiesta

1. Reproduce **el mismo título con el mismo plugin**, abre el panel y la pestaña **Fiesta**, y toca **Unirme a sala**.
2. Escribe el **Código de la sala** (5 números; los espacios y guiones no importan) y toca **Siguiente**. Primero se
   revisa el código; después, la primera vez, te pregunta tu nombre.
3. Otras formas de entrar, desde el mismo paso: **Pegar invitación** y **Escanear QR** en el celular, **Vincular con mi
   teléfono** en la TV, y **Entrar con palabras y código**.

Cada paso después del primero tiene **Atrás**, y nada entra hasta que tocas un botón. Una invitación pegada funciona
aunque la app de chat la haya cambiado: negritas, emojis, saltos de línea o números de ancho completo.

## El chat

- Los mensajes llenan la pestaña, el más nuevo abajo: los tuyos a la derecha, los de los demás a la izquierda con su nombre
  una vez sobre cada tanda. Una reacción se ve como un emoji más grande, y los avisos de la sala («Bea entró») como líneas
  pequeñas centradas.
- Envía con el **ícono de enviar dentro del campo de texto** o con el botón de enviar de tu teclado.
- Las ocho reacciones están escondidas detrás del **botón de emojis** junto al campo. Tócalo para verlas; al elegir una se
  envía y se vuelven a esconder.
- Como mucho 5 mensajes cada 10 segundos por persona.

## En la TV

- En la TV no hay portapapeles ni cámara: no se puede pegar, escanear ni copiar.
- Los campos usan la entrada de texto de Kino para TV, y el paso del código usa un teclado de números.
- El control remoto nunca se pierde:
  - al crear o entrar a una sala queda en el campo de texto del chat;
  - desde el campo, Derecha llega al ícono de enviar y luego al botón de emojis;
  - después de enviar o reaccionar vuelve al campo;
  - un error lo deja en **Reintentar**;
  - una pantalla como «El anfitrión no responde» lo deja en su botón principal.

## Celular + TV

En la TV, abre la pestaña **Fiesta**, toca **Unirme a sala** y elige **Vincular con mi teléfono**. La TV muestra un código
QR que sirve una sola vez y por 5 minutos. En el celular, dentro de la sala, toca **Agregar dispositivo** y escanea el
código de **tu propia** TV. La TV entra con una pulsación: reproduce el video, sigue al anfitrión, muestra el chat y puede
enviar las ocho reacciones (escribir queda en el celular). La lista de personas te muestra una sola vez, con 📱 📺. Si el
celular sale, la TV se queda (solo reacciones) y puede vincular otro celular.

## Deja la pestaña fijada

Una pestaña solo corre mientras el panel está abierto en ella. Si cierras el panel o cambias de pestaña, la fiesta se
detiene en ese aparato: sin chat, sin sincronizar, y un anfitrión deja de enviar su posición (los demás esperan). Por eso:

- **Fija el panel** (**Fijar**): se acomoda junto al video (el tercio derecho en una TV o en un celular de lado, debajo del
  video en un celular vertical) y sigue corriendo mientras ves.
- **¿Te fuiste más de 2 minutos?** El anfitrión saca a quien no ha oído en 2 minutos. Al volver, la pestaña dice
  «Estuviste fuera un rato y la sala te sacó» y **un botón** te vuelve a entrar.
- **5 minutos en segundo plano** y Kino cierra las salas de ese aparato.

## Permisos, en palabras sencillas

Lo que Kino muestra al instalar, y qué quiere decir cada línea aquí:

| Kino dice | Qué quiere decir para este plugin |
| --- | --- |
| **Su pestaña en el reproductor verá lo que estás viendo (título, año, identificadores y posición) mientras la tengas abierta, y podrá enviarlo a sus servicios** (en rojo) | La pestaña lee el título que reproduces, su año, sus identificadores de TMDB/IMDb y tu posición, solo mientras está abierta. Los envía a **las personas de tu sala** (el título de la sala y la posición del anfitrión), para que todos vean lo mismo al mismo paso. Interruptor: **Mostrar en el reproductor**. |
| **Podrá pausar, reanudar y mover tu video por sí solo** (en rojo) | La pestaña de un invitado sigue al anfitrión: pausa, reanuda, salta y cambia la velocidad. Kino anuncia cada una de esas acciones («Fiesta: pausado»), las ignora mientras adelantas o hay un diálogo de Kino abierto, y permite como máximo 30 por minuto. Solo los mensajes del anfitrión mueven el video de alguien. Interruptor: **Dejar que pause y mueva mi video** (sin él puedes seguir chateando). |
| **Podrá abrir una sala a la que se entra por internet a través de este aparato, y enviar los mensajes de la sala a quienes entren** (en rojo) | **Crear sala** abre una sala en tu aparato, a la que se llega por el túnel de Kino, y el chat, el título y la reproducción van a quienes entren. Unirse a la sala de otra persona pasa por la suya. Una sala se abre o se une solo cuando tocas un botón. Interruptor: **Dejar que abra salas por internet**. |
| (sin línea) escanear con la cámara | **Escanear QR** y **Agregar dispositivo** abren **el escáner propio de Kino**, solo cuando los tocas; el plugin recibe solo el texto del código. |
| El sitio `url-code.kinotv.workers.dev` | El servicio de códigos cortos, la única dirección a la que llega el plugin (mira abajo). |

Cada permiso en rojo se puede apagar después en la pestaña del plugin en Ajustes de Kino, sin desinstalarlo.

## Privacidad y seguridad

- **El servicio de códigos cortos.** `url-code.kinotv.workers.dev` lo maneja el autor del plugin.
  - **Qué recibe:** al crear una sala, el aparato del anfitrión le envía la dirección de la sala (sus palabras y su
    código de sala de 12 números) y recibe un código de 5 números. El aparato de un invitado le envía los 5 números y
    recibe esa dirección.
  - **Cuánto la guarda:** un código dura como máximo **8 horas**. Cuando el anfitrión sale de la sala, el plugin le pide
    al servicio que borre el código en ese momento. Si es Kino el que cierra la sala, el plugin no puede pedirlo, y el
    límite de 8 horas lo cubre.
  - **Qué puede ver:** las direcciones IP del anfitrión y de los invitados que consultan un código, y la dirección de la
    sala.
  - El servicio limita cuántas veces puede preguntar cada dirección IP.
- **El código de 5 números es el único secreto.** Quien lo tenga, o adivine uno válido, puede entrar a la sala mientras el
  código viva. Compártelo solo con quienes quieres en la sala.
- **El chat no es privado.** La sala viaja por un túnel de terceros, y el servicio guarda la dirección de la sala. Mantén
  el chat liviano: nunca contraseñas, direcciones ni nada sensible.
- **Quien tiene el código es de confianza para la sala**: puede chatear, reaccionar, tener una puerta de respaldo y, si el
  anfitrión se va, ser el anfitrión (y entonces mover el video de quienes lo siguen, dentro de los límites de Kino).
- **Agregar dispositivo le envía las palabras y el código de la sala a la TV que escaneas.** Escanea solo tu propia TV.
- **Tu identidad la pone Kino.** Nadie puede escribir como otra persona: un mensaje nunca dice quién lo manda, lo dice
  Kino. Los nombres se limpian de caracteres invisibles o engañosos, y los nombres iguales se numeran («Bea (2)»).
- **Se guarda en tu aparato solo mientras vive la sala**: los códigos y el chat (como máximo 200 mensajes), en el
  almacenamiento del plugin, que vence con la sala. Los códigos y una invitación pegada nunca se escriben en un registro, y
  un código escrito en un mensaje se tapa («••••»).
- Al quitar el plugin se borra lo que guardó.

## Problemas comunes

- **«Ese código no existe o ya venció»**: revisa los 5 números con el anfitrión. Un código dura como máximo 8 horas y deja
  de servir cuando el anfitrión sale de la sala.
- **«No pude consultar el código; reintenta»**: el servicio de códigos cortos no respondió. Toca **Reintentar**, o pídele
  al anfitrión el QR, o las palabras y el código de **Opciones avanzadas** (**Entrar con palabras y código**).
- **«No se pudo llegar a la sala»**: el aparato del anfitrión puede estar sin internet, dormido o con Kino en segundo plano
  hace más de 5 minutos. Pregúntale y toca **Reintentar**.
- **«La sala está llena»**: 8 aparatos como máximo (una TV vinculada cuenta como uno).
- **El video no sigue**: revisa que reproduces el mismo título con el mismo plugin, que **Seguir al anfitrión** (en la
  pestaña Sala) está encendido y que **Dejar que pause y mueva mi video** está encendido en Ajustes. El ícono de
  **Sincronizar** arriba le pregunta al anfitrión ya mismo.
- **«El anfitrión no responde»**: puede ser tu conexión o la suya. **Reintentar** prueba primero con el anfitrión y solo
  después con las puertas de respaldo.
- **La fiesta se detuvo al cerrar el panel**: fija el panel (mira arriba).
- **«La Fiesta necesita las pantallas de plugins activas en Ajustes»**: activa las pantallas de plugins en Ajustes de Kino.

## Licencia

[Apache License 2.0](LICENSE). Ver [NOTICE](NOTICE).

Repositorio: [kinotvapp/kino-plugin-watch-party](https://github.com/kinotvapp/kino-plugin-watch-party)
(remoto `git@github.com-kinotvapp:kinotvapp/kino-plugin-watch-party.git`). Tema de GitHub: `kino-plugin` (la búsqueda de
la comunidad de Kino encuentra el plugin por él).
