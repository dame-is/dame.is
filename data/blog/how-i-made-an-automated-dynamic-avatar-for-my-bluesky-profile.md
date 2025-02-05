---
title: "How I made an automated dynamic avatar for my Bluesky profile"
date: "2025-2-5"
author: "Dame"
excerpt: "Several years ago, back when Twitter was a thing and it had a decent API, my friend @goose.art did a weird little experiment where he made his avatar dynamic... it automatically changed appearances on a regular basis and became increasingly deep-fried (increased in distortion and lossy compression). I’ve seen several other people mess around with this concept since then, and I’ve always had it in the back of my head as something I wanted to eventually try for myself."
bluesky_uri: "3lhh4e7j4xk2b"
og:
  title: "How I made an automated dynamic avatar for my Bluesky profile"
  description: "Several years ago, back when Twitter was a thing and it had a decent API, my friend @goose.art did a weird little experiment where he made his avatar dynamic... it automatically changed appearances on a regular basis and became increasingly deep-fried (increased in distortion and lossy compression). I’ve seen several other people mess around with this concept since then, and I’ve always had it in the back of my head as something I wanted to eventually try for myself."
  image: "/images/blog/automated-avatar-graphics/avatar-grid.jpg"
  url: "https://dame.is/blog/how-i-made-an-automated-dynamic-avatar-for-my-bluesky-profile"
---

Several years ago, back when Twitter was a thing and it had a decent API, my friend [@goose.art](https://bsky.app/profile/goose.art) did a weird little experiment where he made his avatar dynamic... it automatically changed appearances on a regular basis and became increasingly deep-fried (increased in distortion and lossy compression). I’ve seen several other people mess around with this concept since then, and I’ve always had it in the back of my head as something I wanted to eventually try for myself.

Flash forward to today, and I’ve finally done exactly that thanks to Bluesky and its wonderful API.

Today I activated an automation that changes my Bluesky avatar every hour of each day to roughly correspond with the daylight (or lack thereof) that I’m experiencing in my time zone (EST). As the sun is rising and setting each day, you’ll see it reflected on my profile in the form of ever-changing sky gradients. I felt that this expression was especially appropriate given the theme of the Bluesky brand.

![A screenshot of my bluesky profile showing one of the avatar designs](/images/blog/automated-avatar-graphics/avatar-profile.png "avatar profile example")

In case anyone is wondering how this automation works under the surface, I thought it might be worthwhile to write up a blog post explaining my process. I’m sure all of the devs/engineers can deduce what’s going on, but I think I implemented it in a pretty fun way that should be entertaining regardless of your skill level.

## The Visuals and Concept

Ever since coming back to social media after a long break last year, my profile picture had just been my name in Arial font loosely in the style of Charli xcx’s Brat album cover. I evolved the design of it overtime to be more my own style, and  then I realized that it would work perfectly for this project. So, I began creating a bunch of interesting variants of the design in Adobe Illustrator.

![A grid showing all 24 versions of my avatar with various sky gradient backgrounds, one for each hour of the day](/images/blog/automated-avatar-graphics/avatar-grid.jpg "bluesky sky avatar gradients grid")

The backgrounds are simple two-color gradients with noise filters applied and then styled with a gaussian blur. The variations of the word “dame” were made using numerous blending layers, strokes, and effects all smashed together in funky and disturbing ways.

![A closeup of one of the dynamic avatars](/images/blog/automated-avatar-graphics/5pmbig.jpg "bluesky sky avatar close up")

After the fact, I realized that the visuals I produced had a taste of Ed Ruscha’s style to them, an artist whose work I have long appreciated. 

![A collection of Ed Ruscha paintings hanging on a gallery wall](/images/blog/automated-avatar-graphics/ed-ruscha-example.jpg "ed ruscha example")
*[Artwork © Ed Ruscha. Photo: Rob McKeever](https://gagosian.com/exhibitions/2017/ed-ruscha-custom-built-intrigue-drawings-1974-1984/)*

## The “Code”

While I could have used a traditional [cron job](https://en.wikipedia.org/wiki/Cron) to schedule the changes each hour, that seemed pretty boring, and I have an affinity towards making Apple Shortcuts... so I challenged myself to go that route instead, which had the added benefit of letting me control things from wherever I happen to be thanks to the fact that I have my phone with me at all times.

There were several possible ways to implement the necessary API calls, and I tried several of them, but ultimately I landed on using a single dictionary full of the necessary CIDs for each image. Every hour the shortcut performs these steps:

1. Queries the dictionary for the image CID corresponding to the current time.
2. Authenticates my Bluesky account using an app password.
3. Uses the API to fetch my profile’s current data.
4. Builds a POST request using the fetched profile data + the new avatar CID, before then sending it back via the putRecord endpoint.
5. Checks that the data was updated correctly and notifies me if there was an error.

![A screenshot of the apple shortcut code that automates the bluesky avatar](/images/blog/automated-avatar-graphics/apple-shortcut.png "bluesky apple shortcut avatar automation")

There’s quite a bit of regex that was needed to properly match/filter JSON data, and I don’t know regex, but luckily claude/chatgpt is very good at writing it for me.

The one surprise I had along the way was realizing that I couldn’t just push one element of profile data through the API... I originally sent a test request through that just contained the avatar update, and quickly discovered that it “removed” my display name, banner, pinned post, and description because I didn’t include those elements in the data I was pushing. That’s why the Apple Shortcut includes the step of fetching the existing profile data, so that even though nothing else changes it can be fed back into the POST request along with the avatar update.

Here’s a copy of [the Apple Shortcut file](https://www.icloud.com/shortcuts/dd304c7087b84a90bd7286c887e94caa) if you’re interested in looking at the “code” yourself or modifying it.

## Future Updates and Ideas

I’d like to create a Version 2 of this project in a few weeks that adds some additional elements like logic paths and layers that display based on weather data (fog, rain, cloud cover, rare random events like shooting stars, etc). It would also be nice to automate my banner image to match the backgrounds of the avatar.

In addition to this automation, I also added a dynamic bio to my status update account ([@now.dame.is](https://bsky.app/profile/did:plc:jucg4ddb2budmcy2pjo5fo2g)) that includes regularly updated data about my current psychological state + environment (focus level, mood, current song, indoor temp, etc).

![A screenshot of my status update profile showing dynamic data](/images/blog/automated-avatar-graphics/bio-profile.png "bio profile example")

Using Apple Shortcuts to automate Bluesky data has a lot of interesting experimental potential thanks to the large number of automation triggers that Apple provides. Everything from sound recognition to whether or you’re stationary or not... and don’t even get me started with NFC tags. I hope we see more people trying weird things in the future.

Special shout out to [@cagrimmett.com](https://bsky.app/profile/did:plc:xs7gyx2tysuh5dy33bvgkntb) for sharing [this template](https://www.icloud.com/shortcuts/aea8c8f6cb074e179be0a28ff2145c48) that saved me a bunch of time  I would’ve spent trying to figure out how to setup the session/auth functions.