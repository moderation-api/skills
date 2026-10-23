# SDK snippets

A moderation helper and a webhook route for each official SDK. Adapt names
and file paths to the codebase; keep the behavior: server-side only, short
timeout, fail open, raw body for webhooks.

All SDKs read the key from `MODAPI_SECRET_KEY` and the webhook secret from
`MODAPI_WEBHOOK_SECRET` (written by `modapi init`).

## TypeScript / JavaScript (`@moderation-api/sdk`)

```typescript
// lib/moderation.ts (server only)
import { ModerationApi } from "@moderation-api/sdk";

const moderationApi = new ModerationApi({
  secretKey: process.env.MODAPI_SECRET_KEY ?? "",
  timeoutMs: 5_000,
});

export type ModerationDecision = "allow" | "review" | "reject";

export async function moderateText(input: {
  text: string;
  contentId: string;
  authorId?: string;
  conversationId?: string;
}): Promise<ModerationDecision> {
  try {
    const result = await moderationApi.content.submit({
      content: { type: "text", text: input.text },
      contentId: input.contentId,
      authorId: input.authorId,
      conversationId: input.conversationId,
    });
    return result.recommendation.action;
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
  const item = event.data?.object?.item;
  switch (event.type) {
    case "queue_item.rejected":
      // hide the record with id item.id
      break;
    case "queue_item.allowed":
      // publish the record with id item.id
      break;
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
import os

from moderation_api import ModerationAPI

client = ModerationAPI(secret_key=os.environ.get("MODAPI_SECRET_KEY", ""), timeout_ms=5_000)
log = logging.getLogger(__name__)


def moderate_text(text: str, content_id: str, author_id: str | None = None,
                  conversation_id: str | None = None) -> str:
    """Return "allow", "review" or "reject"."""
    try:
        res = client.content.submit(
            content={"type": "text", "text": text},
            content_id=content_id,
            author_id=author_id,
            conversation_id=conversation_id,
        )
        return res.recommendation.action
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
  CLIENT = ::ModerationApi::ModerationApi.new(
    secret_key: ENV.fetch("MODAPI_SECRET_KEY", ""),
    timeout_ms: 5_000
  )

  # Returns "allow", "review" or "reject".
  def self.moderate_text(text:, content_id:, author_id: nil, conversation_id: nil)
    res = CLIENT.content.submit(
      body: Ops::SubmitContentRequestBody.new(
        content: Ops::TextRequest.new(type: "text", text: text),
        content_id: content_id,
        author_id: author_id,
        conversation_id: conversation_id
      )
    )
    res.object&.recommendation&.action || "allow"
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

function moderateText(string $text, string $contentId, ?string $authorId = null): string
{
    static $sdk = null;
    $sdk ??= ModerationApi::builder()
        ->setSecurity(getenv('MODAPI_SECRET_KEY') ?: '')
        ->setClient(new \GuzzleHttp\Client(['timeout' => 5]))
        ->build();

    try {
        $response = $sdk->content->submit(body: new Operations\SubmitContentRequestBody(
            content: new Operations\TextRequest(text: $text),
            contentId: $contentId,
            authorId: $authorId,
        ));
        return $response->object?->recommendation?->action ?? 'allow';
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

POST `https://moderationapi.com/api/v1/moderate` with
`Authorization: Bearer $MODAPI_SECRET_KEY` and the same JSON body
(`content`, `contentId`, `authorId`, `conversationId`). Use an
`http.Client{Timeout: 5 * time.Second}` and fail open. Verify webhooks with
HMAC-SHA256 over the raw body, hex-encoded, compared in constant time with the
`modapi-signature` header.
