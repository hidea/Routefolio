# Routefolio Requirements

## 1. Purpose

Generate, in the browser, a monochrome terrain route diagram in the style of a printed route map. Combine a bold route line, terrain lines, direction of travel, place names, distance/elevation gain, and an elevation profile into a single image.

## 2. Basis for this requirement set

- The app name is `Routefolio`
- Publishable to static hosting such as Firebase Hosting

## 3. Expected usage flow

1. Choose a GPX file. If a name exists inside the GPX, adopt it automatically as the section name.
2. If needed, trim the route range used, by distance or by time.
3. Edit the section name, start-point name, and finish-point name as needed. If a section number etc. is required, include it in the section name.
4. For the heading block (place names, section name with distance/elevation gain) and the elevation profile, choose each one's placement from top/bottom/left/right.
5. Adjust image size, DPI, line width, etc.
6. Check the result in the live preview.
7. Save as PNG or SVG.
8. Save and reload settings as JSON.

## 4. Elements included in the image

- Position chosen by the user (top/bottom/left/right): a large section name with distance/elevation gain directly beneath it
- Center: a bold black line showing the GPX route
- On the route: arrows indicating direction of travel
- Bottom left: a scale bar corresponding to the current map zoom level
- Start point and finish point: symbol, name, elevation. The placement direction of place names can be chosen
- Waypoints contained in a GPX file are expanded into editable Additional labels when the file is loaded.
- Background: a monochrome terrain background fetched from a public map
- The background map fills the entire output image with no margins
- Position chosen by the user (top/bottom/left/right): an elevation profile keyed to distance
- Overall: high-contrast expression using white, black, and gray

## 5. Functional requirements

- Load `trk/trkseg/trkpt` and `rte/rtept` as the route.
- Load `wpt` as named points.
- Compute distance from latitude/longitude.
- If elevation is present in the GPX, compute the elevation profile and elevation gain.
- If timestamps are present in the GPX, the first and last valid timestamps can be shown as the start and end datetime.
- The display of start/end datetime can be toggled together.
- Start/end datetime omit the year and show month, day, hour, and minute.
- Start and end datetime are shown on a single line, with no leading zero on the hour.
- Distance and elevation gain are laid out as "label, value, unit", with only the value shown large.
- The heading, place-label, and elevation-profile annotation sizes can be specified directly in points; profile axis labels remain fixed-size.
- The start-point and finish-point names are shown at roughly the same text size as the distance value at 100% heading size.
- The GPX name is adopted as the section name, in priority order of `trk/name`, `rte/name`, `metadata/name`.
- The range used can be chosen from the entire GPX, start/end distance (km), or start/end time.
- After trimming, recompute distance, elevation gain, datetime, and the elevation profile using only the trimmed route.
- Additional labels other than start/finish can be placed by distance along the route, by datetime, or by latitude/longitude.
- Each additional label has a configurable name and display direction, and can be added or removed.
- Additional labels placed by distance or datetime show the elevation of the corresponding GPX point.
- Additional labels are saved to and reloaded from the settings JSON.
- Multiple track segments are drawn as separate lines.
- Output width, height, and DPI can be configured.
- The line widths of the route and the elevation profile can each be configured.
- The size of the direction-of-travel arrows can be configured.
- The map display position can be offset horizontally and vertically in millimeters while keeping the route and background map aligned.
- The scale bar is calculated automatically from the GPX center latitude and the map zoom level, and displayed.
- The placement direction of place names can be chosen from top/bottom/left/right.
- The placement of the distance/elevation-gain block can be chosen from top/bottom/left/right.
- The heading block can be offset horizontally and vertically in millimeters.
- The placement of the elevation profile can be chosen from top/bottom/left/right.
- The elevation profile can be offset horizontally and vertically in millimeters.
- The elevation profile width and height can be specified directly in millimeters.
- Output margins can be specified in millimeters, either as one value for all sides or separately for top/right/bottom/left.
- The background map and elevation profile can each be toggled on or off.
- The background map can be switched between the standard map, a two-tone water/land map, and a terrain-emphasis map.
- The live preview display scale can be adjusted from 1% to 300% without changing exported image dimensions, and can be fit within the preview area in both dimensions.
- Fetch a background map around the route from a public map service.
- If the route is within Japan, use the Geospatial Information Authority of Japan (GSI) map as the background.
- If the route is outside Japan, use OpenStreetMap as the standard background and OpenTopoMap for terrain emphasis.
- Comply with the background map's attribution and terms of use.
- Save as SVG and PNG.
- Save and load settings as JSON.
- Process GPX data entirely within the browser; never send it to a server.

## 6. UI requirements

- On desktop, place settings on the left and a large preview on the right.
- In the desktop split view, keep the right-side preview pinned to the top of the screen while the settings panel scrolls.
- On narrow screens, stack settings and preview vertically.
- Label every input field and support keyboard operation.
- Show GPX parsing errors and missing-elevation warnings in the browser's UI.

## 7. Publishing requirements

- Whether or not there is a build step does not matter.
- Bundle `firebase.json` so the project can be published to Firebase Hosting.
- Do not hard-code a Firebase project ID; let the publisher choose it.
- Include security headers in the Hosting configuration.

## 8. Initial-version assumptions

- The background map is fetched from a public map service; no generated decorative pattern is used.
- The background map can be hidden via settings.
- Routes within Japan use the GSI map.
- Confirm and implement GSI's image output conditions, usage limits, required attribution, and browser fetch method.
- Routes outside Japan use OpenStreetMap, or OpenTopoMap when terrain emphasis is selected.
- Confirm and implement OpenStreetMap's tile usage terms, required copyright notice, usage limits, and image output method.

## 9. Acceptance criteria

- The bundled GPX produces a visible route diagram and elevation profile.
- The route overlays correctly, at the right position, on the background fetched from the public map.
- Place names, the distance/elevation-gain block, and the elevation profile can each be placed at the specified top/bottom/left/right position.
- The background map covers the entire output image.
- The elevation profile's Y-axis shows 4 ticks at clean 100 m intervals.
- The elevation profile's X-axis shows 5 ticks at clean 10 km intervals, including 0 km.
- The elevation line is drawn using the full trimmed distance across the full width of the elevation profile.
- The elevation profile's line width and the direction-arrow size can be changed.
- As in the sample image, the bold route line, background map, direction of travel, place annotations, and elevation profile all fit within a single image.
- PNG can be saved at the specified pixel dimensions.
- Can be served via the Firebase Hosting Emulator.
