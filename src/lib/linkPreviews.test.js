import { describe, expect, it } from 'vitest';
import {
  classifyLink,
  cleanTitle,
  decodeEntities,
  documentLinks,
  iconCandidates,
  landingOf,
  linkPreviewsName,
  monthFromPath,
  monthLabel,
  parseHeadMeta,
  previewCounts,
  previewFromOembed,
  previewFromPage,
  previewFromPostView,
  previewFromProfile,
  previewFromVideoOembed,
  previewFromWikiSummary,
  previewLabel,
  sentencesUpTo,
  shortPath,
  splitLinkEnd,
} from './linkPreviews.js';

const link = (uri) => ({ $type: 'pub.leaflet.richtext.facet#link', uri });

describe('documentLinks', () => {
  it('finds every http(s) link once, in reading order, wherever the block keeps it', () => {
    const content = {
      pages: [
        {
          blocks: [
            { block: { $type: 'pub.leaflet.blocks.text', facets: [{ features: [link('https://a.example/')] }] } },
            {
              block: {
                $type: 'pub.leaflet.blocks.unorderedList',
                children: [{ content: { facets: [{ features: [link('https://b.example/x')] }] } }],
              },
            },
            { block: { $type: 'pub.leaflet.blocks.blockquote', facets: [{ features: [link('https://a.example/')] }] } },
          ],
        },
      ],
    };
    expect(documentLinks(content)).toEqual(['https://a.example/', 'https://b.example/x']);
  });

  it('leaves out links that are not web addresses', () => {
    const content = { facets: [{ features: [link('at://did:plc:x/app.bsky.feed.post/1'), link('mailto:a@b.c')] }] };
    expect(documentLinks(content)).toEqual([]);
  });
});

describe('linkPreviewsName', () => {
  it('files a record under its collection and key', () => {
    expect(linkPreviewsName('at://did:plc:me/site.standard.document/3mz4bbmjphc2l')).toBe(
      'link-previews/site.standard.document/3mz4bbmjphc2l',
    );
  });
  it('is null for anything that is not a record URI', () => {
    expect(linkPreviewsName(null)).toBeNull();
    expect(linkPreviewsName('at://did:plc:me/site.standard.document')).toBeNull();
    expect(linkPreviewsName('at://did:plc:me/x/../../etc')).toBeNull();
  });
});

describe('classifyLink', () => {
  it('knows the places that answer through an API', () => {
    expect(classifyLink('https://bsky.app/profile/attie.ai/post/3mxwnz4gbzk2r')).toEqual({
      type: 'post',
      actor: 'attie.ai',
      rkey: '3mxwnz4gbzk2r',
    });
    expect(classifyLink('https://bsky.app/profile/poe.atpota.to')).toEqual({ type: 'profile', actor: 'poe.atpota.to' });
    expect(classifyLink('https://en.wikipedia.org/wiki/Sherlock_%28software%29#Sherlocked_as_a_term')).toEqual({
      type: 'wikipedia',
      lang: 'en',
      title: 'Sherlock_(software)',
      section: 'Sherlocked as a term',
    });
    expect(classifyLink('https://twitter.com/jack/status/1204766078468911106')).toEqual({
      type: 'x-post',
      user: 'jack',
      id: '1204766078468911106',
    });
  });

  it('calls a link to the site internal, and knows the newsletter link opens here', () => {
    expect(classifyLink('https://dame.is/blogging#subscribe')).toEqual({ type: 'internal', local: true });
    expect(classifyLink('https://dame.is/creating')).toEqual({ type: 'internal', local: false });
  });

  it('knows a video by its address', () => {
    expect(classifyLink('https://www.youtube.com/watch?v=K8Gmd8y_Aiw')).toEqual({ type: 'video', provider: 'youtube' });
    expect(classifyLink('https://youtu.be/K8Gmd8y_Aiw')).toEqual({ type: 'video', provider: 'youtube' });
    expect(classifyLink('https://vimeo.com/76979871')).toEqual({ type: 'video', provider: 'vimeo' });
    expect(classifyLink('https://www.youtube.com/@channel')).toEqual({ type: 'web' });
  });

  it('reads everything else from the page', () => {
    expect(classifyLink('https://techcrunch.com/2026/08/26/x/')).toEqual({ type: 'web' });
    expect(classifyLink('https://bsky.app/search?q=x')).toEqual({ type: 'web' });
    expect(classifyLink('javascript:alert(1)')).toEqual({ type: 'invalid' });
    expect(classifyLink('not a url')).toEqual({ type: 'invalid' });
  });
});

describe('addresses', () => {
  it('shortens a URL to what a reader would type', () => {
    expect(shortPath('https://www.example.com/a/b/')).toBe('example.com/a/b');
    expect(shortPath('https://en.wikipedia.org/wiki/Sherlock_%28software%29')).toBe(
      'en.wikipedia.org/wiki/Sherlock_(software)',
    );
  });

  it('says where a redirect lands: the host alone when only the host moved', () => {
    expect(landingOf('https://twitter.com/jack/status/1', 'https://x.com/jack/status/1')).toBe('x.com');
    expect(landingOf('https://attie.ai', 'https://attie.ai/login')).toBe('attie.ai/login');
    expect(landingOf('https://stream.place', 'https://stream.place/')).toBe('');
    expect(landingOf('https://a.example/x', '')).toBe('');
  });

  it('takes a month from a dated path', () => {
    expect(monthFromPath('https://daringfireball.net/2026/10/x_once_again_marks_the_spot')).toBe('2026-10');
    expect(monthFromPath('https://example.com/about')).toBe('');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-10-30T00:00:00Z')).toBeNull();
  });
});

describe('parseHeadMeta', () => {
  const html = `<!doctype html><html><head>
    <title>Fallback &amp; title</title>
    <meta content="Flipboard acquires Graze | TechCrunch" property="og:title">
    <meta name="description" content="Plain description">
    <meta property="og:description" content="Flipboard is acquiring Graze&#8217;s tools.">
    <meta property='og:image' content='/cover.png'>
    <meta property="og:site_name" content="TechCrunch">
    <meta property="og:type" content="article">
    <meta property="article:published_time" content="2026-08-26T18:35:40+00:00">
    <meta name="author" content="Sarah Perez">
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
    <link rel="apple-touch-icon" href="/touch.png">
    <link rel="mask-icon" href="/mask.svg">
    <link rel="site.standard.document" href="at://did:plc:x/site.standard.document/abc">
  </head><body><meta property="og:title" content="not this"></body></html>`;

  it('reads the Open Graph tags in either attribute order, with entities decoded', () => {
    const meta = parseHeadMeta(html, 'https://techcrunch.com/2026/08/26/x/');
    expect(meta.title).toBe('Flipboard acquires Graze | TechCrunch');
    expect(meta.description).toBe('Flipboard is acquiring Graze’s tools.');
    expect(meta.image).toBe('https://techcrunch.com/cover.png');
    expect(meta.siteName).toBe('TechCrunch');
    expect(meta.type).toBe('article');
    expect(meta.published).toBe('2026-08-26T18:35:40+00:00');
    expect(meta.author).toBe('Sarah Perez');
    expect(meta.documentUri).toBe('at://did:plc:x/site.standard.document/abc');
  });

  it('collects the icons, but not the mask icon', () => {
    const meta = parseHeadMeta(html, 'https://techcrunch.com/');
    expect(meta.icons.map((i) => i.href)).toEqual(['https://techcrunch.com/favicon-32.png', 'https://techcrunch.com/touch.png']);
  });

  it('falls back to the <title>, and refuses a share image that is not a web address', () => {
    const meta = parseHeadMeta('<title>Just &amp; this</title><meta property="og:image" content="javascript:x">', 'https://a.example/');
    expect(meta.title).toBe('Just & this');
    expect(meta.image).toBe('');
  });

  it('notices a page that only forwards somewhere else', () => {
    const meta = parseHeadMeta(
      '<head><meta http-equiv="refresh" content="0; url=https://atproto.com/blog/jetstream"></head>',
      'https://bsky.network/blog/jetstream/',
    );
    expect(meta.refresh).toBe('https://atproto.com/blog/jetstream');
    expect(meta.title).toBe('');
  });

  it('decodes named and numeric entities and leaves unknown ones', () => {
    expect(decodeEntities('a &mdash; b &#x2019; &#39; &bogus;')).toBe("a — b ’ ' &bogus;");
  });
});

describe('iconCandidates', () => {
  const icons = [
    { href: 'https://a.example/favicon.ico', type: 'image/x-icon', sizes: '48x48', touch: false },
    { href: 'https://a.example/icon.png', type: 'image/png', sizes: '32x32', touch: false },
    { href: 'https://a.example/touch.png', type: '', sizes: '', touch: true },
  ];
  it('prefers a PNG to an .ico when it can shrink them, and ends on /favicon.ico', () => {
    const ranked = iconCandidates(icons, 'https://a.example/page');
    expect(ranked.slice(0, 2)).toEqual(['https://a.example/icon.png', 'https://a.example/touch.png']);
    expect(ranked.at(-1)).toBe('https://a.example/favicon.ico');
    expect(new Set(ranked).size).toBe(ranked.length);
  });
  it('leads with the one nearest 32px when it can not', () => {
    expect(iconCandidates(icons, 'https://a.example/', { small: true })[0]).toBe('https://a.example/icon.png');
  });
});

describe('cleanTitle', () => {
  it('trims the site’s name off either end', () => {
    expect(cleanTitle('Flipboard acquires Graze | TechCrunch', 'TechCrunch', 'techcrunch.com')).toBe('Flipboard acquires Graze');
    expect(cleanTitle('Daring Fireball: Markdown', '', 'daringfireball.net')).toBe('Markdown');
    expect(cleanTitle('Atmosphere MCP · aturi.to', '', 'aturi.to')).toBe('Atmosphere MCP');
    expect(cleanTitle('On Attie, atproto, and AI — dame.is', 'dame.is', 'dame.is')).toBe('On Attie, atproto, and AI');
  });
  it('keeps a title that only names the site, and one whose end is not the name', () => {
    expect(cleanTitle('Bluesky', 'Bluesky', 'bsky.social')).toBe('Bluesky');
    expect(cleanTitle('Leaflet Pro: power tools - Leaflet Lab Notes', 'Leaflet Lab Notes', 'lab.leaflet.pub')).toBe(
      'Leaflet Pro: power tools',
    );
    expect(cleanTitle('Standard.site - One schema. Every platform.', '', 'standard.site')).toBe(
      'Standard.site - One schema. Every platform.',
    );
  });
});

describe('sentencesUpTo', () => {
  it('cuts at a sentence end within the limit', () => {
    expect(sentencesUpTo('One. Two two. Three three three.', 15)).toBe('One. Two two.');
    expect(sentencesUpTo('Short.', 100)).toBe('Short.');
  });
  it('doesn’t take the point in a version number for the end of a sentence', () => {
    const text =
      'Sherlock is a search tool carried through to early versions of Mac OS X. Sherlock was introduced in 1998 with Mac OS 8.5 as an extension of Finder. It searched the web too.';
    expect(sentencesUpTo(text, 160)).toBe(
      'Sherlock is a search tool carried through to early versions of Mac OS X. Sherlock was introduced in 1998 with Mac OS 8.5 as an extension of Finder.',
    );
    expect(sentencesUpTo(text, 100)).toBe('Sherlock is a search tool carried through to early versions of Mac OS X.');
  });
});

describe('building previews', () => {
  it('shapes a Bluesky post', () => {
    const p = previewFromPostView(
      {
        author: { handle: 'attie.ai', displayName: 'Attie', avatar: 'https://cdn.bsky.app/img/avatar/plain/x' },
        record: { text: 'Announcing Attie site builder!', createdAt: '2026-10-15T18:12:38.103Z' },
        likeCount: 464,
        repostCount: 69,
        replyCount: 285,
        quoteCount: 0,
        embed: { external: { uri: 'https://attie.ai', title: 'Attie', thumb: 'https://cdn.bsky.app/t' } },
      },
      'https://bsky.app/profile/attie.ai/post/3mxwnz4gbzk2r',
    );
    expect(p).toMatchObject({
      kind: 'post',
      host: 'bsky.app',
      name: 'Attie',
      handle: 'attie.ai',
      when: '2026-10-15T18:12:38.103Z',
      ext: { title: 'Attie', host: 'attie.ai', thumb: 'https://cdn.bsky.app/t' },
    });
    expect(previewCounts(p)).toEqual(['464 likes', '69 reposts', '285 replies']);
    expect(previewLabel(p)).toBe('Bluesky post');
  });

  it('shapes a profile, closing up its bio’s blank lines', () => {
    const p = previewFromProfile(
      { handle: 'poe.atpota.to', displayName: 'Poe', description: 'hiiii\n\nask me', followersCount: 1, postsCount: 461 },
      'https://bsky.app/profile/poe.atpota.to',
    );
    expect(p.bio).toBe('hiiii\nask me');
    expect(previewCounts(p)).toEqual(['1 follower', '461 posts']);
  });

  it('shapes a Wikipedia summary with the section linked to', () => {
    const p = previewFromWikiSummary(
      { title: 'Sherlock (software)', description: 'Defunct search tool', extract: 'Sherlock is a now-defunct tool.' },
      'https://en.wikipedia.org/wiki/Sherlock_(software)#Sherlocked_as_a_term',
      { section: 'Sherlocked as a term' },
    );
    expect(p).toMatchObject({ kind: 'wikipedia', title: 'Sherlock (software)', section: 'Sherlocked as a term' });
  });

  it('shapes a post on X from its oEmbed, date and landing included', () => {
    const p = previewFromOembed(
      {
        url: 'https://x.com/jack/status/1204766078468911106',
        author_name: 'jack',
        author_url: 'https://x.com/jack',
        html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Twitter is funding a small team.<br>🧵</p>&mdash; jack (@jack) <a href="https://x.com/jack/status/1">December 11, 2019</a></blockquote>',
      },
      'https://twitter.com/jack/status/1204766078468911106',
    );
    expect(p).toMatchObject({
      kind: 'x-post',
      name: 'jack',
      handle: 'jack',
      text: 'Twitter is funding a small team.\n🧵',
      when: '2019-12-11',
      land: 'x.com',
    });
  });

  it('tells an article from a website, and a standard.site document from both', () => {
    const url = 'https://techcrunch.com/2026/08/26/flipboard/';
    const article = previewFromPage(
      { title: 'Flipboard acquires Graze | TechCrunch', siteName: 'TechCrunch', description: 'd', published: '2026-08-26T18:35:40+00:00', icons: [] },
      url,
    );
    expect(article).toMatchObject({ kind: 'article', title: 'Flipboard acquires Graze', site: 'TechCrunch', when: '2026-08-26T18:35:40.000Z' });
    expect(previewLabel(article)).toBe('Article');

    const site = previewFromPage({ title: 'Attie', siteName: 'Attie', description: 'AI for the Atmosphere', icons: [] }, 'https://attie.ai', {
      finalUrl: 'https://attie.ai/login',
    });
    expect(site).toMatchObject({ kind: 'website', title: 'Attie', land: 'attie.ai/login' });
    expect(site.site).toBeUndefined();

    const doc = previewFromPage(
      { title: 'Introducing Quests - The Liquid Frontier', siteName: 'The Liquid Frontier', documentUri: 'at://x/site.standard.document/y', icons: [] },
      'https://theliquidfrontier.leaflet.pub/3mrddkznuuc2g',
      {
        record: { value: { title: 'Introducing Quests', description: 'Quests in Attie', publishedAt: '2026-07-23T17:14:02.565Z' } },
        publication: { value: { name: 'The Liquid Frontier' } },
      },
    );
    expect(doc).toMatchObject({ kind: 'document', title: 'Introducing Quests', desc: 'Quests in Attie', site: 'The Liquid Frontier', platform: 'Leaflet' });
    expect(previewLabel(doc)).toBe('Leaflet');
  });

  it('shapes a video from its oEmbed', () => {
    const p = previewFromVideoOembed(
      { title: 'A talk', author_name: 'Some Channel', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' },
      'https://www.youtube.com/watch?v=x',
    );
    expect(p).toMatchObject({ kind: 'video', title: 'A talk', author: 'Some Channel', site: 'YouTube', host: 'youtube.com' });
    expect(previewLabel(p)).toBe('Video');
  });

  it('says nothing for a page with nothing to say', () => {
    expect(previewFromPage({ title: '', description: '', icons: [] }, 'https://a.example/')).toBeNull();
  });
});

describe('splitLinkEnd', () => {
  it('holds the last word for the icon', () => {
    expect(splitLinkEnd('Jack Dorsey described')).toEqual(['Jack Dorsey ', 'described']);
    expect(splitLinkEnd('Attie')).toEqual(['', 'Attie']);
  });
  it('holds only the end of a long word, so an address still wraps', () => {
    const [head, end] = splitLinkEnd('example.com/a/very/long/path/indeed');
    expect(end).toBe('indeed');
    expect(head + end).toBe('example.com/a/very/long/path/indeed');
  });
});
