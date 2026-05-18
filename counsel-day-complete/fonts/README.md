# Counsel.day · self-hosted fonts (staged)

This directory is the staging area for **self-hosted** versions of Newsreader and
Manrope. At launch the site loads both fonts from Google's CDN (with the
preload-async pattern, see `index.html` head). Once we want fewer third-party
requests on the critical path, we switch to local files by:

1. Downloading the `.woff2` files listed below.
2. Placing them in this directory with the filenames listed below.
3. Replacing the three Google Fonts `<link>` tags in every HTML file with one
   `<link rel="stylesheet" href="/fonts/fonts.css">`.

The `fonts.css` file in this directory holds the `@font-face` declarations
ready to go. Until the `.woff2` files are present, the file resolves to nothing
and the system fallback fonts take over · so adding it prematurely will
visibly degrade the site. Only ship the swap when every file below is in place.

## Files we need to download

The current Google Fonts CSS resolves to these eight `.woff2` files (latin
subset is enough for English-only launch). Download via the Google Fonts
download workflow: <https://fonts.google.com/specimen/Newsreader> and
<https://fonts.google.com/specimen/Manrope>, then extract the latin `.woff2`
files and rename them to match the filenames below.

### Newsreader · serif body and display

| Filename in this directory       | Weight | Style  | Used for                                           |
|----------------------------------|--------|--------|----------------------------------------------------|
| `newsreader-400.woff2`           | 400    | normal | Body copy, paragraph text                          |
| `newsreader-500.woff2`           | 500    | normal | Section titles, headings, strong body text         |
| `newsreader-400-italic.woff2`    | 400    | italic | `.ital` accent style, italic body                  |
| `newsreader-500-italic.woff2`    | 500    | italic | Italic headings, callout pull-quotes               |

### Manrope · sans-serif UI

| Filename in this directory       | Weight | Style  | Used for                                           |
|----------------------------------|--------|--------|----------------------------------------------------|
| `manrope-400.woff2`              | 400    | normal | Manrope body uses                                  |
| `manrope-500.woff2`              | 500    | normal | UI labels, nav text, masthead                      |
| `manrope-600.woff2`              | 600    | normal | Buttons, eyebrows, status pills                    |
| `manrope-700.woff2`              | 700    | normal | Heavy emphasis (rare)                              |

That's eight files, latin only, about 110 KB total over the wire.

## When you have the files

Once every file above is in `counsel-day-complete/fonts/`:

1. Verify by opening `fonts.css` in this directory · every `url()` reference
   should resolve.
2. Run the cutover script (not yet written) which:
   - Strips the three Google Fonts `<link>` tags from every HTML file.
   - Adds `<link rel="stylesheet" href="/fonts/fonts.css">` in their place.
   - Adds `<link rel="preload" href="/fonts/newsreader-400.woff2" as="font" type="font/woff2" crossorigin>` for the two most-used weights above the fold.
3. Lighthouse-test the home page before and after; expect LCP to drop by
   ~150-300ms depending on connection.

Until then, the site uses the Google Fonts preload-async pattern documented in
`docs/SEO.md`.
