import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolvePath, interpolatePath } from '../../lib.js';

export default function postScanner({src, profile}, debug) {

  return async send => {
    const srcDir = resolvePath(interpolatePath(src, { profile }));
    console.log(`Scanning: ${srcDir}`);

    const entries = await readdir(srcDir, { withFileTypes: true });
    const postDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

    const validPostDirs = [];
    for (const postId of postDirs) {
      const postDir = path.join(srcDir, postId);
      const dirFiles = await readdir(postDir);
      if (!dirFiles.includes('post.json')) {
        console.log(`  Skipping ${postId}: no post.json`);
        continue;
      }
      validPostDirs.push({ postId, postDir, dirFiles });
    }



    let selectedPostDirs = validPostDirs;
    if (debug?.processOnly?.length) {
      const allowed = new Set(debug.processOnly);
      selectedPostDirs = validPostDirs.filter(p => allowed.has(p.postId));
    } else if (debug?.mostRecent) {
      selectedPostDirs = validPostDirs.slice(validPostDirs.length - debug.mostRecent);
    }

    const totalPosts = selectedPostDirs.length;
    console.log(`  Found ${totalPosts} posts`);

    for (const { postId, postDir, dirFiles } of selectedPostDirs) {

      const postData = JSON.parse(await readFile(path.join(postDir, 'post.json'), 'utf-8'));
      const cover = dirFiles.find(f => f.startsWith('cover.'));
      const audio = dirFiles.find(f => f.startsWith('audio.'));

      send({
        postId,
        postDir,
        postData,
        guid: postData.guid,
        chapter: postData.chapter,
        _totalPosts: totalPosts,
        files: {
          cover: cover ? path.join(postDir, cover) : null,
          audio: audio ? path.join(postDir, audio) : null,
          text: path.join(postDir, 'text.md'),
          filesDir: path.join(postDir, 'files')
        }
      });
    }
  };
}
