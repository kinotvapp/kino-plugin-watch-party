// The title and the source plugin a room watches (or its En vivo channel), and whether this device watches the same (pure).

import { isInt, isObj, scrub } from "../util/text.js";

/** An En vivo channel as Kino names it (`ctx.channel`, `go.liveChannel`): its provider plugin's id and its id there, its name. */
export function channelOf(c) {
  if (!isObj(c) || typeof c.provider !== "string" || typeof c.code !== "string") return null;
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(c.provider) || c.provider === "own" || !/^[A-Za-z0-9._~-]{1,128}$/.test(c.code)) return null;
  return { provider: c.provider, code: c.code, name: scrub(typeof c.name === "string" ? c.name : "", 80) };
}

/**
 * What the room carries about the title, from a panel context; null when the playing video is not a plugin's title. On an En
 * vivo channel (`ctx.live`): the channel, with no ids (live has no position to share).
 */
export function mediaOf(ctx) {
  if (isObj(ctx) && ctx.live === true) {
    const channel = channelOf(ctx.channel);
    if (!channel) return null;
    const name = isObj(ctx.source) && typeof ctx.source.name === "string" ? ctx.source.name : "";
    return {
      source: { pluginId: channel.provider, name: scrub(name, 40) },
      tmdb: null, imdb: null, kind: "live", season: null, episode: null, title: scrub(channel.name, 120), year: null, channel,
    };
  }
  if (!isObj(ctx) || !isObj(ctx.source) || typeof ctx.source.pluginId !== "string") return null;
  const ids = isObj(ctx.ids) ? ctx.ids : {};
  const kind = ctx.kind === "episode" ? "series" : ctx.kind === "movie" ? "movie" : "live";
  const year = Number.parseInt(String(ctx.year || ""), 10);
  return {
    source: { pluginId: scrub(ctx.source.pluginId, 64), name: scrub(ctx.source.name || "", 40) },
    tmdb: isInt(ids.tmdb, 1, 2147483647) ? ids.tmdb : null,
    imdb: typeof ids.imdb === "string" && /^tt[0-9]{7,10}$/.test(ids.imdb) ? ids.imdb : null,
    kind,
    season: kind === "series" && isInt(ctx.season, 0, 999) ? ctx.season : null,
    episode: kind === "series" && isInt(ctx.episode, 1, 9999) ? ctx.episode : null,
    title: scrub(ctx.title || "", 120),
    year: isInt(year, 1870, 2100) ? year : null,
  };
}

/** A media block read from a peer, or null. */
export function readMedia(m) {
  if (!isObj(m) || !isObj(m.source) || typeof m.source.pluginId !== "string") return null;
  if (!["movie", "series", "live"].includes(m.kind)) return null;
  const channel = m.kind === "live" ? channelOf(m.channel) : null;
  return {
    source: { pluginId: scrub(m.source.pluginId, 64), name: scrub(typeof m.source.name === "string" ? m.source.name : "", 40) },
    tmdb: isInt(m.tmdb, 1, 2147483647) ? m.tmdb : null,
    imdb: typeof m.imdb === "string" && /^tt[0-9]{7,10}$/.test(m.imdb) ? m.imdb : null,
    kind: m.kind,
    season: m.kind === "series" && isInt(m.season, 0, 999) ? m.season : null,
    episode: m.kind === "series" && isInt(m.episode, 1, 9999) ? m.episode : null,
    title: scrub(typeof m.title === "string" ? m.title : "", 120),
    year: isInt(m.year, 1870, 2100) ? m.year : null,
    ...(channel ? { channel } : {}),
  };
}

export const sameMedia = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether this guest watches what the room watches. `ok` only when BOTH the source plugin and the title match (same source =
 * same cut and encode, so positions agree). Else `reason`: "noSource" (not a plugin's title), "live" (chat only), "noIds" (the
 * room's title has no TMDB or IMDb id: it cannot be matched, so it is never synced), "otherTitle" (offer Kino's title page),
 * "otherSource" (name the room's plugin), "noRoomTitle" (the room has no title yet). The room on an En vivo channel: never `ok`
 * (nothing to keep in step), "sameChannel" (this guest is on it) or "otherChannel" (offer «Ver el mismo canal»).
 */
export function mediaMatch(ctx, media) {
  if (!media) return { ok: false, reason: "noRoomTitle" };
  if (media.kind === "live" && media.channel) {
    const mine = isObj(ctx) && ctx.live === true ? channelOf(ctx.channel) : null;
    const same = mine && mine.provider === media.channel.provider && mine.code === media.channel.code;
    return { ok: false, reason: same ? "sameChannel" : "otherChannel" };
  }
  const mine = mediaOf(ctx);
  if (!mine) return { ok: false, reason: "noSource" };
  if (media.kind === "live" || mine.kind === "live") return { ok: false, reason: "live" };
  if (media.tmdb === null && media.imdb === null) return { ok: false, reason: "noIds" };
  const sameId = (media.tmdb !== null && mine.tmdb === media.tmdb) || (media.imdb !== null && mine.imdb === media.imdb);
  const sameEpisode = media.kind !== "series" || (mine.season === media.season && mine.episode === media.episode);
  if (!sameId || mine.kind !== media.kind || !sameEpisode) return { ok: false, reason: "otherTitle" };
  if (mine.source.pluginId !== media.source.pluginId) return { ok: false, reason: "otherSource" };
  return { ok: true, reason: "same" };
}

/** The room's En vivo channel to tune to (`go.liveChannel`, the person's own tap), or null when the room is not on one. */
export function liveChannelGoOf(media) {
  if (!media || media.kind !== "live" || !media.channel) return null;
  return { liveChannel: { provider: media.channel.provider, code: media.channel.code } };
}

/** Kino's own title page for the room's title (`go.titleByIds`), or null when the room has no id for it. */
export function titleByIdsOf(media) {
  if (!media || media.kind === "live" || (media.tmdb === null && media.imdb === null)) return null;
  const t = { kind: media.kind };
  if (media.tmdb !== null) t.tmdb = media.tmdb;
  if (media.imdb !== null) t.imdb = media.imdb;
  if (media.kind === "series" && media.season !== null) {
    t.season = media.season;
    if (media.episode !== null) t.episode = media.episode;
  }
  if (media.title) t.title = media.title;
  if (media.year !== null) t.year = media.year;
  return { titleByIds: t };
}
