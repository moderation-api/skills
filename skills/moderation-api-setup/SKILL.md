---
name: moderation-api-setup
description: Set up Moderation API (moderationapi.com) content moderation in an existing codebase - link or create the project with the modapi CLI, find where users create content, add the moderation call, act on the result, and verify webhooks. Use when the user asks to add content moderation, set up or integrate Moderation API, moderate user-generated content (messages, posts, comments, profiles, uploads), or block spam, scams or abuse in their app.
---

# Set up Moderation API

You add Moderation API to the user's existing app. The `modapi` CLI does the
account work (sign-in, project, keys). You do the code: find where users create
content, moderate it on the server, and act on the result.

Work in this order. Ask before each change to the user's code or account.

## 1. Check the starting point

- Run `modapi --version`. If it is missing or older than 0.4.0, install it:
  `brew install moderation-api/tap/modapi` (`brew upgrade modapi` to update),
  or `curl -fsSL https://raw.githubusercontent.com/moderation-api/cli/main/scripts/install.sh | bash`,
  or `go install github.com/moderation-api/cli/cmd/modapi@latest`.
- Run `modapi doctor -o json` in the project root. It tells you if a project
  key exists, if it works, if the SDK is installed, and if the env file is in
  `.gitignore`. Each check that is not `ok` has a `remedy`.
- Search the code for an existing integration (`@moderation-api/sdk`,
  `moderation_api`, `moderation-api/sdk-php`, `moderationapi.com`). If one
  exists, do not set up a second one: fill the gaps doctor reports.
- If the app already uses another moderation service, stop and ask the user
  whether to replace it or run both.

## 2. Plan and get approval

Read the codebase and write a short plan for the user:

- **The project**: a new Moderation API project, or one the user already has.
  `modapi projects list -o json` shows their projects (if `doctor` says they
  are not signed in, ask them to run `modapi login` first). Ask which to use;
  do not pick one for them.
- **The platform**: what it is, who uses it, whether children use it. For a
  new project you pass this to `init` so it suggests the right policies.
- **The content entry points**: every server-side place where user content is
  created or changed, for example chat messages, posts, comments, reviews,
  profile names and bios, listing titles, image uploads. Give file and function.
- **For each entry point**: what to do on `reject` and `review` (see step 5).
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

## 4. Add the moderation call

Make one small helper in the app's server code that calls `content.submit`,
and call it from each approved entry point. Snippets for each SDK are in
[references/sdk-snippets.md](references/sdk-snippets.md).

Send with every call:

- `content`: `{type: "text", text}`, `{type: "image", url}`, or
  `{type: "object", data: {...}}` for content with several fields (a listing
  with title, description and photos).
- `contentId`: the ID of the record in the app's database. Webhooks send it back.
- `authorId`: the user's ID. It turns on author trust levels and blocking.
- `conversationId`: the chat, thread or room, when there is one. It gives the
  AI the context of the conversation.
- `metadata`: optional small facts that help reviewers, for example the surface.

## 5. Act on the result

Read `recommendation.action`:

| Action   | Default handling |
|----------|------------------|
| `allow`  | Save and publish as normal. |
| `review` | Save it, and hide it or publish it, as agreed in the plan. It is in the review queue for a moderator. |
| `reject` | Do not publish. Show the user a short, neutral message. |

Also read `author.block` and `author.trust_level`: a blocked author's content
can be refused without a call.

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
2. Handle `event.type`. The event's `data.object.item.id` is the `contentId`
   you sent, and `item.author_id` is your user ID:
   - `queue_item.rejected`: hide or delete the content.
   - `queue_item.allowed`: publish content you held for review.
   - `author.blocked` / `author.suspended` / `author.unblocked`: update the user.
   - `queue_item.action`: a custom action; `data.object.key` names it.
3. Register the URL once it is public:
   `modapi webhooks create --name "App" --url https://<host>/webhooks/moderation -e QUEUE_ITEM_REJECTED -e QUEUE_ITEM_ALLOWED -e AUTHOR_BLOCKED`
   For local testing, use a tunnel (for example `ngrok http 3000`).

## 7. Verify

1. Run `modapi doctor`. Fix every `fail`.
2. Send one test: `modapi content submit --content '{"type":"text","text":"Buy followers now, DM me on WhatsApp +1 555 0100"}' --jq '.recommendation.action'`
3. Start the app and create content through one real entry point. Confirm the
   request in the dashboard (the link is in the `init` result).
4. Tell the user what you changed, file by file, and give them the link to
   review the suggested policies.

## Never

- Print, read aloud or commit `.env` values. Refer to them by name.
- Ask the user to paste an API key into the chat. Use `modapi login`, or ask
  them to put the key in the env file themselves.
- Call the API from client-side code.
- Create test users, test content or a second project in an existing app
  without asking.
