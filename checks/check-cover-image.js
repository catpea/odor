import fs from 'node:fs';
import sharp from 'sharp';
import { spawn } from 'node:child_process';

function ffprobeMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json=compact=1',
      filePath,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(stderr.trim() || `ffprobe exited ${code}`));
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        if (!stream) return reject(new Error('no video stream found'));
        resolve({ width: stream.width, height: stream.height });
      } catch (e) {
        reject(e);
      }
    });
  });
}

export default function checkCoverImage({ expectRatio = '1:1', minResolution = '1024x1024' } = {}) {
  const [ratioW, ratioH] = expectRatio.split(':').map(Number);
  const [minW, minH] = minResolution.split('x').map(Number);
  const expectedRatio = ratioW / ratioH;

  return async (send, packet) => {
    const { files, postId } = packet;
    packet._complaints = packet._complaints || [];

    if (!files.cover || !fs.existsSync(files.cover)) {
      packet._complaints.push(`[cover] missing cover image`);
      send(packet);
      return;
    }

    try {
      let width, height;
      try {
        ({ width, height } = await sharp(files.cover).metadata());
      } catch {
        ({ width, height } = await ffprobeMetadata(files.cover));
      }

      const actualRatio = width / height;

      if (Math.abs(actualRatio - expectedRatio) > 0.01) {
        packet._complaints.push(`[cover] ${width}x${height} is not ${expectRatio} (ratio: ${actualRatio.toFixed(2)})`);
      }

      if (width < minW || height < minH) {
        packet._complaints.push(`[cover] ${width}x${height} below minimum ${minResolution}`);
      }
    } catch (err) {
      packet._complaints.push(`[cover] unreadable: ${err.message}`);
    }

    send(packet);
  };
}
