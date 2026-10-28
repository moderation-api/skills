---
name: moderation-api-setup
description: Set up Moderation API (moderationapi.com) content moderation in an existing codebase - link or create the project with the modapi CLI, find where users create content, add the moderation call, act on the result, and verify webhooks. Use when the user asks to add content moderation, set up or integrate Moderation API, moderate user-generated content (messages, posts, comments, profiles, uploads), or block spam, scams or abuse in their app.
---

# Set up Moderation API

You add Moderation API to the user's existing app. The `modapi` CLI does the
account work (sign-in, project, keys). You do the code: find where users create
content, moderate it on the server, and act on the result.

Work in this order. Ask before each change to the user's code or account.

## Which tool does which job

Moderation API has three tools for agents. Use each one for its own job:

| Tool | Job |
|------|-----|
| This skill | Write the integration in the user's code. |
| `modapi` CLI | Sign in, create or link the project, write the keys, check the setup (`init`, `doctor`). |
| MCP server (`https://mcp.moderationapi.com/mcp`) | Operate the account: review queues, authors, policies (channels), wordlists, webhooks, stats. |

Do not do account work with hand-written API calls when the CLI or the MCP
server does it. Do not ask for keys in the chat: the CLI writes them.

## Use the docs

This skill gives the steps and the decisions. The docs give the details, and
they change with the API. Before you use a field, event or option that this
skill does not show, read its page:

- Index of all pages: `https://docs.moderationapi.com/llms.txt`. Add `.md` to
  any docs URL to get the page as Markdown.
- Exact request and response fields: the API reference pages listed there, or
  `modapi <command> --schema` for a request body.
- If the docs and the SDK types disagree, follow the SDK types and tell the
  user.

## 1. Check the starting point

- Run `modapi --version`. If it is missing or older than 0.4.0, install it:
  `brew install moderation-api/tap/modapi` (`brew upgrade modapi` to update),
  or `curl -fsSL https://raw.githubusercontent.com/moderation-api/cli/main/scripts/install.sh | bash`,
  or `go install github.com/moderation-api/cli/cmd/modapi@latest`.
- Run `modapi doctor -o json` in the project root. It tells you if a project
  key exists, if it works, if the SDK is installed, and if the env file is in
  `.gitignore`. Each check that is not `ok` has a `remedy`.
- If `doctor` says the user is not signed in, ask them to run `modapi login`
  now (it opens their browser; `modapi login --device` over SSH). The next
  steps need it.
- Search the code for an existing integration (`@moderation-api/sdk`,
  `moderation_api`, `moderation-api/sdk-php`, `moderationapi.com`). If one
  exists, do not set up a second one: fill the gaps doctor reports.
- Check if a ready-made integration fits better than code. Tell the user and
  ask before you write code:
  - **WordPress site**: install the
    [Moderation API plugin](https://wordpress.org/plugins/moderation-api-automated-content-moderation/),
    then connect the site under **Integrate → Platforms** in the dashboard.
  - **Discord server** or **Slack workspace** that the user wants moderated:
    connect it under **Integrate → Platforms** in the dashboard. No code.
  - Other platforms: see https://moderationapi.com/integrations.

  A custom app that has its own Discord or Slack bot code is not this case:
  add the moderation call to the bot's code.
- If the app already uses another moderation service, stop and ask the user
  whether to replace it or run both.

## 2. Plan and get approval

Read the codebase and write a short plan for the user:

- **The project**: a new Moderation API project, or one the user already has.
  `modapi projects list -o json` shows their projects. Ask which to use; do
  not pick one for them.
- **Shadow mode**: ask if they want to start in shadow mode. In shadow mode
  (`DRY_RUN`) Moderation API analyzes everything, and the dashboard and review
  queue show the real results, but every response says `allow`. The app
  changes nothing for users while the team checks the results. Switching it
  on later is one command, with no code change. Recommend it for an app that
  is already live.
- **The platform**: what it is, who uses it, whether children use it. For a
  new project you pass this to `init` so it suggests the right policies.
- **The content entry points**: every server-side place where user content is
  created or changed, for example chat messages, posts, comments, reviews,
  profile names and bios, listing titles, image uploads. Give file and function.
- **Channels**: one channel for each kind of content (for example `messages`,
  `posts`, `profiles`, `reviews`). Each channel has its own policies, and
  webhooks tell you the channel, so the app knows which table to update.
- **For each entry point**: its channel, and what to do on `reject` and
  `review` (see step 5).
- **Content not saved yet**: if an entry point moderates before the record
  exists, choose one way (see step 4) and say which.
- **Webhooks**: whether the app needs to act when a moderator decides later.

Show the plan and wait for a "yes". Moderation policy is a product decision:
propose, do not decide alone.

## 3. Link or create the project

To use a project the user already has:

```bash
modapi init --project "<project ID or name>" -o json
```

To create a new one:

```bash
modapi init --new --name "<app name>" --domain <their domain> \
  --context "<what the platform is and who uses it>" \
  --brief "<what to moderate: the problems and the guidelines>" \
  [--used-by-minors] -o json
```

- Without `--project` or `--new`, init fails with `validation_error` when the
  organization has projects, and lists them. Ask the user, then run it again
  with their choice.
- Linking makes a new key for the project, named after this computer and
  directory. The project's other keys keep working.
- `init` writes `MODAPI_SECRET_KEY` and `MODAPI_WEBHOOK_SECRET` to `.env.local`
  (Next.js) or `.env`, and adds that file to `.gitignore`. It never prints them.
- If it fails with `authentication_error`, the user must sign in. Ask them to
  run `modapi login` (it opens their browser; `modapi login --device` over SSH).
  Do not ask for keys in the chat.
- If `status` is `already_set_up`, a key exists: keep it and continue.
- Run `--dry-run -o json` first if you want to see what init will do.
- Add `--install` to install the SDK, or run the `install_command` from the
  result. There is no Go SDK: in Go, call the REST API.
- `init --dry-run` only previews what `init` does. It is not shadow mode.

Then set up what the plan agreed:

- **Channels**: `modapi channels list --project-id <id> -o json` shows the
  existing ones. Add one with
  `modapi channels create --project-id <id> --name "Messages" --key messages --content-type message -o json`.
- **Shadow mode**: `modapi projects update <id> --global-flagging-mode DRY_RUN`
  for the whole project, or `modapi channels update <id> --flagging-mode DRY_RUN`
  for one channel.

## 4. Add the moderation call

Make one small helper in the app's server code that calls `content.submit`,
and call it from each approved entry point. Snippets for each SDK are in
[references/sdk-snippets.md](references/sdk-snippets.md).

Send with every call:

- `content`: `{type: "text", text}`, `{type: "image", url}`, or
  `{type: "object", data: {...}}` for content with several fields (a listing
  with title, description and photos).
- `channel`: the channel key for this entry point.
- `contentId`: the ID of the record in the app's database. Webhooks send it
  back as `item.id`. Sending the same `contentId` again (after an edit)
  updates the item instead of adding a second one.
- `authorId`: the user's ID. It turns on author trust levels and blocking.
- `conversationId`: the chat, thread or room, when there is one. It gives the
  AI the context of the conversation.
- `metadata`: optional small facts that help reviewers.

**Content not saved yet.** Choose one way per entry point:

- Moderate first (recommended when `reject` must stop the content): leave out
  `contentId`. The API makes one and returns it as `content.id`. Save it on
  the record, so webhooks can find the record later.
- Save first, then moderate with the new ID, and delete or hide the record on
  `reject`. Simpler IDs, but rejected content exists for a moment.

**The app's own spam checks.** If the app already has a verdict (IP ban,
CAPTCHA fail, fraud score), send it as `clientAction`, for example
`{action: "review", behavior: "escalate", source: "fraud-score", reason: "..."}`.
`escalate` only makes the result stricter; `override` replaces it. Do not run
the two checks side by side: with `clientAction`, moderators see the app's
verdict in the review queue.

**Authors.** Moderators work better when they know who wrote the content.
When a user signs up or changes their profile, send their name, email,
profile picture and profile link (`external_link`) with `authors.create` or
`authors.update` (`external_id` = the `authorId` you send). See
https://docs.moderationapi.com/users/updating-authors.md. For more context
in the review queue (plan, admin links), the team can set up
[custom data](https://docs.moderationapi.com/users/custom-data.md) later.

**User reports.** If the app lets users report content, send each report
with `actions.execute` and a report action, so it goes to the review queue.
See https://docs.moderationapi.com/guides/user-flagged-content.md. Propose it
in the plan; do not build it unasked.

**Reviews in the app's own tool.** If moderators decide in the app's own admin
tool instead of the review queue, send each decision with `content.allow` or
`content.reject` and `moderator` (the reviewer's email or user ID in the
organization). Without `moderator`, the decision counts as automated: it is
not attributed to anyone and does not become a casebook case. An unknown
`moderator` is a 400 error. See
https://docs.moderationapi.com/actions/content-actions.md.

## 5. Act on the result

Read `recommendation.action`:

| Action   | Default handling |
|----------|------------------|
| `allow`  | Save and publish as normal. |
| `review` | Save it, and hide it or publish it, as agreed in the plan. It is in the review queue for a moderator. |
| `reject` | Do not publish. Show the user a short, neutral message. |

Treat any other value as `review`: the SDK types allow values that may be
added later.

Also read:

- `content.modified`: when it is not `null`, the API masked part of the
  content (for example contact details or URLs). Save and show this version,
  not the original. For object content it holds the fields.
- `policies[].flagged_fields` (object content): the keys of the fields that a
  policy flagged. Hold back only those fields, not the whole update, when the
  plan says so.
- `author.block` and `author.trust_level`: a blocked author's content can be
  refused without a call.

In shadow mode the action is always `allow` and `reason_codes` has `dry_run`.
Keep the full handling code anyway, so switching shadow mode off needs no
code change.

Rules:

- Call from the server only. The key must never reach the browser or the app bundle.
- **Fail open.** If the API is down or times out, log it and allow the content,
  so moderation never stops users from posting. Use a short timeout.
- Moderate on create and on edit.
- Do not store the full API response on every record. `contentId` is enough
  to find it in the dashboard.

## 6. Webhooks (when the plan needs them)

Moderators decide on `review` items later in the dashboard. A webhook tells the
app the decision.

1. Add a POST route, for example `/webhooks/moderation`. Verify the signature
   against the **raw** request body with the SDK (`validateWebhook` in
   TypeScript, `construct_event` in Python and Ruby, `constructEvent` in PHP).
   They read `MODAPI_WEBHOOK_SECRET`. See the snippets file.
2. Handle `event.type`. In `queue_item.*` events, `data.object.item` has
   `id` (the `contentId` you sent, or the generated `content.id`),
   `author_id` (your user ID) and `channel_key` (route on it to find the
   right table):
   - `queue_item.rejected`: hide or delete the content.
   - `queue_item.allowed`: publish content you held for review.
   - `queue_item.action`: a custom action; `data.object.key` names it.
   - `author.blocked` / `author.suspended` / `author.unblocked`: update the
     user. These events have no `item`: your user ID is
     `data.object.author.external_id`, and `author.block.until` is a time in
     **milliseconds** (or `null`).

   The full payloads are at https://docs.moderationapi.com/actions/webhooks.md.
3. Register the URL once it is public:
   `modapi webhooks create --name "App" --url https://<host>/webhooks/moderation -e QUEUE_ITEM_REJECTED -e QUEUE_ITEM_ALLOWED -e AUTHOR_BLOCKED`
   For local testing, use a tunnel (for example `ngrok http 3000`).

## 7. Verify

First check the code against these common mistakes. Fix each one, or tell
the user why it does not apply:

- [ ] The code acts on `recommendation.action`, not on `evaluation.flagged`.
      The recommendation includes the team's rules, thresholds and review
      routing; `flagged` only says that a policy matched.
- [ ] `review` has its own handling, not the same as `allow` or `reject`.
- [ ] Every place where users create content is covered, not only text:
      images, profile names and bios, display names, uploads.
- [ ] Blocked authors are handled: the app reads `author.block`, or acts on
      the `author.blocked` webhook.
- [ ] Webhooks are set up when content can be held for review, or when the
      team takes actions in the dashboard (block an author, reject later).
      Without them, the app never learns the decision.
- [ ] The webhook route checks the signature on the raw body, and handles
      the same event twice without harm (webhooks are retried).
- [ ] Every call sends `authorId`, and `conversationId` where content is part
      of a chat or thread. They turn on author history and context.
- [ ] Content that users can edit sends a stable `contentId`, and edits are
      moderated again with the same `contentId`.
- [ ] Each kind of content uses its own `channel`.
- [ ] Calls run on the server only, with a short timeout, and fail open.
- [ ] No key is in the code, in a committed file, or in the chat.

Then:

1. Run `modapi doctor`. Fix every `fail`.
2. Send one test: `modapi content submit --content '{"type":"text","text":"Buy followers now, DM me on WhatsApp +1 555 0100"}' --jq '.recommendation.action'`
3. Start the app and create content through one real entry point. Confirm the
   request in the dashboard (the link is in the `init` result).
4. Tell the user what you changed, file by file, and give them the link to
   review the suggested policies.
5. In shadow mode, tell the user how to go live when they trust the results:
   `modapi projects update <id> --global-flagging-mode ACTIVE` (or
   `modapi channels update <id> --flagging-mode ACTIVE` per channel).

## 8. Next: operate it with the MCP server

When the integration works, tell the user what their agent can do next with
the MCP server. Give two or three examples that fit their app, for example:

- "Go through today's unresolved queue items, resolve the obvious spam, and
  show me the ones you are unsure about."
- "Is user 8812 a bad actor? Check their history and block them if it is a
  pattern."
- "These comments were flagged but are fine, and these got through. Fix the
  policy."
- "How did moderation go this month?"

If tools named like `queue-items-list` or `channels-update` are already
available to you, the server is connected (the Moderation API plugin includes
it): say so and stop. If not, give the connect steps for the user's agent:

- Claude Code: `claude mcp add --transport http moderation-api https://mcp.moderationapi.com/mcp`
- Claude Desktop or claude.ai: Settings > Connectors > Add custom connector,
  with the URL above.
- Cursor and other clients: add a remote MCP server with the URL above.

The user signs in with their Moderation API account in the browser (OAuth).
Do not connect it without asking.

## When Moderation API cannot do it

If the user asks for something that Moderation API does not seem to support:

1. Check first. Search the docs (`https://docs.moderationapi.com/llms.txt`),
   the MCP tools if connected, and `modapi --help`. Only say it is not possible
   after this check.
2. Tell the user plainly what is not supported. Give the closest thing that
   works today, if there is one. Never make up an endpoint, a parameter or an
   SDK method.
3. Offer to file a feature request with the Moderation API team. Draft it
   with:
   - what the user tried to do, and why (their use case)
   - what you checked, and the workaround you used, if any
   - the language, framework and SDK
4. Show the draft to the user. Do not put user content, keys or personal
   data in it unless the user adds them. Send it only after the user says yes:
   use the MCP server's feedback tool if it has one, or else give the user the
   draft to paste at https://moderationapi.productlane.com/request.

## Never

- Print, read aloud or commit `.env` values. Refer to them by name.
- Ask the user to paste an API key into the chat. Use `modapi login`, or ask
  them to put the key in the env file themselves.
- Call the API from client-side code.
- Create test users, test content or a second project in an existing app
  without asking.
- Send a feature request or any other message to Moderation API without the
  user's yes.
