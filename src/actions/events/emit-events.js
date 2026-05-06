export const manifest = {
  name: 'emit-events',
  title: 'Emit Event',
  category: 'events',
  reads: [],
  writes: [],
  idempotent: true,
  retries: 0,
};

export function handle({ ctx, store, input }) {
  const eventName = input.name;
  if (eventName && ctx.events) {
    ctx.events.emit(eventName, { store: store.snapshot() });
  }
  return { emitted: eventName };
}
