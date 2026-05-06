# AceStream engine: redistribution and runtime

This project **does not ship** AceStream engine binaries in GitHub Releases. Users run an engine they obtain separately, or the optional **`livetv-supervisor`** starts the public Docker image **`jopsis/acestream`** on the user’s machine (the image is pulled from Docker Hub at runtime by the user’s Docker daemon — we do not redistribute that image inside our archives).

## Why

- **AceStream** and third-party engine builds are subject to their own license and distribution terms. Embedding engine binaries in `livetv` DMG/EXE artifacts would require explicit permission from the rights holder for each platform.
- The **Docker image** `jopsis/acestream` is maintained by a third party; read its Docker Hub page and license before assuming you may repackage its layers inside a different installer.

## What we do instead

1. **Compiled `livetv` CLI** — talks to whatever engine is already listening on `ACE_ENGINE_HOST` / `ACE_ENGINE_PORT` (default `127.0.0.1:6878`).
2. **Optional `livetv-supervisor`** — if nothing answers on that port, it tries **`docker run`** (or `docker start`) so the user’s Docker pulls and runs the engine container locally. On exit it can **`docker stop`** the container it started (see supervisor help). No engine files are bundled in our zip/tarballs.

## If you want a fully offline “one DMG” later

You must **resolve licensing** for platform-native engine binaries (or a sanctioned download URL), then extend the supervisor to launch those binaries instead of Docker. Until then, keep engine acquisition on the user or on Docker Hub at `docker pull` time.

## References

- Official AceStream site: https://acestream.org  
- This repo’s Docker Compose (same engine image family): [`docker-compose.yml`](../docker-compose.yml)
