export const mp3Presets = {
  highQuality: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '5', '-ar', '48000',
    '-af', 'aresample=resampler=soxr:precision=33:dither_method=triangular',
    '-f', 'mp3', '-y', out
  ],
  quality: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '6', '-b:a', '192k', '-ar', '44100',
    '-af', 'aresample=resampler=soxr:precision=28:dither_method=triangular',
    '-f', 'mp3', '-y', out
  ],
  balanced: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '7', '-ar', '44100',
    '-af', 'aresample=resampler=soxr:precision=24',
    '-f', 'mp3', '-y', out
  ],
  speed: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '7', '-b:a', '128k', '-ar', '44100',
    '-af', 'aresample=resampler=soxr:precision=20',
    '-f', 'mp3', '-y', out
  ],
  fast: (src, out) => [
    '-hide_banner', '-loglevel', 'error', '-threads', '0', '-i', src,
    '-c:a', 'libmp3lame', '-q:a', '8', '-b:a', '96k', '-ar', '22050',
    '-af', 'aresample=resampler=soxr',
    '-f', 'mp3', '-y', out
  ]
};
