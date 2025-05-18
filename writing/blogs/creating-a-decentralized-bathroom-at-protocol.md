---
layout: post
title: "Creating a decentralized bathroom (powered by the AT Protocol)"
date: "2025-03-08"
time: "10:00am EST"
author: "Dame"
excerpt: "As many of you know by now, I am a Lexicon enjoyer. So much so that this week I created the world's first bathroom that is connected to the AT Protocol. Yes, you read that correctly..."
blueskyUri: "3ljvamka4422e"
ogImage: "/images/blog/creating-a-decentralized-bathroom-at-protocol.jpg"
showNewsletter: true
---

As many of you know by now, I am a [Lexicon](https://atproto.com/guides/lexicon) enjoyer. So much so that this week I created the world's first bathroom that is connected to the AT Protocol. Yes, you read that correctly...

But before we get to that, let's cover some basics for the new folks in the room.

## "Explain the AT Protocol like I'm 5"

Bluesky is a semi-decentralized social networking platform built on top of a new internet protocol known as the AT Protocol that uses arbitrary JSON schemas and personal data servers (PDSs) to empower user agency and autonomy. Kinda technical and difficult to understand underneath all that jargon, right? Here's a simpler way of thinking about it...

**You can now own your social networking data, take it with you wherever you want, and never be locked into an app ever again.**

The most exciting part of the AT Protocol to me is the concept of the [Personal Data Server (PDS)](https://docs.bsky.app/docs/advanced-guides/atproto) and the way data is stored on it. Every single post, like, reply, or follow you make on Bluesky is stored in your own PDS in the form of a lexicon record. 

### Lexicons are just File Formats

For the non-technical in the audience, **a Lexicon is basically just a file format** for the AT Protocol... think of it like a file on your computer that might come in many different forms: .jpg, .pdf, .doc, .txt

These "file formats" are called [NSIDs](https://atproto.com/specs/nsid) and look like domain names that are backwards. Here's what Bluesky's "file formats" look like under the hood:

```
app.bsky.actor.profile
app.bsky.feed.like
app.bsky.feed.post
app.bsky.feed.repost
app.bsky.graph.follow
```

Each of these files contains some of your data that is created from an app like Bluesky. By using tools like [pdsls.dev](https://pdsls.dev/at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj), you can see all of the data that lives within a Bluesky account's personal data server. Pretty neat, right? What's even better is that anyone can create their own "file format" for whatever suits their needs, and any app can easily support any other file format at the app developer's discretion.

This is how the new "decentralized" versions of TikTok, Instagram, Goodreads, etc are able to work so easily. You sign into them with your Bluesky (AT Protocol) account, and they support many of Bluesky's native "file formats" out of the box. No need to write a new bio, upload a new avatar, or create a new username for every account... you simply sign in to an app and it all gets imported "magically".

So, what does any of this have to do with my bathroom, right? 

Up until this point, most developers have been hard at work create new and exciting "file formats" for the AT Protocol that can do interesting things like help you [manage events](), [chat with friends](), or [write long form blog posts](). I've been experimenting with Lexicons myself for a hot minute behind-the-scenes, and I'd like to formally introduce the concept of the **Personal Lexicon**.

## Introducing, the Personal Lexicon

Many people such as myself are big believers in everyone having their own personal website... a plot of digital land that you control and call home. I've had a personal website since I was a teenager, so at least a decade or two by now. I've also been tracking weird and eclectic data about my personal life since I was a child (my first spreadsheet was a list of all the vanity license plates I had seen). I know, I'm a bit of an odd nerd.

All this got me thinking... what if more people had their own personal "file formats"? With the AT Protocol, this is now super easy thanks to Lexicons.

As a proof of concept to show what this could look like, I've begun writing records to my own PDS that utilize my domain name:

```
is.dame.counting.turtles
is.dame.tasting.wine
is.dame.on.the.toilet
```