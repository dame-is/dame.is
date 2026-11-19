# bluesky-mod-client

Build your own admin page for a [bluesky-mod](https://github.com/dame-is/bluesky-mod) bot, on your own site and in your own styles.

```bash
npm install bluesky-mod-client
```

```js
import { createClient, bandName } from 'bluesky-mod-client';

const bot = createClient({ baseUrl: 'https://mod.example.com', auth: { token } });
const queue = await bot.queue();
```

What is in it:

- `createClient`: every route of the bot's API, signed in with a panel session token or a service-auth token from your own PDS
- the band names and their order, and how someone came to be on the list
- builders for the bot's commands, so a page sends what a DM would
- the radar's layout: where each account goes, for you to draw
- number and time formats that match the bot's DMs

No CSS, no framework and no dependencies.

The guide is [YOUR-OWN-ADMIN.md](https://github.com/dame-is/bluesky-mod/blob/main/docs/YOUR-OWN-ADMIN.md), and [API.md](https://github.com/dame-is/bluesky-mod/blob/main/docs/API.md) lists every route. This version works with bots that serve API version 1 (`(await bot.me()).apiVersion`).

MIT licence.
