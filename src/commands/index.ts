// T2 will register real commands (server list/start/stop, publish, etc.) here.

export interface Command {
  readonly name: string;
  readonly describe: string;
  run(args: string[]): Promise<number> | number;
}

export const commands: Readonly<Record<string, Command>> = {};
