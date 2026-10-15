// The AI adapter (OIP-15; OSO/docs/ui/ai.md). All model calls go through here, never from the browser.
// Providers speak the OpenAI-style chat-completions interface (OpenRouter, Ollama, llama.cpp, vLLM,
// LM Studio and most hosted APIs). The `stub` provider needs no model, so everything runs offline.
//
// Environment overrides: OSO_AI_CHAT_PROVIDER, OSO_AI_CHAT_MODEL; API keys from each provider's api_key_env.
import { readFileSync } from 'node:fs';

export interface Message { role: 'system' | 'user' | 'assistant'; content: string }
interface Provider { base_url: string; api_key_env?: string }
interface Task { provider: string; model: string; max_tokens?: number; daily_call_limit?: number }
export interface AIConfig { providers: Record<string, Provider>; tasks: Record<string, Task> }

export class BudgetExceeded extends Error {}

export function loadAIConfig(path = new URL('../ai.config.json', import.meta.url).pathname): AIConfig {
  const config = JSON.parse(readFileSync(path, 'utf8')) as AIConfig;
  const chat = config.tasks.chat;
  if (process.env.OSO_AI_CHAT_PROVIDER) chat.provider = process.env.OSO_AI_CHAT_PROVIDER;
  if (process.env.OSO_AI_CHAT_MODEL) chat.model = process.env.OSO_AI_CHAT_MODEL;
  return config;
}

export class AI {
  readonly config: AIConfig;
  private stub: (task: string, messages: Message[]) => string;
  private calls = new Map<string, number>();
  private day = '';

  constructor(config: AIConfig, stub: (task: string, messages: Message[]) => string) {
    this.config = config;
    this.stub = stub;
  }

  task(name: string): Task {
    const t = this.config.tasks[name];
    if (!t) throw new Error(`no AI task "${name}" in the configuration`);
    if (!this.config.providers[t.provider]) throw new Error(`unknown AI provider "${t.provider}"`);
    return t;
  }

  callsToday(name: string): number {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.calls.clear(); }
    return this.calls.get(name) ?? 0;
  }

  /** Runs one completion for a task, within the task's daily call limit. */
  async complete(name: string, messages: Message[]): Promise<{ text: string; provider: string; model: string }> {
    const t = this.task(name);
    const used = this.callsToday(name);
    if (t.daily_call_limit !== undefined && used >= t.daily_call_limit) {
      throw new BudgetExceeded(`the daily limit of ${t.daily_call_limit} ${name} calls is used up; try again tomorrow`);
    }
    this.calls.set(name, used + 1);
    if (t.provider === 'stub') return { text: this.stub(name, messages), provider: 'stub', model: 'stub' };

    const p = this.config.providers[t.provider];
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (p.api_key_env) {
      const key = process.env[p.api_key_env];
      if (!key) throw new Error(`set ${p.api_key_env} to use the ${t.provider} provider`);
      headers.authorization = `Bearer ${key}`;
    }
    const res = await fetch(`${p.base_url}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: t.model, messages, max_tokens: t.max_tokens ?? 600, temperature: 0.2 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${t.provider} returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: data.choices?.[0]?.message?.content ?? '', provider: t.provider, model: t.model };
  }
}
