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

## Links

- [Docs](https://docs.moderationapi.com)
- [CLI](https://github.com/moderation-api/cli)

## License

Apache-2.0
