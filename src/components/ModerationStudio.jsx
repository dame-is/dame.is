// The moderation hub's entry point, kept at this path because the admin's
// studio table (src/admin/panes/StudioPane.jsx) imports it from here.
//
// The hub itself lives in ./moderation/, over the bluesky-mod bot's API: a
// review queue, the people on the list, the changes and scans that put them
// there, a place to check a post or an account before acting, the shield, and
// settings. See ./moderation/ModerationApp.jsx.

export { default } from './moderation/ModerationApp.jsx';
