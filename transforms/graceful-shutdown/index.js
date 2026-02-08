import { isShutdownRequested } from '../../lib.js';

export default function gracefulShutdown() {
  return (send, packet) => {
    if (isShutdownRequested()) {
      console.log(`  [shutdown] ${packet.postId}: skipped (shutting down)`);
      return;
    }
    send(packet);
  };
}
