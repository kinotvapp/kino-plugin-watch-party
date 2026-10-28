// Texts (Kino-first: every text has its Spanish base and English twin) and the room errors as people read them.

import { codeOf } from "../util/text.js";

export const T = {
  title: ["Party Chat", "Party Chat"],
  yourName: ["Tu nombre", "Your name"],
  create: ["Crear sala", "Create room"],
  words: ["Palabras de la sala", "Room words"],
  enter: ["Entrar", "Join"],
  scanTitle: ["Escanea el código de la sala", "Scan the room's code"],
  linkStart: ["Vincular con mi teléfono", "Link with my phone"],
  linkInfo: ["En el teléfono, en la sala: «Agregar dispositivo» y escanea. Sirve una vez.", "On the phone, in the room: “Add device” and scan. It works once."],
  linkCancel: ["Cancelar", "Cancel"],
  addDevice: ["Agregar dispositivo", "Add device"],
  addDeviceTitle: ["Escanea el código que muestra TU televisor", "Scan the code YOUR TV shows"],
  message: ["Mensaje", "Message"],
  follow: ["Seguir al anfitrión", "Follow the host"],
  leave: ["Salir de la sala", "Leave the room"],
  leaveConfirm: ["¿Salir de la sala?", "Leave the room?"],
  chatTab: ["Chat", "Chat"],
  roomTab: ["Sala", "Room"],
  inviteInfo: ["Comparte el código o el QR. Solo deja afuera a extraños: no compartas nada sensible.", "Share the code or the QR. It only keeps strangers out: share nothing sensitive."],
  openBackup: ["Abrir puerta de respaldo", "Open a backup door"],
  backupInfo: ["Si el anfitrión se va, la sala sigue en una puerta de respaldo.", "If the host leaves, the room goes on through a backup door."],
  empty: ["Todavía no hay mensajes.", "No messages yet."],
  members: ["Personas", "People"],
  noScreens: ["Party Chat necesita las pantallas de plugins activas en Ajustes.", "Party Chat needs plugin screens switched on in Settings."],
  openTitle: ["Abrir este título", "Open this title"],
  resync: ["Volver a sincronizar", "Sync again"],
  retry: ["Reintentar", "Try again"],
  findRoom: ["Buscar la sala", "Look for the room"],
  hostMark: ["anfitrión", "host"],
  back: ["Atrás", "Back"],
};
export const tx = (k) => ({ es: T[k][0], en: T[k][1] });
export const both = (es, en) => ({ es, en });

export function errorText(e) {
  if (e && typeof e.userMessage === "string" && e.userMessage) return both(e.userMessage, e.userMessage);
  switch (codeOf(e)) {
    case "room_denied": return both("Ese código no es el de la sala", "That is not the room's code");
    case "room_closed": return both("La sala ya se cerró", "The room is closed");
    case "room_full": return both("La sala está llena", "The room is full");
    case "room_unreachable": return both("No se pudo llegar a la sala. Revisa la conexión.", "The room could not be reached. Check the connection.");
    case "room_busy": return both("Este aparato ya está en otras salas", "This device is already in other rooms");
    case "rate_limited": return both("Demasiados intentos: espera un momento", "Too many tries: wait a moment");
    case "permission_denied": return both("Party Chat no tiene permiso para salas: revísalo en Ajustes", "Party Chat may not use rooms: check it in Settings");
    default: return both("Algo salió mal con la sala", "Something went wrong with the room");
  }
}
