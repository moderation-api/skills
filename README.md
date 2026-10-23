# Moderation API skills

Skills that help AI coding agents add [Moderation API](https://moderationapi.com) to your app. They follow the [Agent Skills](https://agentskills.io/) format.

## Install

### Any agent

```bash
npx skills add moderation-api/skills
```

### Claude Code

The plugin includes the skills and the [Moderation API MCP server](https://mcp.moderationapi.com/mcp).

```
/plugin marketplace add moderation-api/skills
/plugin install moderation-api@moderation-api
```

## Skills

| Skill | What it does |
| --- | --- |
| [moderation-api-setup](skills/moderation-api-setup/SKILL.md) | Sets up Moderation API in an existing codebase: creates the project with the [`modapi` CLI](https://github.com/moderation-api/cli), finds where users create content, adds the moderation call, acts on the result and verifies webhooks. |

After you install, ask your agent to "set up Moderation API".

## What the plugin runs and sends

The plugin has no hooks and no local code. It has one skill and one remote MCP server.

- **MCP server:** `https://mcp.moderationapi.com/mcp`, run by Moderation API. You sign in with your Moderation API account (OAuth). Tool calls go to the Moderation API for your organization.
- **The skill** tells the agent to do these things, and to ask you before each change to your code or account:
  - Install the `modapi` CLI if it is missing: with Homebrew (`moderation-api/tap/modapi`), the install script at `https://raw.githubusercontent.com/moderation-api/cli/main/scripts/install.sh`, or `go install`.
  - Run `modapi` commands (`doctor`, `init`, `webhooks create`, `content submit`). They call `https://api.moderationapi.com`. `modapi login` opens your browser to sign in. `init` writes your project keys to `.env.local` or `.env` and adds that file to `.gitignore`.
  - Install the Moderation API SDK for your language with your package manager.
  - Read the docs at `https://docs.moderationapi.com`.
  - If Moderation API cannot do what you ask, draft a feature request and show it to you. Only with your yes does it send the request through the MCP server or give you a link to `https://moderationapi.productlane.com/request`.
- The skill never asks you to paste API keys into the chat, and never prints or commits them.

## Privacy

Moderation API processes the content you submit, as described in the [privacy policy](https://moderationapi.com/privacy-policy). The plugin itself collects no data.

## Links

- [Docs](https://docs.moderationapi.com)
- [CLI](https://github.com/moderation-api/cli)

## License

Apache-2.0
