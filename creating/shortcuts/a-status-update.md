---
layout: post
title: a.status.update
date: 2025-05-19T12:30:00-05:00
blueskyUri: "3lpk2f4ebdc26"
ogImage: /images/shortcuts/a-status-update-og-image.jpg
excerpt: Quickly share old-school status updates to a Bluesky account or custom lexicon without having to open the app. Assign it to the iPhone's action button for even faster access!
---

Quickly share old-school status updates to a Bluesky account or custom lexicon without having to open the app. I recommend you create a separate Bluesky account to serve as your "status update" acount. See mine here: [@now.dame.is](https://bsky.app/profile/did:plc:jucg4ddb2budmcy2pjo5fo2g). Assign the shortcut to your iPhone's action button for even faster access!

Read more about the inspiration behind this project and trend in [a blog post I wrote about it](https://dame.is/writing/blogs/why-i-started-posting-like-its-the-2000s-again/). Discover more status update accounts via [the Bluesky list/feed]( https://bsky.app/profile/dame.is/lists/3loy6eehhef2k). To have your status update account added to the list, mention @dame.is.

<div class="responsive-iframe-container">
<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/DV-mYClT_Tc?si=-9w82-cLt6m_5dNW&amp;controls=0" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>

## Features

- post to 2 different accounts at once
- use a custom lexicon, the bsky post lex, or both
- foundation for dynamic bios
- supports did:web
- works with third-party PDS accounts
- update notification if new version is available

[Download Shortcut](https://www.icloud.com/shortcuts/3312d6121107494c9554363d5e12000b)

## Instructions

1. When you install the shortcut it should prompt you to add at least one username and app password. If this doesn't happen, open the code of the shortcut within the Shortcuts app and scroll down a little bit until you see 2 text fields with variables called firstUsername and firstPassword. Add your data to these two text fields.

2. If you scroll down further in the shortcut's code, you can adjust some settings by toggling boolean values between true/false. By default the shortcut creates new Bluesky posts for the first account and custom lexicon records for the second account. This is my personal setup because I share the status updates to @now.dame.is and then they also get saved to the PDS for @dame.is as a custom lexicon.

3. The default custom lexicon NSID is a.status.update. You can leave this as-is or add your own. [See the NSID spec for limitations](https://atproto.com/specs/nsid).

4. If you have any questions or issues, don't hesitate to reach out!