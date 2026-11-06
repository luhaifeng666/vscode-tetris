# 俄罗斯方块在线排行榜服务

零第三方依赖的 Node 服务，只做两件事：读 TOP10、写一条成绩。服务只监听 `127.0.0.1`，HTTPS 交给你的 nginx / Caddy。

## 接口

```http
GET  /v1/top
POST /v1/scores
GET  /health
```

- 每个 `playerId` 只占一个名额，保留最高分。
- 榜单是娱乐性质：分数由客户端上报，服务端只做格式/上限校验、限流和去重。
- 不存 IP，不记录请求体。

## 运行

要求 Node 20+。

```bash
sudo mkdir -p /opt/vscode-tetris-leaderboard /var/lib/tetris
sudo cp -r server/* /opt/vscode-tetris-leaderboard/
sudo useradd -r -s /usr/sbin/nologin tetris || true
sudo chown -R tetris:tetris /opt/vscode-tetris-leaderboard /var/lib/tetris

sudo tee /etc/systemd/system/tetris-leaderboard.service >/dev/null <<'UNIT'
[Unit]
Description=Tetris leaderboard
After=network.target

[Service]
Type=simple
User=tetris
WorkingDirectory=/opt/vscode-tetris-leaderboard
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=DATA_DIR=/var/lib/tetris
ExecStart=/usr/bin/node /opt/vscode-tetris-leaderboard/server.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now tetris-leaderboard
sudo systemctl status tetris-leaderboard --no-pager
```

验证：

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/v1/top
```

## HTTPS 反代

服务只监听 localhost，**不要**在阿里云安全组开放 8787；只保留 443。

nginx（放在你现有站点的 server 块里）：

```nginx
location /tetris-api/ {
  proxy_pass http://127.0.0.1:8787/;   # 末尾斜杠会剥掉 /tetris-api/
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Caddy：

```
handle_path /tetris-api/* {
  reverse_proxy 127.0.0.1:8787
}
```

反代后的自测：

```bash
curl -s https://your-domain/tetris-api/health
curl -s https://your-domain/tetris-api/v1/top
```

## 数据与备份

- 数据文件：`/var/lib/tetris/scores.json`。
- 重启不会清榜；删除该文件才清空。
- 备份：`sudo cp /var/lib/tetris/scores.json /var/lib/tetris/scores.$(date +%F).bak`（先 `systemctl stop` 或接受短暂不一致）。
- 最多保留 200 名玩家。

## 限制

- POST 每 IP 6 次/分钟；同一玩家 10 秒一次；GET 每 IP 60 次/分钟。
- `playerId` 必须是 8–64 位十六进制/UUID；昵称 ≤24 个码点；分数 0–10,000,000；行数 0–1,000,000；等级 1–15。
- 没有鉴权；任何人拿到地址都能提交分数。这是娱乐榜的定位，不适用于竞技排名。
