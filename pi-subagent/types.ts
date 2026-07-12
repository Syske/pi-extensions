export interface SubagentOptions {
  name: string;
  systemPrompt: string;
  timeoutMs?: number;
}

export interface SubagentResult {
  name: string;
  exitCode: number;
  artifacts: string[];
  error?: string;
  cancelled: boolean;
}

export type TokenHandler = (value: string) => void;

export class TokenPattern {
  constructor(
    readonly pattern: RegExp,
    readonly handler: TokenHandler,
  ) {}
}
