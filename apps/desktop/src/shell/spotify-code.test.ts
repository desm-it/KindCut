import { describe, expect, it } from "vitest";
import {
  SpotifyCodeError,
  parseSpotifyEmbedEntity,
  parseSpotifyUri,
  prepareSpotifyCodeSvg,
  readSpotifyCodeSvgInfo,
  resolveSpotifyEntity,
  runSpotifyLookup,
  searchSpotifySongs,
  songTitlesMatch,
} from "./spotify-code";

const TRACK_ID = "4cOdK2wGLETKBW3PvgPWqT";
const OTHER_ID = "6bnZlZvEmocCLdp0622Idi";

function embedHtml(entity: Record<string, unknown>): string {
  const data = { props: { pageProps: { state: { data: { entity } } } } };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

function codeSvg(): string {
  const bars = Array.from({ length: 23 }, (_, index) =>
    `<rect x="${100 + index * 12.42}" y="41.00" width="6.71" height="18.00" rx="3.36" ry="3.36" fill="#000000"/>`,
  ).join("\n");
  return [
    '<svg width="640" height="160" viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg">',
    '<rect x="0" y="0" width="400" height="100" fill="#ffffff"/>',
    bars,
    '<g transform="translate(20,20)"><path fill="#000000" d="M30 0A30 30 0 1 1 30 60Z"/></g>',
    "</svg>",
  ].join("\n");
}

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!route) throw new TypeError(`unexpected fetch ${url}`);
    return route[1]();
  };
  return { calls, options: { userAgent: "KindCut-test", fetchImpl } };
}

describe("parseSpotifyUri", () => {
  it("accepts share links, localised links, embed links and URIs", () => {
    expect(parseSpotifyUri(`https://open.spotify.com/track/${TRACK_ID}?si=abc123`)).toBe(`spotify:track:${TRACK_ID}`);
    expect(parseSpotifyUri(`https://open.spotify.com/intl-nl/album/${TRACK_ID}`)).toBe(`spotify:album:${TRACK_ID}`);
    expect(parseSpotifyUri(`https://open.spotify.com/embed/playlist/${TRACK_ID}`)).toBe(`spotify:playlist:${TRACK_ID}`);
    expect(parseSpotifyUri(`  spotify:episode:${TRACK_ID} `)).toBe(`spotify:episode:${TRACK_ID}`);
  });

  it("rejects other hosts, unknown types and malformed IDs", () => {
    expect(parseSpotifyUri(`https://example.com/track/${TRACK_ID}`)).toBeNull();
    expect(parseSpotifyUri(`https://open.spotify.com/user/${TRACK_ID}`)).toBeNull();
    expect(parseSpotifyUri("https://open.spotify.com/track/short")).toBeNull();
    expect(parseSpotifyUri("never gonna give you up")).toBeNull();
  });
});

describe("songTitlesMatch", () => {
  it("ignores case, accents and version suffixes", () => {
    expect(songTitlesMatch("Never Gonna Give You Up", "never gonna give you up (2022 Remaster)")).toBe(true);
    expect(songTitlesMatch("Café del Mar - Radio Edit", "Cafe Del Mar")).toBe(true);
    expect(songTitlesMatch("Als Het Avond Is", "Zoutelande")).toBe(false);
    expect(songTitlesMatch("", "Anything")).toBe(false);
  });
});

describe("parseSpotifyEmbedEntity", () => {
  it("reads title, joined artists, playability and a thumbnail-sized cover", () => {
    const entity = parseSpotifyEmbedEntity(
      embedHtml({
        uri: `spotify:track:${TRACK_ID}`,
        name: "Never Gonna Give You Up",
        artists: [{ name: "Rick Astley" }, { name: "Guest" }],
        isPlayable: true,
        visualIdentity: {
          image: [
            { url: "https://img/640", maxWidth: 640 },
            { url: "https://img/64", maxWidth: 64 },
            { url: "https://img/300", maxWidth: 300 },
          ],
        },
      }),
    );
    expect(entity).toEqual({
      uri: `spotify:track:${TRACK_ID}`,
      title: "Never Gonna Give You Up",
      artist: "Rick Astley, Guest",
      coverUrl: "https://img/300",
      isPlayable: true,
    });
  });

  it("uses the subtitle as the artist for albums but not for artist pages", () => {
    expect(parseSpotifyEmbedEntity(embedHtml({ uri: `spotify:album:${TRACK_ID}`, name: "Album", subtitle: "Pink Floyd" }))?.artist)
      .toBe("Pink Floyd");
    expect(parseSpotifyEmbedEntity(embedHtml({ uri: `spotify:artist:${TRACK_ID}`, name: "Rick Astley", subtitle: "Top tracks" }))?.artist)
      .toBe("");
  });

  it("returns null for Spotify's not-found page", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { status: 404 } } })}</script>`;
    expect(parseSpotifyEmbedEntity(html)).toBeNull();
    expect(parseSpotifyEmbedEntity("<html></html>")).toBeNull();
  });
});

describe("prepareSpotifyCodeSvg", () => {
  it("drops the background, keeps the bars and records the song", () => {
    const svg = prepareSpotifyCodeSvg(codeSvg(), {
      uri: `spotify:track:${TRACK_ID}`,
      title: "Rock & Roll",
      artist: "Band <3",
    });
    expect(svg).not.toContain('width="400" height="100" fill="#ffffff"');
    expect(svg.match(/<rect\b/g)).toHaveLength(23);
    expect(readSpotifyCodeSvgInfo(svg)).toEqual({ uri: `spotify:track:${TRACK_ID}`, label: "Rock & Roll - Band <3" });
  });

  it("rejects responses that are not a Spotify code", () => {
    expect(() => prepareSpotifyCodeSvg("<html>Rate limited</html>", { uri: "spotify:track:x", title: "x", artist: "" }))
      .toThrow(SpotifyCodeError);
  });
});

describe("searchSpotifySongs", () => {
  it("maps Deezer tracks to search results", async () => {
    const { options, calls } = fakeFetch({
      "https://api.deezer.com/search": () =>
        Response.json({
          data: [
            {
              id: 14408104,
              title: "Never Gonna Give You Up (Remastered)",
              title_short: "Never Gonna Give You Up",
              artist: { name: "Rick Astley" },
              album: { title: "Whenever You Need Somebody", cover_medium: "https://cover/250" },
            },
          ],
        }),
    });
    const results = await searchSpotifySongs("rick astley", options);
    expect(calls[0]).toContain("q=rick%20astley");
    expect(results).toEqual([
      {
        key: "deezer:14408104",
        title: "Never Gonna Give You Up (Remastered)",
        titleShort: "Never Gonna Give You Up",
        artist: "Rick Astley",
        album: "Whenever You Need Somebody",
        coverUrl: "https://cover/250",
        spotifyUri: null,
      },
    ]);
  });

  it("looks a pasted Spotify link up directly instead of searching", async () => {
    const { options, calls } = fakeFetch({
      "https://open.spotify.com/embed/track/": () =>
        new Response(embedHtml({ uri: `spotify:track:${TRACK_ID}`, name: "Song", artists: [{ name: "Artist" }] })),
    });
    const [result] = await searchSpotifySongs(`https://open.spotify.com/track/${TRACK_ID}?si=x`, options);
    expect(calls).toEqual([`https://open.spotify.com/embed/track/${TRACK_ID}`]);
    expect(result).toMatchObject({ title: "Song", artist: "Artist", spotifyUri: `spotify:track:${TRACK_ID}` });
  });

  it("reports Deezer's in-body rate limit as busy", async () => {
    const { options } = fakeFetch({
      "https://api.deezer.com/search": () => Response.json({ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }),
    });
    await expect(runSpotifyLookup(() => searchSpotifySongs("song", options))).resolves.toEqual({ ok: false, code: "busy" });
  });

  it("flags Spotify links it cannot use", async () => {
    const { options } = fakeFetch({});
    await expect(runSpotifyLookup(() => searchSpotifySongs("https://open.spotify.com/user/someone", options)))
      .resolves.toEqual({ ok: false, code: "unsupported-link" });
  });
});

describe("resolveSpotifyEntity", () => {
  const request = { title: "Never Gonna Give You Up", artist: "Rick Astley", album: "Whenever You Need Somebody", spotifyUri: null };

  it("skips ListenBrainz candidates whose title does not match, preferring a playable one", async () => {
    const { options, calls } = fakeFetch({
      "https://labs.api.listenbrainz.org/": () => Response.json([{ spotify_track_ids: [OTHER_ID, TRACK_ID] }]),
      [`https://open.spotify.com/embed/track/${OTHER_ID}`]: () =>
        new Response(embedHtml({ uri: `spotify:track:${OTHER_ID}`, name: "Some Karaoke Medley", artists: [{ name: "X" }] })),
      [`https://open.spotify.com/embed/track/${TRACK_ID}`]: () =>
        new Response(embedHtml({ uri: `spotify:track:${TRACK_ID}`, name: "Never Gonna Give You Up", artists: [{ name: "Rick Astley" }] })),
    });
    const entity = await resolveSpotifyEntity(request, options);
    expect(entity.uri).toBe(`spotify:track:${TRACK_ID}`);
    expect(calls[0]).toBe("https://labs.api.listenbrainz.org/spotify-id-from-metadata/json");
  });

  it("fails with no-match when ListenBrainz knows no Spotify track", async () => {
    const { options } = fakeFetch({
      "https://labs.api.listenbrainz.org/": () => Response.json([{ spotify_track_ids: [] }]),
    });
    await expect(runSpotifyLookup(() => resolveSpotifyEntity(request, options))).resolves.toEqual({ ok: false, code: "no-match" });
  });

  it("reports a pasted link that Spotify no longer knows as not-found", async () => {
    const { options } = fakeFetch({
      "https://open.spotify.com/embed/": () => new Response("Not found", { status: 404 }),
    });
    await expect(runSpotifyLookup(() => resolveSpotifyEntity({ ...request, spotifyUri: `spotify:track:${TRACK_ID}` }, options)))
      .resolves.toEqual({ ok: false, code: "not-found" });
  });

  it("turns fetch failures into a network error", async () => {
    const { options } = fakeFetch({});
    await expect(runSpotifyLookup(() => resolveSpotifyEntity(request, options))).resolves.toEqual({ ok: false, code: "network" });
  });
});
