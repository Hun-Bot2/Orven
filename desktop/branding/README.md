# Orven desktop icon

`orven-icon.png` is the transparent, refined master derived from
`orven-icon-original.png` (the supplied root `logo.png`, moved without modifying
its bytes). Keep the original source unchanged. The dark rounded tile and
silver ribbon retain the existing identity; pixels outside the tile are transparent.

Regenerate with the installed Tauri CLI from the repository root:

```sh
desktop/node_modules/.bin/tauri icon desktop/branding/orven-icon.png --output /tmp/orven-icons
cp /tmp/orven-icons/icon.png desktop/src-tauri/icons/icon.png
cp /tmp/orven-icons/icon.icns desktop/src-tauri/icons/icon.icns
cp /tmp/orven-icons/128x128@2x.png desktop/src/assets/orven-logo.png
```

Only the macOS and shared PNG assets are used. No mobile targets are enabled.
