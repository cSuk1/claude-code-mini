import type Anthropic from "@anthropic-ai/sdk";

// Tool definition type for Claude API
export type ToolDef = Anthropic.Tool;

export const toolDefinitions: ToolDef[] = [
  {
    name: "read_file",
    description:
      "Read file contents with line numbers. If the user asks to analyze, explain, summarize, or review a specific file, prefer a single call with limit=0 so the model sees the whole remaining file at once. Use offset and a positive limit for targeted regions, spot checks, or multi-file exploration. When limit is omitted, defaults to the first 80 lines.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to read",
        },
        offset: {
          type: "number",
          description: "Starting line number (1-based). Defaults to 1. Keep offset at 1 when reading a full file unless continuing from a later section.",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to return. Omit for the default 80-line preview, use a positive number for pagination, or set to 0 to return all remaining content. Prefer 0 when analyzing a specific file end-to-end.",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace and indentation).",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "The exact string to find and replace",
        },
        new_string: {
          type: "string",
          description: "The string to replace it with",
        },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "list_files",
    description:
      "List files matching a glob pattern. Returns matching file paths.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description:
            'Glob pattern to match files (e.g., "**/*.ts", "src/**/*")',
        },
        path: {
          type: "string",
          description:
            "Base directory to search from. Defaults to current directory.",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep_search",
    description:
      "Search for a pattern in files. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "The regex pattern to search for",
        },
        path: {
          type: "string",
          description: "Directory or file to search in. Defaults to current directory.",
        },
        include: {
          type: "string",
          description:
            'File glob pattern to include (e.g., "*.ts", "*.py")',
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "run_shell",
    description:
      "Execute a shell command and return its output. Use this for running tests, installing packages, git operations, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "skill",
    description:
      "Invoke a registered skill by name. Skills are prompt templates loaded from .ccmini/skills/. Returns the skill's resolved prompt to follow.",
    input_schema: {
      type: "object" as const,
      properties: {
        skill_name: {
          type: "string",
          description: "The name of the skill to invoke",
        },
        args: {
          type: "string",
          description: "Optional arguments to pass to the skill",
        },
      },
      required: ["skill_name"],
    },
  },
  {
    name: "agent",
    description:
      "Launch a sub-agent to handle a task autonomously. Sub-agents have isolated context and return their result. Built-in types: 'explore' (read-only, fast search), 'plan' (read-only, structured planning), 'general' (full tools). Custom agent types defined in .ccmini/agents/*.md are also available — see system prompt for details. You can optionally specify a model tier (pro/lite/mini) or an explicit model name.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: {
          type: "string",
          description: "Short (3-5 word) description of the sub-agent's task",
        },
        prompt: {
          type: "string",
          description: "Detailed task instructions for the sub-agent",
        },
        type: {
          type: "string",
          description: "Agent type. Built-in: explore (read-only), plan (planning), general (full tools). Also accepts custom agent names. Default: general",
        },
        model: {
          type: "string",
          description: "Optional model tier (pro/lite/mini) or explicit model name for this sub-agent. If omitted, model is chosen automatically based on agent type or custom agent config.",
        },
      },
      required: ["description", "prompt"],
    },
  },
  // ─── Task management tools ──────────────────────────────────
  {
    name: "task_create",
    description:
      "Create a task to track progress on a multi-step operation. Use this proactively when starting complex tasks with 3+ steps. The task list is displayed to the user in real-time.",
    input_schema: {
      type: "object" as const,
      properties: {
        subject: {
          type: "string",
          description: "Brief, actionable title in imperative form (e.g. 'Fix authentication bug')",
        },
        description: {
          type: "string",
          description: "What needs to be done",
        },
        activeForm: {
          type: "string",
          description: "Present continuous form shown while in_progress (e.g. 'Fixing authentication bug'). If omitted, subject is used.",
        },
      },
      required: ["subject", "description"],
    },
  },
  {
    name: "task_update",
    description:
      "Update a task's status or details. Set status to 'in_progress' when starting work, 'completed' when done. Set to 'deleted' to remove a task.",
    input_schema: {
      type: "object" as const,
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to update",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "deleted"],
          description: "New status for the task",
        },
        subject: {
          type: "string",
          description: "New subject for the task",
        },
        description: {
          type: "string",
          description: "New description for the task",
        },
        activeForm: {
          type: "string",
          description: "Present continuous form shown while in_progress",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "task_list",
    description:
      "List all current tasks and their statuses.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];
