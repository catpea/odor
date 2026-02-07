# Cat Pea Odor
---

Amazing Blog Generator

### USAGE

```sh

odor catpea-blog-profile.json;

```

## Example Profile

```JSON
{

  "debug":{},

  "profile": "catpea_www",
  "title": "Cat Pea",

  "src": "examples/catpea-blog-sample-data/database/main-posts",
  "dest": "examples/catpea-blog-sample-data/dist/{profile}",

  "theme": {
    "src": "examples/catpea-blog-sample-data/themes/striped-dark-solarize",
    "dest": "examples/catpea-blog-sample-data/dist/{profile}"

  },


  "pagerizer": {
    "pp": 24,
    "dest": "examples/catpea-blog-sample-data/dist/{profile}"
  },

  "feed":{
    "dest": "examples/catpea-blog-sample-data/dist/{profile}/feed.xml"
  },

  "cover": {
    "dest": "examples/catpea-blog-sample-data/dist/{profile}/permalink/{guid}/cover.avif",
    "url": "/permalink/{guid}/cover.avif",
    "width": 1024,
    "height": 1024,
    "quality": 80,
    "effort": 4,
    "exif": {
      "IFD0": {
        "Copyright": "Cat Pea",
        "ImageDescription": "Cat Pea Blog Post Cover"
      }
    }
  },

  "audio": {
    "dest": "examples/catpea-blog-sample-data/dist/audio/chapter-{chapter}/docs/{id}.mp3",
    "url": "https://catpea.github.io/chapter-{chapter}/{id}.mp3",
    "preset": "balanced",
    "id3": {
      "artist": "Cat Pea",
      "album_artist": "Cat Pea",
      "publisher": "catpea.com"
    }
  },

  "text": {}
}

```
