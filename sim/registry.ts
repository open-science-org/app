// Named, pluggable components. Each registry maps a `kind` used in YAML to an implementation with
// default parameters, so a new world generator, visibility rule, allocation rule, policy, measure
// or analysis is added by registering it, and is then usable from any scenario or experiment file.

export interface Plugin<P, T> {
  /** One line, shown by `npm run sim -- plugins`. */
  description: string;
  /** Every parameter the plugin accepts, with its default. Unknown keys in a config are rejected. */
  defaults: P;
  create: (params: P) => T;
}

export class Registry<P extends Record<string, unknown>, T> {
  readonly name: string;
  private plugins = new Map<string, Plugin<P, T>>();

  constructor(name: string) {
    this.name = name;
  }

  register<Q extends P>(kind: string, plugin: Plugin<Q, T>): void {
    if (this.plugins.has(kind)) throw new Error(`${this.name} "${kind}" is already registered`);
    this.plugins.set(kind, plugin as unknown as Plugin<P, T>);
  }

  kinds(): string[] {
    return [...this.plugins.keys()];
  }

  describe(): { kind: string; description: string; defaults: P }[] {
    return [...this.plugins].map(([kind, p]) => ({ kind, description: p.description, defaults: p.defaults }));
  }

  /** Builds the component for a config entry `{ kind, ...params }`, checking every parameter name. */
  create(config: { kind: string } & Record<string, unknown>, where: string): T {
    const plugin = this.plugins.get(config.kind);
    if (!plugin) throw new Error(`${where}: unknown ${this.name} "${config.kind}" (known: ${this.kinds().join(', ')})`);
    const { kind: _kind, ...given } = config;
    const unknown = Object.keys(given).filter((k) => !(k in plugin.defaults));
    if (unknown.length) {
      throw new Error(`${where}: ${this.name} "${config.kind}" has no parameter ${unknown.map((k) => `"${k}"`).join(', ')} (it takes: ${Object.keys(plugin.defaults).join(', ') || 'none'})`);
    }
    return plugin.create({ ...plugin.defaults, ...given } as P);
  }
}
