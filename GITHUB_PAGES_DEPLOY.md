# GitHub Pages Deploy

GitHub Pages chi host duoc frontend tinh trong thu muc `web/`.
De tick "da goi" dong bo voi desktop/database, mobile app tren Pages can goi ve mot API HTTPS public.

## Cach deploy frontend

1. Tao repository tren GitHub.
2. Push project nay len branch `main` hoac `master`.
3. Vao `Settings > Pages > Build and deployment`.
4. Chon `Source: GitHub Actions`.
5. Workflow `Deploy GitHub Pages` se publish thu muc `web/`.

## API cho mobile

Khi mo app tren `github.io`, nhap URL API HTTPS vao o dau trang.
Vi du khi ban expose server local bang Cloudflare Tunnel/ngrok:

```text
https://ten-tunnel.example.com
```

Hoac mo truc tiep kem query:

```text
https://USERNAME.github.io/REPO/?api=https://ten-tunnel.example.com
```

Neu API chi la `http://192.168.x.x:3001`, GitHub Pages HTTPS se thuong bi trinh duyet chan vi mixed content.

Backend can co bien moi truong:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
```
