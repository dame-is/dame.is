---
layout: post
title: "A guestbook and welcome message for my atproto PDS"
date: "2025-05-08"
time: "1:00pm EST"
author: "Dame"
excerpt: "We all know by now that I am a black market lexicon dealer and an enjoyer of illegal atproto records. It's not my fault that Bluesky PBC allowed for such shenanigans! If the good lord had intended for us to walk, she wouldn't have invented roller skates."
blueskyUri: ""
ogImage: "/images/blog/guestbook-blog.png"
---

We all know by now that [I am a black market lexicon dealer](https://bsky.app/profile/dame.is/post/3lo56xss6hk2n) and an enjoyer of [illegal atproto records](https://bsky.app/profile/dame.is/post/3lnyoz6es2k2b). It's not my fault that Bluesky PBC allowed for such shenanigans! If the good lord had intended for us to walk, [she wouldn't have invented roller skates](https://www.youtube.com/watch?v=K8Gmd8y_Aiw).

My latest lexicon experiment is geared towards the real atproto nerds, so if you're not familiar with how this stuff works, you might want to [read my previous blog post where I explained lexicons](https://dame.is/blog/creating-a-decentralized-bathroom-at-protocol/). Ok, let's jump in.

If you spend time browsing PDS tools like [pdsls.dev](https://pdsls.dev) or [atp.tools](https://atp.tools), then you've probably picked up on the fact that by default they sort lexicon collections alphabetically. This means that 99.99% of PDSes currently begin with app.bsky records at the top. This got me thinking... what if I made some "welcome" records that would go at the top of my PDS so that nerds browsing it would get a friendly hello?

[image]

So, I created [a.welcome.message.for.my.pds](https://pdsls.dev/at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/a.welcome.message.for.my.pds). At the moment it contains a little greeting + a list of links where people can find me and my projects.

```
{

"text": "Hi there ATmosphere explorer! My name is Dame, and this is my PDS. Glad to see you here!",

"$type": "a.welcome.message.for.my.pds",

"follow me on bsky": "https://bsky.app/profile/dame.is",

"check out my links": "at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/a.welcome.message.for.my.pds/links-to-check-out"

}
```

I couldn't stop there though. Thanks to the fact that pdsls.dev and atp.tools support [@bad-example.com's](https://bsky.app/profile/bad-example.com) project called [Constellation](https://constellation.microcosm.blue/), I realized I could create another lexicon at the top of my PDS that took advantage of backlinks.

So, I created [a.guestbook.for.my.pds](https://pdsls.dev/at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/a.guestbook.for.my.pds/guestbook). You can sign my guestbook by simply creating a record in your own PDS under any arbitrary lexicon such as `a.guestbook.i.signed` that points to the at:// URI of my guestbook. Then, thanks to the power of [Constellation](https://constellation.microcosm.blue/), it will automatically appear as a backlink when viewing my guestbook via a tool like pdsls.dev.

```
{

"$type": "a.guestbook.for.my.pds",

"readme": "Sign my guestbook by creating a record in your PDS that points to my guestbook's URI. It will then appear as a backlink via constellation. You can view all of the guestbook messages on an atproto explorer like pdsls.dev that supports constellation backlinks.",

"uri-to-link-to": "at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/a.guestbook.for.my.pds/guestbook"

}
```

[image of backlink]

Because of the technical nature of this setup, it's not exactly a guestbook that anyone can enjoy. It's geared specifically towards developers and freaks like me who aren't engineers but who know enough to get in trouble. What if there was an atproto-based guestbook that more people could enjoy?

Well, there might soon be one... [Ms Boba](https://bsky.app/profile/essentialrandom.bsky.social) is working on [an atproto guestbook AppView and Lexicon](https://github.com/FujoWebDev/lexicon-guestbook) that is worth checking out.

In the meantime, here's a step-by-step guide to making your own nerd version.

## How to create your own PDS guestbook and welcome message

### Guestbook Instructions
1. Go to [pdsls.dev](https://pdsls.dev) and sign in with your ATmosphere account.
2. Tap the "Create record" icon in the top right that looks like a pencil/pen.
3. In the `Collection` field, type `a.guestbook.for.my.pds`.
4. In the `Record key` field, type `guestbook`.
5. `Validate` can stay as `Unset`.
6. In the code editor, paste the following code and hit `Create`.

```
{

"$type": "a.guestbook.for.my.pds",

"readme": "Sign my guestbook by creating a record in your PDS under the Collection 'a.guestbook.i.signed' and include a link to my guestbook's at:// URI that's listed below. It will then appear as a backlink via Constellation. You can view all of the guestbook messages on an atproto explorer like pdsls.dev that supports Constellation backlinks.",

"guestbook": "REPLACE WITH URI after record creation by editing the record via recreation",

"more-info": "https://dame.is/blog/LINK"

}
```

7. Navigate to the record you just created and tap the `Edit` button.
8. In your browser's URL bar, copy the part of the pdsls.dev link that looks like this: `at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/a.welcome.message.for.my.pds/start-here`
9. Paste this into the `guestbook` value that says "REPLACE WITH URI".
10. Check the `Recreate record` box and then tap the `Edit` button.

### Welcome Message Instructions
1. Go to [pdsls.dev](https://pdsls.dev) and sign in with your ATmosphere account.
2. Tap the "Create record" icon in the top right that looks like a pencil/pen.
3. In the `Collection` field, type `a.welcome.message.for.my.pds`.
4. In the `Record key` field, type a name like `start-here`.
5. `Validate` can stay as `Unset`.
6. In the code editor, paste the following code or something similar:

```
{

"text": "Hi there ATmosphere explorer! This is my PDS. Glad to see you here!",

"$type": "a.welcome.message.for.my.pds",

"follow me on bsky": "https://bsky.app/profile/USERNAME",

"sign my guestbook": "REPLACE WITH URI of your guestbook",

}
```

## How to sign someone's guestbook
1. Go to [pdsls.dev](https://pdsls.dev) and sign in with your ATmosphere account.
2. Tap the "Create record" icon in the top right that looks like a pencil/pen.
3. In the `Collection` field, type `a.guestbook.i.signed`.
4. Leave the `Record key` field blank or type a name (no spaces).
5. `Validate` can stay as `Unset`.
6. In the code editor, paste the following code or something similar and hit `Create`:

```
{

"$type": "a.guestbook.i.signed",

"message": "hi atpotato",

"guestbook": "REPLACE WITH URI of the guestbook you want to sign"

}
```

The interesting thing about lexicons and at:// URIs is that you can even create a record that points to someone's guestbook that doesn't even exist (yet). All you'd have to do is swap out the account's DID in the URI like this:

`at://did:plc:fnhrjbkwjiw6iyxxg2o3rljw/a.guestbook.for.my.pds/guestbook`

Then, theoretically, if that person ever creates a guestbook down the line using this lexicon schema, the backlink would work.

## The guestbook record generator

To cut down on some of the time that it takes to put together the data for guestbook signing, I've created a little tool below to simplify things. Type in the username of the account whose guestbook you want to sign, write your message, and then it will output the JSON for you to copy to your clipboard. Then you can just paste that into pdsls.dev.

<div class="guestbook-generator">
    <form id="guestbook-form">
        <div>
            <label for="handle">Handle (e.g., dame.is):</label>
            <input type="text" id="handle" name="handle" placeholder="dame.is" required>
        </div>
        <div>
            <label for="message">Message:</label>
            <textarea id="message" name="message" placeholder="hi there, good to see you" required></textarea>
        </div>
        <button type="submit">Generate JSON</button>
    </form>
    <pre id="guestbook-result"></pre>
    <button id="copy-json">Copy JSON</button>
</div>

<link rel="stylesheet" href="/css/guestbook-generator.css">
<script src="/js/guestbook-generator.js"></script>