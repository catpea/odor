import { processedPosts } from '../../lib.js';

export default function collectPost() {
  return (send, packet) => {
    if (packet._cached) {
      processedPosts.push(packet._cachedResults.collectedPost);
      send(packet);
      return;
    }

    const { branches, postData, postId, guid, valid, errors, textResult } = packet;

    const coverBranch = branches?.find(b => b.coverResult);
    const audioBranch = branches?.find(b => b.audioResult);
    const filesBranch = branches?.find(b => b.filesResult);

    const coverResult = coverBranch?.coverResult || { skipped: true };
    const audioResult = audioBranch?.audioResult || { skipped: true };
    const filesResult = filesBranch?.filesResult || { skipped: true };

    const collectedPost = {
      postId,
      guid,
      valid,
      errors,
      postData,
      coverUrl: coverBranch?.coverResult?.url,
      audioUrl: audioBranch?.audioResult?.url,
      permalinkUrl: `/permalink/${guid}/`,
      _coverResult: coverResult,
      _audioResult: audioResult,
      _textResult: textResult || { skipped: true },
      _filesResult: filesResult,
    };

    processedPosts.push(collectedPost);

    send(packet);
  };
}
