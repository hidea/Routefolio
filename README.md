# Routefolio

A web app that generates a monochrome route image from a GPX file, complete with a bold route line, direction of travel, place annotations, background map, and elevation profile.

Within Japan it uses the GSI (Geospatial Information Authority of Japan) pale-color map as the background; outside Japan it uses OpenStreetMap. Attribution is shown both on screen and in the saved image.

## Getting started

Run the following in this directory:

```sh
npm run dev
```

Open the local URL shown in your browser. GPX files are processed entirely in the browser and are never sent externally.
The interface is displayed in Japanese when the browser's preferred language is Japanese, and in English otherwise.

Build and preview a production version:

```sh
npm run build
npm run preview
```

## Publishing to Firebase Hosting

1. Log in with the Firebase CLI.
2. Link this folder to a Firebase project.
3. Deploy to Hosting.

```sh
npx firebase-tools login
npx firebase-tools use --add
npm run deploy
```

The actual project ID is not hard-coded into the repository. Select it locally via the `.firebaserc` file created by `firebase use --add`.

## Output

- SVG
- 8-bit grayscale PNG (with `pHYs` metadata for the specified DPI)
- Settings JSON for reuse

## Implementation limitations

The background map can be hidden via settings. External elevation interpolation and individual drag-editing of place labels are out of scope.

## Copyright

Copyright (C) rukari.com All Right Reserved
