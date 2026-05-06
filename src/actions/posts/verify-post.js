export const manifest = {
  name: 'verify-post',
  title: 'Verify Post',
  category: 'posts',
  reads: ['post', 'post.cover', 'post.audio', 'post.filesResult', 'post.text'],
  writes: [],
  idempotent: true,
  retries: 0,
};

export function handle({ frame }) {
  const post        = frame.local.get('post');
  const coverResult = frame.local.get('post.cover')  ?? { missing: true };
  const audioResult = frame.local.get('post.audio')  ?? { missing: true };
  const filesResult = frame.local.get('post.filesResult') ?? { missing: true };
  const textResult  = frame.local.get('post.text')   ?? { missing: true };

  const results = { cover: coverResult, audio: audioResult, text: textResult, files: filesResult };

  const errors = Object.entries(results)
    .filter(([, r]) => r.error)
    .map(([key, r]) => `${key}: ${r.error}`);

  const valid = errors.length === 0;

  if (valid) {
    console.log(`  [verify] ${post.postId}: OK`);
  } else {
    console.log(`  [verify] ${post.postId}: FAILED - ${errors.join(', ')}`);
  }

  // Write validity back into the frame so collect-post can read it
  frame.local.set('post.valid',  valid);
  frame.local.set('post.errors', errors);
}
