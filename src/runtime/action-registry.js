export class ActionRegistry {
  constructor() {
    this.actions = new Map();
  }

  register(module) {
    if (!module.manifest?.name) {
      throw new Error('Action module missing manifest.name');
    }
    if (typeof module.handle !== 'function') {
      throw new Error(`Action ${module.manifest.name} missing handle()`);
    }
    this.actions.set(module.manifest.name, module);
  }

  get(name) {
    const action = this.actions.get(name);
    if (!action) throw new Error(`Unknown action: ${name}`);
    return action;
  }

  has(name) {
    return this.actions.has(name);
  }
}
