import type Anthropic from "@anthropic-ai/sdk";

export type ToolDef = Anthropic.Tool;

export type ToolCategory = "read" | "write" | "exec" | "agent" | "meta";

export interface ToolMetadata {
  category: ToolCategory;
  parallelSafe: boolean;
  idempotent: boolean;
}

export interface ToolDefWithMeta extends ToolDef {
  metadata: ToolMetadata;
}

export const toolDefinitions: ToolDefWithMeta[] = [
  {
    name: "read_file",
    description: "Read file contents with line numbers. Use offset/limit for pagination, omit limit for first 80 lines, use 0 for all remaining.",
    metadata: { category: "read", parallelSafe: true, idempotent: true },
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: {
          type: "string",
          description: "The path to the file to read",
        },
        offset: {
          type: "number",
          description: "Starting line number (1-based). Defaults to 1.",
        },
        limit: {
          type: "number",
          description: "Max lines to return. Omit for 80-line preview, 0 for all remaining.",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    metadata: { category: "write", parallelSafe: false, idempotent: false },
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
    description: "Edit a file by replacing an exact string match with new content.",
    metadata: { category: "write", parallelSafe: false, idempotent: false },
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
    description: "List files matching a glob pattern.",
    metadata: { category: "read", parallelSafe: true, idempotent: true },
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
    description: "Search for a pattern in files using regex. Use simple regex patterns - avoid complex quantifiers like {1,2} or unbalanced brackets.",
    metadata: { category: "read", parallelSafe: true, idempotent: true },
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: {
          type: "string",
          description: "Simple regex pattern (avoid {n,m} quantifiers, escape special chars like .*+?^${}()|[]\\)",
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
    description: "Execute a shell command.",
    metadata: { category: "exec", parallelSafe: false, idempotent: false },
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
    description: "Invoke a registered skill by name.",
    metadata: { category: "agent", parallelSafe: false, idempotent: false },
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
    description: "Launch a sub-agent to handle a task autonomously.",
    metadata: { category: "agent", parallelSafe: false, idempotent: false },
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
  {
    name: "task_create",
    description: "Create a task to track progress.",
    metadata: { category: "meta", parallelSafe: true, idempotent: false },
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
    description: "Update a task's status or details.",
    metadata: { category: "meta", parallelSafe: false, idempotent: false },
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
    description: "List all current tasks and their statuses.",
    metadata: { category: "read", parallelSafe: true, idempotent: true },
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "web_search",
    description: "Search the web using DuckDuckGo.",
    metadata: { category: "read", parallelSafe: true, idempotent: true },
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query string.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 10, max: 20).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "ask_user",
    description: "Ask the user a question and wait for their response.",
    metadata: { category: "agent", parallelSafe: false, idempotent: false },
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user. Be clear and specific.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of predefined options for the user to choose from. If provided, the user selects from these options. If omitted, the user provides free-form text input.",
        },
        allow_free_text: {
          type: "boolean",
          description:
            "When options are provided, whether to also allow free-form text input in addition to the predefined options. Defaults to false.",
        },
      },
      required: ["question"],
    },
  },
];

export function getToolMetadata(name: string): ToolMetadata | undefined {
  return toolDefinitions.find(t => t.name === name)?.metadata;
}

export function getToolCategory(name: string): ToolCategory | undefined {
  return getToolMetadata(name)?.category;
}

export function isParallelSafe(name: string): boolean {
  return getToolMetadata(name)?.parallelSafe ?? false;
}

export function isIdempotent(name: string): boolean {
  return getToolMetadata(name)?.idempotent ?? false;
}

export const READ_TOOLS = new Set(toolDefinitions.filter(t => t.metadata.category === "read").map(t => t.name));
export const WRITE_TOOLS = new Set(toolDefinitions.filter(t => t.metadata.category === "write").map(t => t.name));
export const EXEC_TOOLS = new Set(toolDefinitions.filter(t => t.metadata.category === "exec").map(t => t.name));
export const AGENT_TOOLS = new Set(toolDefinitions.filter(t => t.metadata.category === "agent").map(t => t.name));
