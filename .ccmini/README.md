# .ccmini 目录

这是 ccmini 的项目配置目录。

## 目录结构

```
.ccmini/
├── settings.json    # 项目设置 (权限模式、模型等)
├── agents/          # 自定义 sub-agents
│   └── *.md         # agent 定义文件
└── skills/          # 自定义 skills
    └── */SKILL.md   # skill 定义文件
```

## settings.json

控制项目级别的设置：

- `permissionMode`: 权限模式 (default | plan | acceptEdits | bypassPermissions | dontAsk)
- `model`: 默认模型
- `tools`: 工具权限覆盖 (allow | ask | deny)

## 自定义 Agents

在 `agents/` 目录创建 `.md` 文件：

```markdown
---
name: my-agent
description: Agent 描述
allowed-tools: read_file,list_files,grep_search
model: lite
---

系统提示词内容...
```

## 自定义 Skills

在 `skills/<name>/` 目录创建 `SKILL.md`：

```markdown
---
name: my-skill
description: Skill 描述
mode: inline
---

Skill 提示词模板...
```
