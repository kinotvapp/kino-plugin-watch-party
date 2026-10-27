# Fiesta

[English](README.md) · [Para desarrolladores (en inglés)](DEVELOPERS.md)

<img src="icon.png" width="96" alt="Ícono de Fiesta" align="right">

Un plugin de [Kino](https://github.com/kinotvapp/kino-light) para **ver juntos**, cada quien en su aparato: una pestaña
**Fiesta** en el reproductor con chat, ocho reacciones rápidas y el video al mismo paso que el del anfitrión. La sala vive
en el aparato de quien la crea y se llega a ella por el túnel propio de Kino: sin cuenta, sin registro y sin ningún
servidor nuestro.

- **Chat**: texto plano (hasta 300 caracteres) y ocho reacciones rápidas (👍 😂 😮 😢 ❤️ 🔥 👏 🍿). Sin imágenes,
  archivos, enlaces ni formato: un enlace en un mensaje es solo texto.
- **Sincronizado**: el anfitrión manda. Cuando pausa, reanuda o salta, el video de todos lo sigue. Quien pausa por su
  cuenta deja de seguirlo hasta tocar **Volver a sincronizar**.
- **Invitar es fácil**: la sala tiene unas **palabras** (su dirección) y un **código de 4 números**. Compártelos de
  palabra, con un código QR o con **Copiar invitación**, un texto listo para pegar en cualquier chat.
- **Entrar es fácil**: pega la invitación entera en el formulario, toca **Leer la invitación**, revisa lo que encontró y
  toca **Entrar**. O escanea el código QR del anfitrión.
- **Celular + TV**: mira en la TV y chatea desde el celular. La TV entra como un asiento de solo reacciones vinculado a tu
  celular.
- **Nadie es imprescindible**: si el anfitrión se va, la sala sigue con la siguiente persona, por una puerta de respaldo.
- Hasta **8 aparatos** por sala. Una sala dura como máximo 4 horas.

## Capturas

<!-- Por agregar antes de publicar, en screenshots/:
  1-create-phone.jpg     la pestaña Fiesta antes de crear la sala (nombre, Crear sala, Unirme a una sala)
  2-room-phone.jpg       la pestaña Sala del anfitrión: palabras, código, QR, Copiar invitación
  3-chat-phone.jpg       el chat con algunos mensajes y reacciones
  4-join-paste.jpg       el formulario después de Leer la invitación («Vas a entrar a: … · código …»)
  5-pinned-tv.jpg        el panel fijado junto al video en una TV
-->
_Muy pronto._

## Instalar

Necesita una versión de Kino con pestañas de plugin en el reproductor (`apiVersion` 14 del plugin); un Kino más viejo
dice «Este plugin necesita una versión más nueva de Kino».

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
- otro plugin: la pestaña dice qué plugin usa la sala («Esta sala usa «…»: abre el título con ese plugin»); necesitas ese
  plugin instalado;
- un título cuyo plugin no da identificador de TMDB ni de IMDb, un canal en vivo o un video que no viene de un plugin:
  solo chat, sin sincronizar.

## Organizar una fiesta

1. Reproduce el título, abre el panel y la pestaña **Fiesta**.
2. Escribe **Tu nombre** (lo que ven los demás) y toca **Crear sala**. Abrir una sala tarda unos segundos («Creando la
   sala…»).
3. La pestaña **Sala** muestra las **palabras** de la sala, su **código de 4 números** y un **código QR** con los dos.
4. Invita: dile a tus amigos las palabras y el código, deja que escaneen el QR o toca **Copiar invitación** (solo en el
   celular) y pégala en cualquier chat. **Copiar solo el código** copia solo el código.
5. **Fija el panel** (mira abajo) y dale play. Quienes entren siguen tu reproducción.

La invitación es texto plano, sin ningún enlace, por ejemplo:

```
Únete a mi fiesta en Kino 🎬
Película: Dune (2021), con «Mi plugin»
Palabras: amber-river-candle
Código: 4821
En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ Unirme.
(Join my Kino watch party: words + code above.)
```

Lleva el título con su año (y la temporada y el episodio), el nombre del plugin, las palabras y el código. Nada más: ni la
dirección de tu aparato ni identificadores. Kino dice «Copiado» y la deja fuera de las vistas previas del portapapeles. En
la TV no hay botón para copiar (Kino no puede copiar ahí).

## Unirse a una fiesta

1. Reproduce **el mismo título con el mismo plugin**, abre el panel y la pestaña **Fiesta**, escribe tu nombre y toca
   **Unirme a una sala**.
2. Luego:
   - **pega la invitación** que te llegó en **Pega aquí la invitación** (o directo en el campo de las palabras) y toca
     **Leer la invitación**. La pestaña muestra lo que encontró («Vas a entrar a: amber-river-candle · código 4821»). Si no
     puede saberlo («No encuentro las palabras o el código»), lo dice en vez de adivinar;
   - escribe las **palabras** y el **código**;
   - o toca **Escanear el código QR** y apunta la cámara al QR del anfitrión.
3. Toca **Entrar** («Uniéndose a la sala…»). Nada entra hasta que lo tocas.

Pegar funciona aunque la app de chat haya cambiado el texto: negritas, emojis, saltos de línea, mayúsculas o números de
ancho completo. Un año entre paréntesis nunca cuenta como código.

## Celular + TV

En la TV, abre la pestaña **Fiesta** y elige **Vincular con mi teléfono**: la TV muestra un código QR que sirve una sola
vez y por 5 minutos. En el celular, dentro de la sala, toca **Agregar dispositivo** y escanea el código de **tu propia**
TV. La TV entra con una pulsación: reproduce el video, sigue al anfitrión, muestra el chat y puede enviar las ocho
reacciones (escribir queda en el celular). La lista de personas te muestra una sola vez, con 📱 📺. Si el celular sale, la
TV se queda (solo reacciones) y puede vincular otro celular.

## Deja la pestaña fijada

Una pestaña solo corre mientras el panel está abierto en ella. Si cierras el panel o cambias de pestaña, la fiesta se
detiene en ese aparato: sin chat, sin sincronizar, y un anfitrión deja de enviar su posición (los demás esperan). Por eso:

- **Fija el panel** (**Fijar**): se acomoda junto al video (el tercio derecho en una TV o en un celular de lado, debajo del
  video en un celular vertical) y sigue corriendo mientras ves. La pestaña tiene un diseño angosto hecho para eso.
- **¿Te fuiste más de 2 minutos?** El anfitrión saca a quien no ha oído en 2 minutos. Al volver, la pestaña dice
  «Estuviste fuera un rato y la sala te sacó» y **un botón** te vuelve a entrar.
- **5 minutos en segundo plano** y Kino cierra las salas de ese aparato.

## Permisos, en palabras sencillas

Lo que Kino muestra al instalar, y qué quiere decir cada línea aquí:

| Kino dice | Qué quiere decir para este plugin |
| --- | --- |
| **Su pestaña en el reproductor verá lo que estás viendo (título, año, identificadores y posición) mientras la tengas abierta, y podrá enviarlo a sus servicios** (en rojo) | La pestaña lee el título que reproduces, su año, sus identificadores de TMDB/IMDb y tu posición, solo mientras está abierta. Los envía a **las personas de tu sala** (el título de la sala y la posición del anfitrión), para que todos vean lo mismo al mismo paso. No tiene ningún otro servicio. Interruptor: **Mostrar en el reproductor**. |
| **Podrá pausar, reanudar y mover tu video por sí solo** (en rojo) | La pestaña de un invitado sigue al anfitrión: pausa, reanuda, salta y cambia la velocidad. Kino anuncia cada una de esas acciones («Fiesta: pausado»), las ignora mientras adelantas o hay un diálogo de Kino abierto, y permite como máximo 30 por minuto. Solo los mensajes del anfitrión mueven el video de alguien. Interruptor: **Dejar que pause y mueva mi video** (sin él puedes seguir chateando). |
| **Podrá abrir una sala a la que se entra por internet a través de este aparato, y enviar los mensajes de la sala a quienes entren** (en rojo) | **Crear sala** abre una sala en tu aparato, a la que se llega por el túnel de Kino, y el chat, el título y la reproducción van a quienes entren. Unirse a la sala de otra persona pasa por la suya. Una sala se abre o se une solo cuando tocas un botón. Interruptor: **Dejar que abra salas por internet**. |
| (sin línea) escanear con la cámara | **Escanear el código QR** y **Agregar dispositivo** abren **el escáner propio de Kino**, solo cuando los tocas; el plugin recibe solo el texto del código. |

Cada permiso en rojo se puede apagar después en la pestaña del plugin en Ajustes de Kino, sin desinstalarlo. El manifiesto
declara el sitio de la documentación (`kinotvapp.github.io`) solo porque todo plugin declara uno: el plugin nunca descarga
nada.

## Privacidad y seguridad

- **El código de 4 números deja fuera a los extraños, nada más.** Las palabras son la dirección y no se pueden adivinar; el
  código frena a quien tiene las palabras pero no el código. Adivinar solo funciona en línea: Kino bloquea las entradas un
  rato después de 5 códigos equivocados y **cierra la sala después de 30 intentos fallidos**.
- **El chat no es privado frente al proveedor del túnel.** La sala viaja por un túnel de terceros; con un código de 4
  números, quien capture ese tráfico y conozca las palabras puede sacar el código en un momento. Mantén el chat liviano:
  nunca contraseñas, direcciones ni nada sensible.
- **Quien tiene el código es de confianza para la sala**: puede chatear, reaccionar, tener una puerta de respaldo y, si el
  anfitrión se va, ser el anfitrión (y entonces mover el video de quienes lo siguen, dentro de los límites de Kino).
- **Agregar dispositivo le envía las palabras y el código de la sala a la TV que escaneas.** Escanea solo tu propia TV.
- **Tu identidad la pone Kino.** Nadie puede escribir como otra persona: un mensaje nunca dice quién lo manda, lo dice
  Kino. Los nombres se limpian de caracteres invisibles o engañosos, y los nombres iguales se numeran («Bea (2)»).
- **Se guarda en tu aparato solo mientras vive la sala**: el código y el chat (como máximo 200 mensajes) en el almacenamiento
  del plugin, que vence con la sala. El código y una invitación pegada nunca se escriben en un registro, y un código
  escrito en un mensaje se tapa («••••»).
- **Sin cuenta y sin servidor nuestro.** El túnel de Kino y los aparatos de la sala son los únicos lugares a los que van los
  datos de la sala.
- Al quitar el plugin se borra lo que guardó.

## Problemas comunes

- **«Ese código no es el de la sala»**: revisa los 4 números. Después de 5 intentos equivocados Kino te hace esperar un
  momento; después de 30 la sala se cierra y el anfitrión debe crear otra.
- **«No se pudo llegar a la sala»**: el aparato del anfitrión puede estar sin internet, dormido o con Kino en segundo plano
  hace más de 5 minutos. Pregúntale y toca **Reintentar**.
- **«La sala está llena»**: 8 aparatos como máximo (una TV vinculada cuenta como uno).
- **El video no sigue**: revisa que reproduces el mismo título con el mismo plugin, que **Seguir al anfitrión** está
  encendido y que **Dejar que pause y mueva mi video** está encendido en Ajustes. **Sincronizar** le pregunta al anfitrión
  ya mismo.
- **«El anfitrión no responde»**: puede ser tu conexión o la suya. **Reintentar** prueba primero con el anfitrión y solo
  después con las puertas de respaldo.
- **La fiesta se detuvo al cerrar el panel**: fija el panel (mira arriba).
- **«La Fiesta necesita las pantallas de plugins activas en Ajustes»**: activa las pantallas de plugins en Ajustes de Kino.

## Licencia

[Apache License 2.0](LICENSE). Ver [NOTICE](NOTICE).

Repositorio: [kinotvapp/kino-plugin-watch-party](https://github.com/kinotvapp/kino-plugin-watch-party)
(remoto `git@github.com-kinotvapp:kinotvapp/kino-plugin-watch-party.git`). Tema de GitHub: `kino-plugin` (la búsqueda de
la comunidad de Kino encuentra el plugin por él).
