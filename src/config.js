// Site-wide constants. Keep in sync with new_plan.md §"Constants".

export const ME_DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
export const ME_HANDLE = 'dame.is';
export const BIRTHDATE = '1993-05-07T00:00:00Z';
export const GITHUB_REPO = 'dame-is/dame.is';
export const APPVIEW = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';

// PDS collections — gerund-framed under is.dame.*.
export const COLLECTIONS = {
  now: 'is.dame.now',
  blogging: 'is.dame.blogging.post',
  creating: 'is.dame.creating.work',
  page: 'is.dame.page',
  profile: 'is.dame.profile',
  // teal.fm play records — confirm exact NSID before build.
  listen: 'fm.teal.alpha.feed.play',
};

// Verbs used in the unified feed timeline.
export const VERBS = ['logging', 'posting', 'blogging', 'listening', 'creating'];
