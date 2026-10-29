# SDK snippets

A moderation helper and a webhook route for each official SDK. Adapt names
and file paths to the codebase; keep the behavior: server-side only, short
timeout, fail open, raw body for webhooks.

`modapi init` writes `MODAPI_SECRET_KEY` and `MODAPI_WEBHOOK_SECRET` to the env
file. Every SDK reads both from the environment, so the snippets pass neither:
do not read the key in code. Ruby needs `moderation_api` 3.4.0 or later and PHP
needs `moderation-api/sdk-php` 1.4.0 or later for this; upgrade older versions.

In every language:

- Pass the entry point's channel key as `channel`.
- Treat any action other than `allow` and `reject` as `review`. New actions
  can be added later; each snippet maps them in code.
- `contentId` is optional: without it, save `content.id` from the response.

## TypeScript / JavaScript (`@moderation-api/sdk`)

```typescript
// lib/moderation.ts (server only)
import { ModerationApi } from "@moderation-api/sdk";

const moderationApi = new ModerationApi({ timeoutMs: 5_000 }); // reads MODAPI_SECRET_KEY

export type ModerationDecision = "allow" | "review" | "reject";

// The SDK types allow actions added later. Treat unknown ones as "review".
function toDecision(action: string): ModerationDecision {
  return action === "allow" || action === "reject" ? action : "review";
}

export async function moderateText(input: {
  text: string;
  channel: string;
  contentId?: string;
  authorId?: string;
  conversationId?: string;
}): Promise<ModerationDecision> {
  try {
    const result = await moderationApi.content.submit({
      content: { type: "text", text: input.text },
      channel: input.channel,
      contentId: input.contentId,
      authorId: input.authorId,
      conversationId: input.conversationId,
    });
    return toDecision(result.recommendation.action);
  } catch (error) {
    // Fail open: never block users because moderation is unreachable.
    console.error("Moderation API call failed", error);
    return "allow";
  }
}
```

Images: `content: { type: "image", url }`. Several fields at once:
`content: { type: "object", data: { title: { type: "text", text: title }, photo: { type: "image", url } } }`.

Webhook route (Fetch API: Next.js App Router, Hono, Bun, Workers):

```typescript
// app/api/webhooks/moderation/route.ts
import { validateWebhook } from "@moderation-api/sdk";

export async function POST(request: Request) {
  let event;
  try {
    event = await validateWebhook({ request }); // reads MODAPI_WEBHOOK_SECRET
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  // `event.type` narrows `event.data.object`: queue item events have `item`,
  // author events have `author` (your user ID is `author.external_id`).
  switch (event.type) {
    case "queue_item.rejected": {
      const item = event.data.object.item;
      // hide the record with id item?.id in the table for item?.channel_key
      break;
    }
    case "queue_item.allowed": {
      const item = event.data.object.item;
      // publish the record with id item?.id
      break;
    }
    case "author.blocked": {
      const author = event.data.object.author;
      // block the user with id author.external_id
      break;
    }
  }
  return new Response(null, { status: 200 });
}
```

Express: mount the route with `express.raw({ type: "application/json" })` so
`req.body` is the raw body, then `await validateWebhook({ request: req })`.
Next.js Pages Router: `export const config = { api: { bodyParser: false } }`.

## Python (`moderation_api`)

```python
# moderation.py (server only)
import logging
from typing import Literal

from moderation_api import ModerationAPI

client = ModerationAPI(timeout_ms=5_000)  # reads MODAPI_SECRET_KEY
log = logging.getLogger(__name__)

ModerationDecision = Literal["allow", "review", "reject"]


def to_decision(action: str) -> ModerationDecision:
    """The SDK accepts actions added later. Treat unknown ones as "review"."""
    if action == "allow":
        return "allow"
    if action == "reject":
        return "reject"
    return "review"


def moderate_text(text: str, channel: str, content_id: str | None = None,
                  author_id: str | None = None,
                  conversation_id: str | None = None) -> ModerationDecision:
    try:
        res = client.content.submit(
            content={"type": "text", "text": text},
            channel=channel,
            content_id=content_id,
            author_id=author_id,
            conversation_id=conversation_id,
        )
        return to_decision(res.recommendation.action)
    except Exception:  # fail open
        log.exception("Moderation API call failed")
        return "allow"
```

Webhook (Flask; in Django use `request.body`, in FastAPI `await request.body()`):

```python
from flask import request
from moderation_api.webhook_signature import WebhookSignatureError, construct_event

@app.post("/webhooks/moderation")
def moderation_webhook():
    try:
        event = construct_event(request.get_data(), request.headers.get("modapi-signature", ""))
    except WebhookSignatureError:
        return "Invalid signature", 400
    item = event["data"]["object"].get("item", {})
    if event["type"] == "queue_item.rejected":
        ...  # hide the record with id item["id"]
    return "", 200
```

## Ruby (`moderation_api`)

```ruby
# app/services/moderation.rb
require "moderation_api"

module Moderation
  Ops = ::ModerationApi::Models::Operations
  CLIENT = ::ModerationApi::ModerationApi.new(timeout_ms: 5_000) # reads MODAPI_SECRET_KEY

  # The SDK returns the action as an enum that accepts actions added later.
  # Treat unknown ones as "review".
  def self.to_decision(action)
    value = action.to_s
    %w[allow reject].include?(value) ? value : "review"
  end

  # Returns "allow", "review" or "reject".
  def self.moderate_text(text:, channel:, content_id: nil, author_id: nil, conversation_id: nil)
    res = CLIENT.content.submit(
      body: Ops::SubmitContentRequestBody.new(
        content: Ops::TextRequest.new(type: "text", text: text),
        channel: channel,
        content_id: content_id,
        author_id: author_id,
        conversation_id: conversation_id
      )
    )
    to_decision(res.object&.recommendation&.action)
  rescue StandardError => e # fail open
    Rails.logger.error("Moderation API call failed: #{e.message}")
    "allow"
  end
end
```

Webhook (Rails controller; skip CSRF protection for this action):

```ruby
require "moderation_api/webhook_signature"

def moderation_webhook
  event = ModerationApi::WebhookSignature.construct_event(
    request.raw_post, request.headers["modapi-signature"]
  )
  item = event.dig("data", "object", "item") || {}
  # case event["type"] when "queue_item.rejected" then hide item["id"]
  head :ok
rescue ModerationApi::WebhookSignature::VerificationError
  head :bad_request
end
```

## PHP (`moderation-api/sdk-php`)

```php
use ModerationApi\ModerationApi;
use ModerationApi\Models\Operations;
use ModerationApi\Models\Operations\ActionResponse;

/** @return 'allow'|'review'|'reject' */
function toDecision(?ActionResponse $action): string
{
    return match ($action) {
        ActionResponse::Allow, ActionResponse::Reject => $action->value,
        default => 'review',
    };
}

/** @return 'allow'|'review'|'reject' */
function moderateText(string $text, string $channel, ?string $contentId = null, ?string $authorId = null): string
{
    static $sdk = null;
    $sdk ??= ModerationApi::builder() // reads MODAPI_SECRET_KEY
        ->setClient(new \GuzzleHttp\Client(['timeout' => 5]))
        ->build();

    try {
        $response = $sdk->content->submit(body: new Operations\SubmitContentRequestBody(
            content: new Operations\TextRequest(text: $text),
            channel: $channel,
            contentId: $contentId,
            authorId: $authorId,
        ));
        return toDecision($response->object?->recommendation->action);
    } catch (\Speakeasy\Serializer\Exception\Exception $e) {
        // The API answered, but this SDK version could not read the response.
        // Its action enum is closed, so an action added later ends up here.
        error_log('Moderation API response not readable: ' . $e->getMessage());
        return 'review';
    } catch (\Throwable $e) { // fail open
        error_log('Moderation API call failed: ' . $e->getMessage());
        return 'allow';
    }
}
```

Webhook:

```php
use ModerationApi\WebhookSignature;
use ModerationApi\WebhookSignatureException;

$payload = file_get_contents('php://input'); // raw body
try {
    $event = WebhookSignature::constructEvent($payload, $_SERVER['HTTP_MODAPI_SIGNATURE'] ?? null);
} catch (WebhookSignatureException $e) {
    http_response_code(400);
    exit;
}
$item = $event['data']['object']['item'] ?? [];
// if ($event['type'] === 'queue_item.rejected') hide $item['id']
http_response_code(200);
```

In Laravel, read the raw body with `$request->getContent()` and exclude the
route from CSRF verification.

## Go (no SDK)

Call the submit-content endpoint from the API reference with the same JSON
body (`content`, `contentId`, `authorId`, `conversationId`). Load the secret
key the same way as the other snippets and send it as a Bearer token. Use an
`http.Client{Timeout: 5 * time.Second}` and fail open. Verify webhooks with
HMAC-SHA256 over the raw body, hex-encoded, compared in constant time with the
`modapi-signature` header.
