import chalk from "chalk";
import stripAnsi from "strip-ansi";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SyntaxHighlighter — Lightweight terminal syntax highlighting
//
// Regex-based tokenizer supporting TS/JS, Python, JSON, Shell,
// HTML/CSS, YAML, Go, Rust, Java, Ruby, SQL, and a universal fallback.
// Zero external dependencies, pure chalk output.
//
// Uses single-pass token scanning to avoid ANSI code re-matching issues.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Color tokens mapped to One Dark Pro palette ───────────────────
const T = {
  keyword:  chalk.hex("#c678dd"),
  keyword2: chalk.hex("#e5c07b"),
  string:    chalk.hex("#98c379"),
  number:    chalk.hex("#d19a66"),
  comment:   chalk.hex("#5c6370"),
  func:      chalk.hex("#61afef"),
  builtin:   chalk.hex("#56b6c2"),
  operator:  chalk.hex("#56b6c2"),
  property:  chalk.hex("#e06c75"),
  tag:       chalk.hex("#e06c75"),
  attr:      chalk.hex("#d19a66"),
  punct:     chalk.hex("#abb2bf"),
};

const PLAIN = chalk.hex("#abb2bf");

// ── Language aliases ─────────────────────────────────────────────

const LANG_ALIASES: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", node: "javascript",
  py: "python", py3: "python",
  sh: "shell", bash: "shell", zsh: "shell",
  json: "json", jsonc: "json",
  html: "html", xml: "html", svg: "html",
  css: "css", scss: "css", less: "css",
  yaml: "yaml", yml: "yaml",
  sql: "sql", mysql: "sql", postgresql: "sql",
  go: "go",
  rust: "rust", rs: "rust",
  java: "java",
  rb: "ruby",
};

/**
 * Highlight an array of source code lines for the given language.
 */
export function highlightCode(lines: string[], lang: string): string[] {
  const resolvedLang = LANG_ALIASES[lang.toLowerCase()] || lang.toLowerCase();
  return lines.map((line) => highlightLine(line, resolvedLang));
}

function highlightLine(line: string, lang: string): string {
  switch (lang) {
    case "typescript":
    case "javascript": return highlightTSJS(line);
    case "python": return highlightPython(line);
    case "shell": return highlightShell(line);
    case "sql": return highlightSQL(line);
    case "go": return highlightGo(line);
    case "rust": return highlightRust(line);
    case "java": return highlightJava(line);
    case "ruby": return highlightRuby(line);
    case "json": return highlightJSON(line);
    case "html": return highlightHTML(line);
    case "css": return highlightCSS(line);
    case "yaml": return highlightYAML(line);
    default: return highlightGeneric(line);
  }
}

// ━━━━ Token Scanner — Single-pass, position-based coloring ━━━━━━━━
// Scans raw text once, builds result with styled tokens.
// Each rule: { pattern → style }. Rules applied in order; first match wins.

interface TokenRule {
  re: RegExp;
  style: (match: string, ...groups: string[]) => string;
}

function tokenize(rawLine: string, rules: TokenRule[]): string {
  if (!rawLine) return "";
  let pos = 0;
  let out = "";

  while (pos < rawLine.length) {
    let matched = false;

    for (const rule of rules) {
      // Reset regex lastIndex since we reuse them
      rule.re.lastIndex = 0;
      const m = rule.re.exec(rawLine.substring(pos));
      if (m && m.index === 0) {
        out += rule.style(m[0]);
        pos += m[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      out += PLAIN(rawLine[pos]);
      pos++;
    }
  }

  return out;
}

// ══════════════════════════════════════════════════════════════════
// Per-language highlighters
// ══════════════════════════════════════════════════════════════════

function highlightTSJS(line: string): string {
  return tokenize(line, [
    // Comments first
    { re: /^#.*$/, style: T.comment },
    { re: /\/\/.*$/, style: T.comment },
    // Strings
    { re: /`(?:[^`\\]|\\.)*`/, style: T.string },
    { re: /"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /'(?:[^'\\]|\\.)*'/, style: T.string },
    // Numbers
    { re: /\b0[xX][0-9a-fA-F]+\b/, style: T.number },
    { re: /\b\d+\.?\d*([eE][+-]?\d+)?\b/, style: T.number },
    // Declaration keywords (gold)
    { re: /\b(function|class|interface|type|enum)\b/, style: T.keyword2 },
    // Keywords (purple)
    { re: /\b(const|let|var|return|if|else|for|while|do|switch|case|break|continue|default|try|catch|finally|throw|new|this|super|extends|implements|import|export|from|as|async|await|typeof|instanceof|in|of|null|undefined|true|false|void|public|private|protected|static|readonly|abstract)\b/, style: T.keyword },
    // Built-ins (teal)
    { re: /\b(console|Math|Date|Array|Object|String|Number|Boolean|Promise|Map|Set|WeakMap|WeakSet|JSON|RegExp|Error|Symbol|Proxy|Reflect|Intl|Buffer|process|require|module|exports|document|window|fetch|setTimeout|setInterval|clearTimeout|clearInterval)\b/, style: T.builtin },
    // Function call before paren (blue)
    { re: /\b([A-Za-z_$]\w*)(?=\s*\()/, style: T.func },
    // Dot property (red) — must be after func check
    { re: /\.(\w+)/, style: function(m, p) { return "." + T.property(p); } },
    // Operators / punctuation (teal-ish)
    { re: /[{}[\]();,.]/, style: PLAIN },
    { re: /[=+\-*/%&|^!<>?:]/, style: T.operator },
  ]);
}

function highlightPython(line: string): string {
  return tokenize(line, [
    { re: /^#.*$/ , style: T.comment },   // shebang / comment
    { re: /#.*$/   , style: T.comment },   // inline comment
    { re: /(@[\w.]+)/, style: T.builtin }, // decorator
    // Triple-quoted strings
    { re: /"""(?:[^"\\]|\\.)*"""/, style: T.string },
    { re: /'''(?:[^'\\]|\\.)*'''/, style: T.string },
    // f/r prefixed strings
    { re: /[rf]?"""(?:[^"\\]|\\.)*"""/, style: T.string },
    { re: /[rf]?'''(?:[^'\\]|\\.)*'''/, style: T.string },
    { re: /[fr]?"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /[fr]?'(?:[^'\\]|\\.)*'/, style: T.string },
    // Regular strings
    { re: /"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /'(?:[^'\\]|\\.)*'/, style: T.string },
    // Numbers
    { re: /\b\d+\.?\d*([eE][+-]?\d+)?\b/, style: T.number },
    { re: /\b0[bB][01]+\b|\b0[oO][0-7]+\b/, style: T.number },
    // def/class (gold)
    { re: /\b(def|class)\b/, style: T.keyword2 },
    // Keywords (purple)
    { re: /\b(if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|pass|break|continue|and|or|not|in|is|lambda|async|await|nonlocal|global|assert|del)\b/, style: T.keyword },
    // True/False/None (purple keyword)
    { re: /\b(True|False|None)\b/, style: T.keyword },
    // Builtins (teal)
    { re: /\b(print|len|range|int|str|float|list|dict|tuple|set|bool|open|input|map|filter|zip|enumerate|sorted|reversed|any|all|min|max|sum|abs|round|isinstance|hasattr|getattr|setattr|super|property|staticmethod|classmethod|__init__|__name__|__repr__|Exception|ValueError|TypeError|KeyError|IndexError|NotImplementedError|RuntimeWarning|bytes|bytearray|frozenset|object|type|is|id|dir|hasattr|vars|globals|locals|callable|iter|next|hex|oct|bin|repr|ascii|chr|ord|hash|help|exec|eval|compile|memoryview|complex|divmod|pow|round|format|slice|sorted|reversed|enumerate|zip|map|filter|any|all|min|max|sum|open|input|property|classmethod|staticmethod)\b/, style: T.builtin },
    // self/cls (red property)
    { re: /\b(self|cls)\b/, style: T.property },
    // Function call (blue)
    { re: /\b([A-Za-z_]\w*)(?=\s*\()/, style: T.func },
    // Dot property (red)
    { re: /\.(\w+)/, style: function(m, p) { return "." + T.property(p); } },
  ]);
}

function highlightShell(line: string): string {
  return tokenize(line, [
    { re: /#.*$/ , style: T.comment },
    { re: /'[^']*'/, style: T.string },
    { re: /"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /\$\{[^}]*\}/, style: T.func },
    { re: /\$\w+/, style: T.property },
    { re: /\b(if|then|elif|else|fi|for|in|while|do|done|case|esac|function|return|exit|set|unset|export|local|readonly|declare|echo|printf|cd|pwd|ls|cat|grep|sed|awk|find|sort|uniq|cut|head|tail|wc|xargs|shift|read|source|exec|trap|test)\b/, style: T.keyword },
    { re: /\b\d+\b/, style: T.number },
  ]);
}

function highlightSQL(line: string): string {
  return tokenize(line, [
    { re: /--.*$/g, style: T.comment },
    { re: /\/\*[\s\S]*?\*\//, style: T.comment },
    { re: /'(?:[^'\\]|\\.)*'/, style: T.string },
    { re: /\b\d+\.?\d*\b/g, style: T.number },
    // Keywords (gold)
    { re: /\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|DROP|ALTER|ADD|COLUMN|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|ALL|EXISTS|BETWEEN|LIKE|CASE|WHEN|THEN|ELSE|END|DISTINCT|COUNT|SUM|AVG|MIN|MAX|ASC|DESC|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|DEFAULT|UNIQUE|CHECK|GRANT|REVOKE|COMMIT|ROLLBACK|BEGIN|TRANSACTION)\b/i, style: T.keyword2 },
    { re: /`[\w.]+`/, style: T.func },
  ]);
}

function highlightGo(line: string): string {
  return tokenize(line, [
    { re: /\/\/.*$/ , style: T.comment },
    { re: /^#.*$/  , style: T.comment },
    { re: /`(?:[^`]*)`/, style: T.string },
    { re: /"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /'\S'/, style: T.string }, // rune literal
    { re: /\b\d+\.?\d*([eE][+-]?\d+)?i?\b/, style: T.number },
    { re: /\bfunc\b/, style: T.keyword2 },
    { re: /\b(package|import|type|struct|interface|map|chan|go|defer|range|select|return|if|else|for|switch|case|default|break|continue|fallthrough|const|var|iota|make|new|append|copy|delete|len|cap|nil|true|false|string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64|complex64|complex128|byte|rune|error|bool|uintptr)\b/, style: T.keyword },
    { re: /\b(make|new|append|copy|delete|len|cap|close|panic|recover|print|println|fmt|error|io|os|strings|strconv|time|http|json|sync|context|reflect|unsafe|math|runtime|testing|log|bufio|bytes|sort|path|filepath|net|url|encoding|database|compress|archive|image|crypto|regexp)\b/, style: T.builtin },
    { re: /\b([A-Z]\w*|[a-z]\w+)\b(?=\s*\()/, style: T.func },
  ]);
}

function highlightRust(line: string): string {
  return tokenize(line, [
    { re: /\/\/.*$/ , style: T.comment },
    { re: /^#.*$/  , style: T.comment },
    { re: /\/\*[\s\S]*?\*\//, style: T.comment },
    { re: /r?"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /r?'(?:[^'\\]|\\.)*'/, style: T.string },
    { re: /\b\d+\.?\d*_?(u8|u16|u32|u64|i8|i16|i32|i64|f32|f64|usize|isize)?\b/, style: T.number },
    { re: /\bfn\b/, style: T.keyword2 },
    { re: /\b(fn|let|mut|const|static|pub|use|mod|crate|self|Self|struct|enum|trait|impl|where|for|in|while|loop|match|if|else|return|break|continue|move|ref|unsafe|async|await|dyn|type|as|true|false|Some|None|Ok|Err|String|Vec|Box|Rc|Arc|Option|Result|Vec|HashMap|BTreeMap|HashSet|BTreeSet|Cow|Cell|RefCell|Mutex|RwLock|Arc|Weak|Pin|PhantomData|Send|Sync|Sized|Copy|Clone|Debug|Default|PartialEq|Eq|PartialOrd|Ord|Hash|From|Into|TryFrom|TryInto|Drop|Iterator|IntoIterator|Future|Display|ToString|FromStr|AsRef|AsMut|Deref|DerefMut|Add|Sub|Mul|Div|Rem|Neg|Not|BitAnd|BitOr|BitXor|Shl|Shr|Index|IndexMut|Fn|FnOnce|FnMut|AddAssign|SubAssign|MulAssign|DivAssign|RemAssign|ShlAssign|ShrAssign|BitAndAssign|BitOrAssign|BitXorAssign)\b/, style: T.keyword },
    // PascalCase types → teal
    { re: /\b[A-Z][A-Za-z0-9_]*\b(?![<(])/, style: T.builtin },
    { re: /\b[a-z_]+!/, style: T.func },
    { re: /\b([a-z_]\w*)\s*(?=\()/, style: T.func },
    { re: /'[a-z_]\w*/, style: T.operator },
  ]);
}

function highlightJava(line: string): string {
  return tokenize(line, [
    { re: /\/\/.*$/ , style: T.comment },
    { re: /^#.*$/  , style: T.comment },
    { re: /"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /'(?:[^'\\]|\\.)*'/, style: T.string },
    { re: /\b\d+[lLfFdD]?\b/, style: T.number },
    { re: /\b0[xX][0-9a-fA-F]+\b/, style: T.number },
    { re: /@\w+/, style: T.builtin },
    { re: /\b(class|interface|enum|record)\b/, style: T.keyword2 },
    { re: /\b(public|private|protected|static|final|abstract|void|int|long|double|float|boolean|char|byte|short|String|Object|System|out|new|return|if|else|for|while|switch|case|break|continue|throw|throws|try|catch|finally|null|true|false|this|super|import|package|synchronized|volatile|transient|native|instanceof|extends|implements)\b/, style: T.keyword },
    { re: /\b[A-Z]\w*\b/, style: T.builtin },
    { re: /\b([a-z]\w*)\s*(?=\()/, style: T.func },
  ]);
}

function highlightRuby(line: string): string {
  return tokenize(line, [
    { re: /#.*$/ , style: T.comment },
    { re: /%(?:Q|q)?\{[^}]*\}/, style: T.string },
    { re: /"(?:[^"#\\]|#(?:\{|@|\$)|\\.)*"/, style: T.string },
    { re: /'(?:[^'\\]|\\.)*'/, style: T.string },
    { re: /:\w+(?!::)/, style: T.property },
    { re: /:'(?:[^']*)'/, style: T.property },
    { re: /\b\d+\.?\d*\b/, style: T.number },
    { re: /\b(def|class|module)\b/, style: T.keyword2 },
    { re: /\b(def|class|module|end|if|unless|elsif|else|case|when|while|until|for|do|begin|rescue|ensure|raise|return|yield|nil|true|false|self|require|include|extend|attr_reader|attr_writer|attr_accessor|puts|print|p|lambda|proc|block_given?)\b/, style: T.keyword },
    { re: /@@?\w+/, style: T.property },
    { re: /\b[A-Z]\w*\b/, style: T.builtin },
    { re: /\b([a-z_]\w*[!?]?)(?=[\s({])/ , style: T.func },
  ]);
}

function highlightJSON(line: string): string {
  return tokenize(line, [
    // Key-value pair: "key": → red key + teal colon
    { re: /"((?:[^"\\]|\\.)*)"\s*:/, style: function(m, k) { return '"' + T.property(k) + '"' + T.operator(":") + " "; } },
    // String value (not followed by colon): green
    { re: /"((?:[^"\\]|\\.)*)"(?!:\s)/, style: T.string },
    { re: /\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/, style: T.number },
    { re: /\b(true|false|null)\b/, style: T.keyword },
  ]);
}

function highlightHTML(line: string): string {
  return tokenize(line, [
    { re: /<!--[\s\S]*?-->/, style: T.comment },
    { re: /(&lt;\/?)([\w-]+)/gi, style: function(m, s, t) { return T.punct(s) + T.tag(t); } },
    { re: /&gt;/, style: function(m) { return T.punct(">"); } },
    { re: /\s([\w-]+)=/, style: function(m, a) { return " " + T.attr(a) + T.operator("="); } },
    { re: /=\s*"([^"]*)"/, style: function(m, v) { return T.operator("=") + T.string(`"${v}"`); } },
  ]);
}

function highlightCSS(line: string): string {
  let result = line;

  // Block comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, T.comment("$&"));

  // Selector before opening brace
  result = result.replace(
    /^([\w.#\[\]=~^$*|:\-\s,.>+[]+)(\{)/,
    (_, sel, brace) => `${T.func(sel)}${T.punct(brace)}`
  );

  // Property name + colon
  result = result.replace(/^(\s*)([\w-]+)(\s*:)/g,
    (_, ws, prop, col) => `${ws}${T.property(prop)}${T.operator(col)}`
  );

  // Values after colon, before semicolon/end
  result = result.replace(/(:\s*)([^;{}]+?)(\s*;?\s*$)/g,
    (_col, colon, value, semi) => {
      value = value
        .replace(/\b(\d+(\.\d+)?(%|px|em|rem|vh|vw|ch|fr|deg|rad|s|ms)?)\b/g, T.number("$1"))
        .replace(/(#(?:[0-9a-fA-F]{3}){1,2})\b/gi, T.string("$1"))
        .replace(/\b(auto|inherit|initial|unset|none|block|inline|flex|grid|absolute|relative|fixed|sticky|visible|hidden|scroll|transparent|bold|italic|normal|uppercase|lowercase|capitalize|center|left|right|justify|space-between|space-around|wrap|nowrap|repeat|minmax|fit-content|clamp|calc)\b/g, T.keyword("$1"));
      return `${T.operator(colon)} ${value}${semi}`;
    }
  );

  // Closing brace
  result = result.replace(/(\})/g, T.punct("$1"));

  return result;
}

function highlightYAML(line: string): string {
  return tokenize(line, [
    { re: /(#.*)$/ , style: T.comment },
    // Keys at start of line
    { re: /^(\s*)([\w][\w\s]*?)(\s*:\s*)/, style: function(m, indent, key, colon) { return indent + T.property(key) + T.operator(colon.trim()) + " "; } },
    { re: /"([^"]*?)"/, style: T.string },
    { re: /'([^']*?)'/, style: T.string },
    { re: /\b(true|false|yes|no|on|off|null|~)\b/gi, style: T.keyword },
    { re: /\b-?\d+\.?\d*\b/, style: T.number },
    { re: /&[\w]+/, style: T.builtin },
    { re: /\*[\w]+/, style: T.builtin },
  ]);
}

function highlightGeneric(line: string): string {
  return tokenize(line, [
    { re: /(\/\/|#|--).*$/ , style: T.comment },
    { re: /"(?:[^"\\]|\\.)*"/, style: T.string },
    { re: /'(?:[^'\\]|\\.)*'/, style: T.string },
    { re: /`(?:[^`\\]|\\.)*`/, style: T.string },
    { re: /\b\d+\.?\d*\b/, style: T.number },
    { re: /\b(function|class|def|fn|const|let|var|return|if|else|for|while|import|export|from|true|false|null|undefined|none|nil|new|async|await|type|interface|enum)\b/, style: T.keyword },
    { re: /\b(\w+)\s*(?=\()/, style: T.func },
  ]);
}
