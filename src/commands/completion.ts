/**
 * `autousers completion <bash|zsh|fish>` — print a shell-completion script.
 *
 * Why static (no API calls)?
 * --------------------------
 * Tab-completion fires on every keystroke after `<TAB>`; round-tripping the
 * Autousers API would freeze the user's shell. We instead enumerate the
 * commander tree once at script-emit time and bake the names into the
 * script. The script is then tiny, fast, and works offline. Users re-run
 * `autousers completion <shell> > …` after upgrading the CLI to refresh.
 *
 * Pattern matches what `gh`, `kubectl`, `vercel`, and `stripe` ship.
 *
 * Wave 10 polish: see docs/CLI_ROADMAP.md:497-508.
 */

import { Command } from "commander";

import { ExitCode } from "../lib/exit.js";

type Shell = "bash" | "zsh" | "fish";

/** A flattened view of the commander tree the script generators consume. */
interface CommandTree {
  /** Top-level subcommands (e.g. `eval`, `autouser`). */
  topLevel: string[];
  /** Map from top-level name → its direct subcommand names. */
  subcommands: Record<string, string[]>;
  /** Global flags surfaced on the root program. */
  globalFlags: string[];
}

/**
 * Walk a commander `Command` and pull out the subcommand names we care
 * about for completion. We deliberately ignore commander's auto-injected
 * `help` subcommand AND per-subcommand flag enumeration — flag completion
 * is out of scope (kubectl-grade polish would balloon the script for
 * marginal benefit; users still get `--<TAB>` from their shell).
 */
function buildTree(program: Command): CommandTree {
  const topLevel: string[] = [];
  const subcommands: Record<string, string[]> = {};

  for (const cmd of program.commands) {
    const name = cmd.name();
    // Commander auto-adds an internal `help` command; skip it so users
    // see the same surface they'd see in `autousers --help`.
    if (name === "help") continue;
    topLevel.push(name);

    const childNames: string[] = [];
    for (const child of cmd.commands) {
      if (child.name() === "help") continue;
      childNames.push(child.name());
    }
    if (childNames.length > 0) subcommands[name] = childNames;
  }

  // Sorted output keeps the script diff-stable across CLI releases.
  topLevel.sort();
  for (const k of Object.keys(subcommands)) subcommands[k]?.sort();

  // Global flags are stable enough to hardcode — pulling them off the
  // commander tree would require parsing the option AST and we'd have to
  // special-case `--no-color` (negation) anyway.
  const globalFlags = [
    "--help",
    "-h",
    "--version",
    "-v",
    "--key",
    "--base-url",
    "--json",
    "--quiet",
    "--no-color",
  ];

  return { topLevel, subcommands, globalFlags };
}

/** Bash completion script. */
function renderBash(tree: CommandTree): string {
  const topLevel = tree.topLevel.join(" ");
  const globals = tree.globalFlags.join(" ");

  // Build the inner case statement that maps the chosen top-level
  // subcommand → its set of subcommands. Only commands that have
  // children get a case branch; the rest fall through to the empty
  // default and just complete flags.
  const caseBranches = Object.entries(tree.subcommands)
    .map(
      ([parent, subs]) =>
        `        ${parent})\n          subs="${subs.join(" ")}"\n          ;;`
    )
    .join("\n");

  return `# bash completion for autousers
# Install: autousers completion bash > /usr/local/etc/bash_completion.d/autousers
# Or:      autousers completion bash >> ~/.bashrc

_autousers() {
  local cur prev cmd subs
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${topLevel}" -- "\${cur}") )
    return 0
  fi

  if [ "\${COMP_CWORD}" -eq 2 ]; then
    subs=""
    case "\${cmd}" in
${caseBranches}
    esac
    if [ -n "\${subs}" ]; then
      COMPREPLY=( $(compgen -W "\${subs}" -- "\${cur}") )
      return 0
    fi
  fi

  # Fallback: complete global flags so \`autousers eval list --<TAB>\` works.
  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "${globals}" -- "\${cur}") )
    return 0
  fi

  return 0
}

complete -F _autousers autousers
`;
}

/** Zsh completion script. */
function renderZsh(tree: CommandTree): string {
  // _describe expects entries of the form `name:description`; we don't
  // have per-command descriptions handy here, so use the name twice —
  // zsh will render them in the menu without bombing.
  const topLevelEntries = tree.topLevel.map((n) => `'${n}:${n}'`).join(" ");

  const subcommandCases = Object.entries(tree.subcommands)
    .map(([parent, subs]) => {
      const entries = subs.map((s) => `'${s}:${s}'`).join(" ");
      return `        ${parent})\n          _describe '${parent} subcommands' \\\n            "(${entries})"\n          ;;`;
    })
    .join("\n");

  return `#compdef autousers
# zsh completion for autousers
# Install: autousers completion zsh > ~/.autousers/_autousers
#          echo 'fpath=(~/.autousers $fpath); compinit' >> ~/.zshrc

_autousers() {
  local -a subcommands
  subcommands=(${topLevelEntries})

  if (( CURRENT == 2 )); then
    _describe 'commands' subcommands
    return
  fi

  if (( CURRENT == 3 )); then
    case "$words[2]" in
${subcommandCases}
    esac
    return
  fi
}

_autousers "$@"
`;
}

/** Fish completion script. */
function renderFish(tree: CommandTree): string {
  const lines: string[] = [
    "# fish completion for autousers",
    "# Install: autousers completion fish > ~/.config/fish/completions/autousers.fish",
    "",
  ];

  // Top-level commands.
  for (const name of tree.topLevel) {
    lines.push(
      `complete -c autousers -f -n '__fish_use_subcommand' -a '${name}' -d '${name}'`
    );
  }

  // Subcommands (one block per top-level that has children).
  for (const [parent, subs] of Object.entries(tree.subcommands)) {
    const list = subs.join(" ");
    lines.push(
      `complete -c autousers -f -n '__fish_seen_subcommand_from ${parent}' -a '${list}'`
    );
  }

  // Global flags surface everywhere.
  for (const flag of tree.globalFlags) {
    if (flag.startsWith("--")) {
      const long = flag.slice(2);
      lines.push(`complete -c autousers -l ${long}`);
    } else if (flag.startsWith("-") && flag.length === 2) {
      lines.push(`complete -c autousers -s ${flag.slice(1)}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function completionAction(
  shell: string,
  _opts: Record<string, never>,
  cmd: Command
): void {
  const normalized = shell.toLowerCase();
  if (normalized !== "bash" && normalized !== "zsh" && normalized !== "fish") {
    process.stderr.write(
      `error: unknown shell "${shell}" — expected one of: bash, zsh, fish\n`
    );
    process.exit(ExitCode.VALIDATION);
    return;
  }

  // Walk the live commander tree we're attached to rather than rebuilding
  // it from scratch — keeps the script in sync with whatever the parent
  // dispatcher actually wired up, and avoids the import cycle that would
  // come from re-importing `../index.js` (its top-level `main()` runs on
  // import, which would fight the test runner).
  const root = cmd.parent ?? cmd;
  const tree = buildTree(root);

  let script: string;
  switch (normalized as Shell) {
    case "bash":
      script = renderBash(tree);
      break;
    case "zsh":
      script = renderZsh(tree);
      break;
    case "fish":
      script = renderFish(tree);
      break;
  }

  process.stdout.write(script);
}

export function completionCommand(parent: Command): Command {
  return parent
    .command("completion <shell>")
    .description(
      "Print a shell-completion script (bash | zsh | fish) — redirect into your shell rc"
    )
    .action(completionAction);
}
