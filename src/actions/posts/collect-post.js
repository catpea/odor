export const manifest = {
  name: 'collect-post',
  title: 'Collect Post Output',
  category: 'posts',
  reads: ['post', 'post.analysis', 'post.audio', 'post.cover', 'post.filesResult', 'post.tags', 'post.description', 'post.text'],
  writes: ['post.output'],
  idempotent: true,
  retries: 0,
};

export function handle({ frame }) {
  const post        = frame.local.get('post');
  const coverResult = frame.local.get('post.cover')  ?? { skipped: true };
  const audioResult = frame.local.get('post.audio')  ?? { skipped: true };
  const filesResult = frame.local.get('post.filesResult') ?? { skipped: true };
  const textResult  = frame.local.get('post.text')   ?? { skipped: true };
  const valid       = frame.local.get('post.valid')  ?? true;
  const errors      = frame.local.get('post.errors') ?? [];

  const coverUrl   = coverResult.url ?? null;
  const audioUrl   = audioResult.url ?? null;
  const permalinkUrl = `/permalink/${post.guid}/`;

  const collectedPost = {
    postId:       post.postId,
    guid:         post.guid,
    valid,
    errors,
    postData:     post.postData,
    coverUrl,
    audioUrl,
    permalinkUrl,
  };

  const manifestUpdate = {
    fingerprint: post._manifestUpdate?.fingerprint,
    results: {
      coverResult,
      audioResult,
      filesResult,
      textResult,
      valid,
      errors,
      collectedPost,
    },
  };

  return {
    ...post,
    valid,
    errors,
    coverUrl,
    audioUrl,
    permalinkUrl,
    _coverResult:    coverResult,
    _audioResult:    audioResult,
    _filesResult:    filesResult,
    _textResult:     textResult,
    _manifestUpdate: manifestUpdate,
  };
}
