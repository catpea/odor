export default function verifyPost() {
  return (send, packet) => {
    if (packet._cached) {
      send({ ...packet, valid: true, errors: [] });
      return;
    }

    const { branches, postId, textResult } = packet;

    const coverBranch = branches?.find(b => b.coverResult);
    const audioBranch = branches?.find(b => b.audioResult);
    const filesBranch = branches?.find(b => b.filesResult);

    const results = {
      cover: coverBranch?.coverResult || { missing: true },
      audio: audioBranch?.audioResult || { missing: true },
      text: textResult || { missing: true },
      files: filesBranch?.filesResult || { missing: true }
    };

    const errors = Object.entries(results)
      .filter(([, r]) => r.error)
      .map(([k, r]) => `${k}: ${r.error}`);

    const valid = errors.length === 0;

    if (!valid) {
      console.log(`  [verify] ${postId}: FAILED - ${errors.join(', ')}`);
    } else {
      console.log(`  [verify] ${postId}: OK`);
    }

    send({
      ...packet,
      results,
      valid,
      errors
    });
  };
}
